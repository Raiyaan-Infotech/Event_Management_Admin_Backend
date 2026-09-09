const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const {
    Sequelize,
    Event,
    EventGuest,
    WebsiteClient,
    EventCategory,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const eventQr = require('../utils/eventQr');
const relationshipOptions = require('./guestRelationshipOption.service');
const foodOptions = require('./guestFoodPreferenceOption.service');
const { OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS } = require('./websiteClientOAuth.service');
const msg91 = require('./msg91Whatsapp.service');
const notificationTrigger = require('./notificationTrigger.service');

/**
 * Self-registration: a guest scans the invitation QR and joins the event.
 *
 * ── THE FLOW THIS BACKS ─────────────────────────────────────────────────────
 *   resolve  -> the app shows the event card and the two dropdowns
 *   otp      -> the "Verify" button beside the mobile field
 *   join     -> Confirm on the review step
 *
 * ── PARTICIPANTS ARE GUESTS ─────────────────────────────────────────────────
 * There is no separate membership table. The mobile app's own model says the
 * "Participants module (also reused by the Guests module)" — they are one
 * concept under two names, and `event_guests` already holds every field the
 * form collects. `participant_client_id` is what makes a guest row also an
 * account.
 *
 * ── THE QR TOKEN IS THE CAPABILITY, AND IT GATES EVERYTHING ─────────────────
 * All three steps are unauthenticated at the start — the whole point is that
 * the person has no account yet. What stops this being an open account factory
 * is that every step requires a QR token that decrypts: you cannot ask for an
 * OTP, and therefore cannot create an account, without holding a real
 * invitation. `resolveInvite` is also why the payload is NARROWED — see below.
 */

const DEFAULT_VENDOR_ID = 1;
const DEFAULT_COMPANY_ID = 1;

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * The event as an UNAUTHENTICATED scanner may see it.
 *
 * ⚠ Deliberately narrow. `clientEvent.controller.js` decodeQr is behind a
 * session precisely because its payload carries `website_client_id` and
 * `subscription_plan_id`, and it says in as many words that a public scanner
 * "wants its own endpoint returning a narrowed payload, not this one made
 * public." This is that endpoint. Anything added here is readable by anyone who
 * photographs an invitation.
 */
const publicEvent = (event) => ({
    id: event.id,
    name: event.name,
    tagline: event.tagline,
    description: event.description,
    start_date: event.start_date,
    end_date: event.end_date,
    start_time: event.start_time,
    end_time: event.end_time,
    timezone: event.timezone,
    venue_name: event.venue_name,
    venue_address: event.venue_address,
    host_one: event.host_one,
    host_two: event.host_two,
    organizer: event.organizer,
    event_category_id: event.event_category_id,
    category_name: event.category?.name ?? null,
});

/** Decode a QR token to a live event, or explain why not. */
const eventFromToken = async (token) => {
    if (!token) throw ApiError.badRequest('No QR token supplied.');

    const payload = eventQr.decrypt(String(token));
    // A wrong key, a truncated scan and a hand-edited code are indistinguishable
    // here and all mean the same thing to the caller.
    if (!payload) throw ApiError.badRequest('This QR code is not valid.');

    const expanded = eventQr.expandPayload(payload);
    if (!expanded.event_id) throw ApiError.badRequest('This QR code is not valid.');

    const event = await Event.findByPk(expanded.event_id, {
        include: [{ model: EventCategory, as: 'category', attributes: ['id', 'name'], required: false }],
    });
    if (!event) throw ApiError.notFound('That event no longer exists.');

    return event;
};

/**
 * Step 1 — what the app needs to draw the form.
 *
 * The dropdowns come back WITH the event rather than from their own endpoint:
 * they depend on the event's category, so a second round trip would only be
 * able to ask for them by category id, which would mean handing the category
 * out first anyway.
 */
const resolveInvite = async (token) => {
    const event = await eventFromToken(token);
    const categoryId = event.event_category_id;

    const [relationships, foods] = await Promise.all([
        relationshipOptions.listForCategory(categoryId, DEFAULT_COMPANY_ID),
        foodOptions.listForCategory(categoryId, DEFAULT_COMPANY_ID),
    ]);

    return {
        event: publicEvent(event),
        relationship_options: relationships.map((r) => ({ id: r.id, name: r.name })),
        food_preference_options: foods.map((r) => ({ id: r.id, name: r.name })),
    };
};

/**
 * Find the account for a number, matching the way the login flow does.
 *
 * Stored numbers are the bare national form with `dial_code` held separately,
 * but people type "+91 98846 99435". The last-10 candidate is why an account
 * created here is later found by the login flow, and vice versa — the two must
 * agree or a guest would end up with two accounts for one phone.
 */
const findClientByMobile = async (mobile) => {
    const digits = digitsOnly(mobile);
    if (digits.length < 7 || digits.length > 15) {
        throw ApiError.badRequest('Please enter a valid mobile number.');
    }
    const candidates = [...new Set([digits, digits.slice(-10)])];

    return WebsiteClient.unscoped().findOne({
        where: { vendor_id: DEFAULT_VENDOR_ID, mobile: { [Op.in]: candidates } },
        attributes: { exclude: ['password'] },
    });
};

/**
 * Step 2a — issue a code, creating the account if this number is new.
 *
 * ⚠ This is the ONE route in the system that creates a website_client without
 * an admin or a signup form, so the guard matters: the QR token is verified
 * FIRST, and a token that does not decrypt never reaches the create. Without
 * that this would be an open endpoint that manufactures accounts.
 *
 * An existing account is reused untouched — no rename, no reactivation. Someone
 * else's phone number must not become a way to edit their profile.
 */
const requestOtp = async ({ token, mobile, dial_code, name } = {}) => {
    await eventFromToken(token); // capability check — throws if not a real invite

    const digits = digitsOnly(mobile);
    let client = await findClientByMobile(mobile);
    let created = false;

    if (!client) {
        /*
          A SOFT-DELETED account may still hold this number.

          `findClientByMobile` deliberately sees only live rows — a removed
          account must not be silently handed to whoever types its number, which
          is the same rule `assertEmailFree` follows for addresses. But the
          number is still occupied as far as the database is concerned:
          `uniq_website_client_mobile` covers the whole table, not the paranoid
          view. Creating here would therefore fail with a raw
          SequelizeUniqueConstraintError, which reaches the guest as a 500 and
          tells them nothing.

          Checked explicitly so the answer is a sentence instead, matching the
          wording the signup and admin paths already use.
        */
        const removed = await WebsiteClient.findOne({
            where: {
                vendor_id: DEFAULT_VENDOR_ID,
                mobile: { [Op.in]: [...new Set([digits, digits.slice(-10)])] },
            },
            attributes: ['id'],
            paranoid: false,
        });
        if (removed) {
            throw ApiError.badRequest(
                'An account with this mobile number was removed previously. '
                + 'Please contact us to restore it.',
            );
        }

        client = await WebsiteClient.create({
            vendor_id: DEFAULT_VENDOR_ID,
            company_id: DEFAULT_COMPANY_ID,
            // `name` is NOT NULL. The form collects it in the same step, but the
            // Verify button can be pressed before it is typed, so the number
            // stands in and `join` fills the real name once it has one.
            name: String(name || '').trim() || digits,
            email: null,
            dial_code: dial_code || '+91',
            mobile: digits.length > 10 ? digits.slice(-10) : digits,
            source: 'website',
            is_active: 1,
        });
        created = true;
    } else if (Number(client.is_active) !== 1) {
        // Blocked or deactivated stays that way; an invitation does not lift it.
        throw ApiError.forbidden('Your account is not active. Please contact us.');
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = await bcrypt.hash(code, 10);

    // `hooks: false` so the model's beforeUpdate password hook cannot fire on a
    // row loaded without its password.
    await client.update(
        {
            otp_hash: otpHash,
            otp_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
            otp_attempts: 0,
        },
        { hooks: false },
    );

    // Delivery. The hash is already stored above, so a send that fails costs a
    // retry rather than an unverifiable code — see msg91Whatsapp.service.
    const delivery = await msg91.sendOtp({
        dialCode: client.dial_code,
        mobile: digits,
        code,
        purpose: 'registration',
    });

    if (!delivery.delivered) {
        // Only when nothing was sent, and never in production: without this the
        // code is unrecoverable on a machine with no MSG91 credentials.
        logger.info?.(
            `[OTP] registration code for website_client ${client.id} -> ${client.dial_code || ''}${digits}: ` +
            `${code} (NOT SENT — ${delivery.reason})`,
        );
    }

    /*
      The code is returned to the caller when it could not be delivered for a
      reason we chose — WhatsApp switched off with MSG91_OTP_ENABLED=false, or
      no credentials on this machine — as well as when OTP_DEV_ECHO asks for it.

      Without this, turning delivery off would lock every account out: the code
      is generated, hashed, stored and still CHECKED, but nothing would ever
      show it. Verification is not weakened; only the delivery channel changes.

      NEVER in production, whatever the flags say — that guard is the reason
      this is safe to leave on locally.
    */
    const echo =
        process.env.NODE_ENV !== 'production'
        && (process.env.OTP_DEV_ECHO === 'true'
            || delivery.reason === 'disabled'
            || delivery.reason === 'not_configured');

    return {
        expires_in: OTP_TTL_SECONDS,
        delivered: delivery.delivered,
        // Named so the app can tell "we could not send it" apart from a wrong
        // code. Withheld in production: the reason describes our own
        // configuration and is of no use to the person holding the phone.
        ...(delivery.delivered || process.env.NODE_ENV === 'production'
            ? {}
            : { delivery_error: delivery.reason }),
        account_created: created,
        ...(echo ? { dev_code: code } : {}),
    };
};

/**
 * Step 2b — check the code.
 *
 * ⚠ OTP_ACCEPT_ANY makes the code decorative: with it on, ANY value passes. It
 * is the agreed state until an SMS provider exists; turn it off the moment one
 * does and nothing else here changes.
 *
 * Unlike the login flow, this one DOES set `mobile_verified` — outside the
 * bypass, possession of the number was just proved, and this is the only place
 * a self-registered number is ever checked.
 */
const verifyOtp = async ({ mobile, otp } = {}) => {
    const client = await findClientByMobile(mobile);
    if (!client) throw ApiError.badRequest('Please request a code first.');

    const code = digitsOnly(otp);

    if (!client.otp_hash || !client.otp_expires_at) {
        throw ApiError.badRequest('Please request a code first.');
    }
    if (new Date(client.otp_expires_at).getTime() < Date.now()) {
        throw ApiError.badRequest('That code has expired. Please request a new one.');
    }
    if (client.otp_attempts >= OTP_MAX_ATTEMPTS) {
        throw ApiError.badRequest('Too many incorrect attempts. Please request a new code.');
    }

    const acceptAny = process.env.OTP_ACCEPT_ANY === 'true';
    const matches =
        acceptAny || (code.length === 6 && (await bcrypt.compare(code, client.otp_hash)));

    if (!matches) {
        // Counted BEFORE the throw, or the cap is decorative.
        await client.update({ otp_attempts: client.otp_attempts + 1 }, { hooks: false });
        throw ApiError.badRequest('That code is not correct.');
    }

    if (acceptAny) {
        logger.warn?.(
            `[OTP] OTP_ACCEPT_ANY is on — accepted an unchecked registration code for website_client ${client.id}`,
        );
    }

    await client.update(
        {
            otp_hash: null,
            otp_expires_at: null,
            otp_attempts: 0,
            mobile_verified: 1,
            last_login_at: new Date(),
        },
        { hooks: false },
    );

    return WebsiteClient.findByPk(client.id);
};

/** What the guest said maps onto BOTH enums, which track different things. */
const RESPONSE_TO_STATUS = {
    yes: 'accepted',
    no: 'declined',
    maybe: 'pending',
};

/**
 * Step 3 — write the guest row.
 *
 * ── THE MOBILE COMES FROM THE ACCOUNT, NEVER THE BODY ───────────────────────
 * The number that was OTP-verified is the one on `client`. Reading it from the
 * form instead would let someone verify their own number and then register
 * under somebody else's.
 *
 * ── AN EXISTING ROW IS UPDATED, NOT DUPLICATED ──────────────────────────────
 * Hosts import guest lists, so the person scanning is usually already on it.
 * Matching is by mobile within THIS event, so the Participant List shows one
 * Mohammed Ali, with the answers he gave attached to the row the host made.
 *
 * `invite_source` is NOT overwritten on that path: the model defines it as how
 * this person FIRST came in, so a guest the host added by WhatsApp stays
 * 'whatsapp' even though they completed the form by QR.
 */
const join = async (client, payload = {}) => {
    const event = await eventFromToken(payload.token);

    const clientDigits = digitsOnly(client.mobile);
    const candidates = [...new Set([clientDigits, clientDigits.slice(-10)])].filter(Boolean);

    const existing = candidates.length
        ? await EventGuest.findOne({
            where: { event_id: event.id, mobile: { [Op.in]: candidates } },
        })
        : null;

    const response = ['yes', 'no', 'maybe'].includes(payload.response_type)
        ? payload.response_type
        : 'none';

    // "No. of Guests with you" counts people BROUGHT — so the party is them
    // plus that many. Storing it as party_size directly would undercount every
    // booking by one head.
    const extra = Math.max(0, Math.min(255, Number(payload.guest_count) || 0));

    const fields = {
        name: String(payload.name || '').trim() || existing?.name || client.name,
        gender: ['male', 'female', 'other'].includes(payload.gender) ? payload.gender : null,
        relationship: payload.relationship ? String(payload.relationship).slice(0, 60) : null,
        relationship_option_id: payload.relationship_option_id || null,
        email: payload.email ? String(payload.email).trim().toLowerCase() : existing?.email ?? null,
        dietary_preference: payload.food_preference
            ? String(payload.food_preference).slice(0, 255)
            : null,
        food_preference_option_id: payload.food_preference_option_id || null,
        special_requirements: payload.special_request
            ? String(payload.special_request).slice(0, 500)
            : null,
        notes: payload.message ? String(payload.message).slice(0, 500) : null,
        plus_one: extra > 0 ? 1 : 0,
        plus_one_count: extra,
        party_size: extra + 1,
        response_type: response,
        rsvp_status: RESPONSE_TO_STATUS[response] ?? 'pending',
        responded_at: response === 'none' ? null : new Date(),
        participant_client_id: client.id,
    };

    let guest;
    if (existing) {
        await existing.update(fields); // invite_source untouched — see the header
        guest = existing;
    } else {
        guest = await EventGuest.create({
            ...fields,
            event_id: event.id,
            // The HOST, denormalised from the event — not the participant.
            website_client_id: event.website_client_id,
            company_id: event.company_id ?? DEFAULT_COMPANY_ID,
            dial_code: client.dial_code || '+91',
            mobile: clientDigits.length > 10 ? clientDigits.slice(-10) : clientDigits,
            invite_source: 'qr',
            invited_at: new Date(),
        });
    }

    // Fill a placeholder account name once a real one exists, but never rename
    // an account that already has one — a guest form is not a profile editor.
    const accountName = String(client.name || '').trim();
    if (fields.name && (!accountName || accountName === clientDigits)) {
        await WebsiteClient.update({ name: fields.name }, { where: { id: client.id }, hooks: false });
    }

    // Trigger Welcome Invitation (checks client portal on/off pref)
    notificationTrigger.triggerWelcomeInvitation({
        event,
        guest,
        client,
        companyId: event.company_id,
    }).catch((err) => {
        logger.error?.('[guestRegistration.join] Welcome invitation trigger error:', err.message);
    });

    return { event: publicEvent(event), guest, created: !existing };
};

/**
 * The events this person is a participant of — the app's My Events for a guest.
 *
 * Distinct from the events they OWN, which is `events.website_client_id`. A
 * host who also scanned somebody else's invitation legitimately appears in both.
 */
const myEvents = async (clientId) => {
    const rows = await EventGuest.findAll({
        where: { participant_client_id: clientId },
        attributes: ['id', 'event_id', 'response_type', 'rsvp_status', 'party_size'],
        include: [{
            model: Event,
            as: 'event',
            include: [{ model: EventCategory, as: 'category', attributes: ['id', 'name'], required: false }],
        }],
        order: [['created_at', 'DESC']],
    });

    return rows
        .filter((r) => r.event)
        .map((r) => ({
            ...publicEvent(r.event),
            guest_id: r.id,
            response_type: r.response_type,
            rsvp_status: r.rsvp_status,
            party_size: r.party_size,
        }));
};

module.exports = {
    resolveInvite,
    requestOtp,
    verifyOtp,
    join,
    myEvents,
    // exported for tests
    publicEvent,
    eventFromToken,
};
