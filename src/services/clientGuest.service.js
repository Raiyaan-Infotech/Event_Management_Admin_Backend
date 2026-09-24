const {
    Sequelize,
    sequelize,
    Event,
    EventGuest,
    EventGuestGroup,
    ClientSubscription,
    WebsiteClient,
    SubscriptionPlan,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const notifications = require('./clientNotification.service');
const notificationTrigger = require('./notificationTrigger.service');
const subscriptionPlanService = require('./subscriptionPlan.service');
// The same two catalogues the guest's own registration form reads — see
// getGuestFormOptions for why the host cannot go through the admin routes.
const relationshipOptions = require('./guestRelationshipOption.service');
const foodOptions = require('./guestFoodPreferenceOption.service');

/**
 * Guests.
 *
 * ── STATUS AND RESPONSE ARE TWO FIELDS ───────────────────────────────────────
 * The import CSV settled this: a row can be `Invited` with a blank Response.
 *
 *   rsvp_status    not_responded -> invited -> pending -> accepted | declined
 *   response_type  none | yes | maybe | no
 *
 * The list's tabs filter on STATUS. The RESPONSE column shows what they said.
 * They move together when a guest replies, which `applyResponse()` below is the
 * single place that decides — everywhere else just stores what it is given.
 *
 * ── OWNERSHIP ────────────────────────────────────────────────────────────────
 * `website_client_id` comes off the session, never the body, and every read is
 * scoped by it. An id from another account is a 404, not a 403.
 */

/** Everything a client may set. Ownership columns are absent on purpose. */
/*
  ⚠ A COLUMN MISSING FROM HERE IS DROPPED IN SILENCE.

  `normalise` copies only the fields named below out of the body, so anything
  absent is discarded without an error — the save succeeds and the value is
  simply gone. `gender`, `relationship`, `relationship_option_id` and
  `food_preference_option_id` were exactly that: real columns on `event_guests`,
  written by the guest's own registration form, and unreachable from the host's
  Add Guest form because they were never listed here.
*/
const WRITABLE_FIELDS = [
    'event_id', 'group_id',
    'title', 'first_name', 'last_name', 'date_of_birth', 'email', 'dial_code', 'mobile', 'whatsapp',
    'gender', 'relationship', 'relationship_option_id',
    'company', 'table_number', 'party_size',
    'rsvp_status', 'response_type', 'invite_source',
    'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
    'dietary_preference', 'food_preference_option_id',
    'special_requirements', 'plus_one', 'plus_one_count',
    'custom_answers', 'notes',
];

const GENDERS = ['male', 'female', 'other'];

const RSVP_STATUSES = ['not_responded', 'invited', 'pending', 'accepted', 'declined'];
const RESPONSE_TYPES = ['none', 'yes', 'no', 'maybe'];
const INVITE_SOURCES = ['whatsapp', 'email', 'sms', 'manual', 'import'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const GUEST_INCLUDE = [
    {
        model: Event, as: 'event',
        attributes: ['id', 'name', 'start_date', 'start_time', 'theme_id'],
        required: false,
    },
    {
        model: EventGuestGroup, as: 'group',
        attributes: ['id', 'name', 'color'],
        required: false,
    },
];

const str = (value, max) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Status and response move together when a guest actually replies.
 *
 * The one place that decision lives. Called on create and update whenever a
 * response arrives, so a guest cannot end up `Declined` while their response
 * still reads `Yes` — which is exactly the kind of contradiction the list
 * renders side by side and a reader would rightly not trust.
 */
const applyResponse = (data, previous = {}) => {
    const response = data.response_type ?? previous.response_type;
    const statusGiven = Object.prototype.hasOwnProperty.call(data, 'rsvp_status');

    // An explicit status wins — importing a row that says Invited/blank must
    // stay Invited, and an admin setting a status by hand must stick.
    if (statusGiven) return;
    if (!response || response === 'none') return;

    data.rsvp_status = response === 'yes' ? 'accepted' : response === 'no' ? 'declined' : 'pending';
};

/** The row as the portal reads it, with the display name kept in step. */
const present = (guest) => {
    const plain = guest.toJSON ? guest.toJSON() : guest;
    return {
        ...plain,
        full_name: plain.name,
        // The list shows "Imported" as a tab; the flag saves every consumer
        // re-deriving it from invite_source.
        is_imported: plain.invite_source === 'import',
        /*
          ── A GUEST IS NOT A PARTICIPANT ───────────────────────────────────
          A GUEST is a row the host typed in or imported. A PARTICIPANT is
          somebody who actually joined the event through the app — scanned the
          invitation, verified their number, and got an account. The column
          that separates them is `participant_client_id`, which stays NULL
          forever for guests who never install the app (most of them).

          Sent as a BOOLEAN, never the id itself: the id names another
          person's account, and "has this guest joined" is the whole question
          the screens need answered. Without it the app could not tell the two
          apart, so the Participants list and the Guest List showed the same
          rows under different titles.
        */
        has_joined: Boolean(plain.participant_client_id),
    };
};

/** Build the display name from the parts, so `name` never drifts from them. */
const composeName = (first, last, fallback) => {
    const joined = [first, last].filter(Boolean).join(' ').trim();
    return joined || fallback || null;
};

const normalise = async (clientId, body, { partial = false, existing = null } = {}) => {
    const data = {};
    const picked = {};
    for (const field of WRITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, field)) picked[field] = body[field];
    }
    const has = (f) => Object.prototype.hasOwnProperty.call(picked, f);
    const required = (f) => !partial || has(f);

    // ── Event: optional (§570) — a guest is a person on the client's general
    // list. When one IS named it must be the client's own.
    if (has('event_id')) {
        const raw = picked.event_id;
        if (raw === '' || raw === null || raw === undefined) {
            data.event_id = null;
        } else {
            const eventId = Number(raw);
            if (!eventId) throw ApiError.badRequest('Please select a valid event.');
            const event = await Event.findOne({
                where: { id: eventId, website_client_id: clientId },
                attributes: ['id'],
            });
            // Scoped lookup, not a plain findByPk — otherwise a guest could be
            // filed against another client's event by id.
            if (!event) throw ApiError.badRequest('That event is not on your account.');
            data.event_id = eventId;
        }
    }

    // ── Group: optional, must be the client's own ──────────────────────────
    if (has('group_id')) {
        const raw = picked.group_id;
        if (raw === '' || raw === null || raw === undefined) {
            data.group_id = null;
        } else {
            const groupId = Number(raw);
            const group = await EventGuestGroup.findOne({
                where: { id: groupId, website_client_id: clientId },
                attributes: ['id'],
            });
            if (!group) throw ApiError.badRequest('That guest group is not on your account.');
            data.group_id = groupId;
        }
    }

    // ── Identity ───────────────────────────────────────────────────────────
    if (required('first_name')) {
        const first = str(picked.first_name, 100);
        if (!first) throw ApiError.badRequest('Please enter the guest’s first name.');
        data.first_name = first;
    }
    if (has('last_name')) data.last_name = str(picked.last_name, 100);
    if (has('title')) data.title = str(picked.title, 30);

    // YYYY-MM-DD or empty. Checked as a REAL calendar date (2026-02-30 is not),
    // and never in the future — a birthday that has not happened yet is a typo.
    if (has('date_of_birth')) {
        const raw = str(picked.date_of_birth, 10);
        if (!raw) {
            data.date_of_birth = null;
        } else {
            const valid = /^\d{4}-\d{2}-\d{2}$/.test(raw)
                && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw;
            if (!valid) throw ApiError.badRequest('Please enter a valid date of birth.');
            if (raw > new Date().toISOString().slice(0, 10)) {
                throw ApiError.badRequest('Date of birth cannot be in the future.');
            }
            data.date_of_birth = raw;
        }
    }

    if (data.first_name !== undefined || data.last_name !== undefined) {
        data.name = composeName(
            data.first_name ?? existing?.first_name,
            data.last_name !== undefined ? data.last_name : existing?.last_name,
            existing?.name
        );
    }

    // Email is OPTIONAL, mobile is MANDATORY (§576): the phone number is what an
    // invitation is shared to, and the key a contact is recognised by.
    if (has('email')) {
        const email = str(picked.email, 255);
        if (email && !EMAIL.test(email)) throw ApiError.badRequest('Please enter a valid email address.');
        data.email = email ? email.toLowerCase() : null;
    }

    if (has('dial_code')) data.dial_code = str(picked.dial_code, 8);
    // Digits, +, spaces and dashes only — a pasted "(+91) 98765-43210" is fine,
    // a name in the phone box is not.
    for (const field of ['mobile', 'whatsapp']) {
        if (!has(field) && !(field === 'mobile' && required('mobile'))) continue;
        const value = str(picked[field], 20);
        if (field === 'mobile' && !value) throw ApiError.badRequest('Please enter the guest’s mobile number.');
        if (value && !/^[+\d][\d\s-]{4,}$/.test(value)) {
            throw ApiError.badRequest('Please enter a valid phone number.');
        }
        data[field] = value;
    }

    if (has('company')) data.company = str(picked.company, 200);
    if (has('table_number')) data.table_number = str(picked.table_number, 30);

    if (has('party_size')) {
        const size = Number(picked.party_size);
        if (!Number.isInteger(size) || size < 1 || size > 50) {
            throw ApiError.badRequest('Party size must be between 1 and 50.');
        }
        data.party_size = size;
    }

    // ── RSVP ───────────────────────────────────────────────────────────────
    if (has('rsvp_status')) {
        const value = String(picked.rsvp_status || '').toLowerCase();
        if (!RSVP_STATUSES.includes(value)) throw ApiError.badRequest('Invalid RSVP status.');
        data.rsvp_status = value;
    }
    if (has('response_type')) {
        const value = String(picked.response_type || 'none').toLowerCase();
        if (!RESPONSE_TYPES.includes(value)) throw ApiError.badRequest('Invalid response type.');
        data.response_type = value;
    }
    if (has('invite_source')) {
        const value = String(picked.invite_source || 'manual').toLowerCase();
        if (!INVITE_SOURCES.includes(value)) throw ApiError.badRequest('Invalid invite source.');
        data.invite_source = value;
    }

    applyResponse(data, existing ?? {});

    // Stamp the moment a real answer first arrives, and clear it if the guest
    // is put back to "not responded" — a responded_at with no response is the
    // kind of leftover that makes the response rate wrong.
    const responded = data.response_type && data.response_type !== 'none';
    if (responded && !existing?.responded_at) data.responded_at = new Date();
    if (data.response_type === 'none') data.responded_at = null;

    // ── Address and extras ─────────────────────────────────────────────────
    const optional = {
        address_line1: 255, address_line2: 255, city: 120, state: 120,
        postal_code: 20, country: 100, dietary_preference: 255,
        special_requirements: 500, notes: 500, relationship: 60,
    };
    for (const [field, max] of Object.entries(optional)) {
        if (has(field)) data[field] = str(picked[field], max);
    }

    // Matched against the list rather than stored as typed: the column is a
    // plain string, so an unrecognised value would persist and every reader
    // would then have to cope with it.
    if (has('gender')) {
        data.gender = GENDERS.includes(picked.gender) ? picked.gender : null;
    }

    /*
      The option-table ids behind `relationship` and `dietary_preference`.

      Both carry the LABEL and the id: the label is what the guest chose at the
      time and must survive the option being renamed or retired, while the id is
      what joins back to the catalogue. Storing only one of them loses the other
      answer, so the registration form sends both and this accepts both.
    */
    for (const field of ['relationship_option_id', 'food_preference_option_id']) {
        if (has(field)) {
            const id = Number(picked[field]);
            data[field] = Number.isInteger(id) && id > 0 ? id : null;
        }
    }

    if (has('plus_one')) data.plus_one = picked.plus_one ? 1 : 0;
    if (has('plus_one_count')) {
        const count = Number(picked.plus_one_count) || 0;
        if (count < 0 || count > 20) throw ApiError.badRequest('Plus one count must be 20 or fewer.');
        data.plus_one_count = count;
    }
    // A count with the allowance off is contradictory; the allowance is the
    // authority, so the count follows it rather than the other way round.
    if (data.plus_one === 0) data.plus_one_count = 0;

    if (has('custom_answers')) {
        data.custom_answers = picked.custom_answers && typeof picked.custom_answers === 'object'
            ? picked.custom_answers
            : null;
    }

    return data;
};

/**
 * The list, filtered the way the tabs filter it.
 *
 * `imported` is not a status — it is `invite_source = 'import'` — which is why
 * it cannot be a plain equality on rsvp_status like the other four tabs.
 */
const listGuests = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 8));
    const tab = String(query.status || 'all').toLowerCase();
    const search = String(query.search || '').trim();
    const eventId = Number(query.event_id) || null;
    const groupId = Number(query.group_id) || null;

    const where = { website_client_id: clientId };

    /*
      Default = the PHONE BOOK (see PHONE_BOOK above). Without this the Guests
      screen listed participants too, so a stranger who scanned the QR appeared
      among the client's own contacts.

      `scope=participants` (with or without an event) asks for the other half;
      `scope=all` keeps the old behaviour for anything that genuinely wants both.
    */
    const scope = String(query.scope || (eventId ? 'participants' : 'guests')).toLowerCase();
    if (scope === 'guests') where.event_id = null;
    else if (scope === 'participants') where.event_id = { [Op.ne]: null };

    if (tab === 'imported') where.invite_source = 'import';
    else if (tab === 'not_responded') where.rsvp_status = { [Op.in]: ['not_responded', 'invited'] };
    else if (RSVP_STATUSES.includes(tab)) where.rsvp_status = tab;

    if (eventId) where.event_id = eventId;
    // `group_id=0` is the UI's "Ungrouped" option, which is a real filter and
    // must not be swallowed by the falsy check above.
    if (groupId) where.group_id = groupId;
    else if (String(query.group_id) === '0') where.group_id = null;

    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { mobile: { [Op.like]: `%${search}%` } },
            { company: { [Op.like]: `%${search}%` } },
        ];
    }

    const { rows, count } = await EventGuest.findAndCountAll({
        where,
        include: GUEST_INCLUDE,
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset: (page - 1) * limit,
        distinct: true,
    });

    return {
        rows: rows.map(present),
        pagination: {
            page, limit, totalItems: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
        },
    };
};

/** The five tiles on the Guests screen. */
const getGuestStats = async (clientId, query = {}) => {
    const where = { website_client_id: clientId };
    const eventId = Number(query.event_id) || null;
    // Same split as listGuests (§572): the tiles must count the same rows the
    // list below them shows, or the Guests screen reports participants it is
    // not displaying.
    const scope = String(query.scope || (eventId ? 'participants' : 'guests')).toLowerCase();
    if (eventId) where.event_id = eventId;
    else if (scope === 'guests') where.event_id = null;
    else if (scope === 'participants') where.event_id = { [Op.ne]: null };

    const guests = await EventGuest.findAll({
        where,
        attributes: ['rsvp_status', 'party_size', 'invite_source'],
    });

    const counts = { accepted: 0, pending: 0, declined: 0, not_responded: 0, invited: 0 };
    let heads = 0;
    let imported = 0;

    for (const guest of guests) {
        counts[guest.rsvp_status] = (counts[guest.rsvp_status] || 0) + 1;
        // Heads, not rows: one invitation covering a family of four is four
        // people at the venue, which is what "Total Guests" means to a caterer.
        heads += Number(guest.party_size) || 1;
        if (guest.invite_source === 'import') imported += 1;
    }

    const total = guests.length;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    // The tab groups invited with not-responded, so the tile must agree with it.
    const awaiting = counts.not_responded + counts.invited;

    return {
        total_guests: heads,
        total_rows: total,
        accepted: counts.accepted,
        accepted_pct: pct(counts.accepted),
        pending: counts.pending,
        pending_pct: pct(counts.pending),
        declined: counts.declined,
        declined_pct: pct(counts.declined),
        not_responded: awaiting,
        not_responded_pct: pct(awaiting),
        imported,
    };
};

const getGuestById = async (clientId, guestId) => {
    const guest = await EventGuest.findOne({
        where: { id: guestId, website_client_id: clientId },
        include: GUEST_INCLUDE,
    });
    return guest ? present(guest) : null;
};

/**
 * One plan limit for a host, read from the HOST's CURRENT plan.
 *
 * It used to read the plan the EVENT was created under, so an event made on a
 * bigger plan kept that plan's cap after the client moved to Free (§558).
 *
 * Order matters (§566): `website_clients.subscription_plan_id` is the
 * entitlement pointer (see clientBilling's header) and is read FIRST. The
 * subscription row came first in §563 and that was wrong on production: client
 * #26's subscription row still pointed at plan 8, a Free plan soft-deleted in
 * the plan reset, whose limit reads as "unlimited" — while the pointer and the
 * event both said plan 12 (Free, 5). A plan that no longer exists is skipped,
 * never treated as unlimited.
 */
const planLimitFor = async (event, key, transaction) => {
    const [host, sub] = await Promise.all([
        WebsiteClient.findByPk(event.website_client_id, { attributes: ['id', 'subscription_plan_id'], transaction }),
        ClientSubscription.findOne({
            where: { website_client_id: event.website_client_id },
            attributes: ['id', 'subscription_plan_id'],
            order: [['created_at', 'DESC']],
            transaction,
        }),
    ]);

    if (!subscriptionPlanService.LIMIT_KEYS.includes(key)) return null;

    const candidates = [host?.subscription_plan_id, sub?.subscription_plan_id, event.subscription_plan_id]
        .map(Number).filter(Boolean);
    for (const planId of candidates) {
        // Paranoid model: a soft-deleted plan comes back null and is skipped.
        const plan = await SubscriptionPlan.findByPk(planId, { attributes: ['id', key], transaction });
        if (!plan) continue;
        // Read from THIS row, not a second lookup: re-querying outside the
        // transaction returned the committed value and ignored a limit changed
        // in the same transaction.
        const n = Number(plan[key]);
        return Number.isInteger(n) && n > 0 ? n : null;
    }
    return null;
};

/**
 * Guests currently on the HOST's account. Soft-deleted rows are excluded by the
 * paranoid model, so removing a guest gives the place back (§569).
 */
const guestLimitFor = (event, transaction) => planLimitFor(event, 'max_guests_per_event', transaction);

/**
 * ── GUESTS vs PARTICIPANTS ───────────────────────────────────────────────────
 * One table, two roles, told apart by `event_id` (§572):
 *
 *   event_id NULL  GUEST        a contact in the client's phone book. Belongs
 *                               to the account, never to an event.
 *   event_id SET   PARTICIPANT  somebody attending that event — they scanned
 *                               its QR. May or may not also be in the phone
 *                               book; a stranger who scanned is neither less
 *                               nor more valid.
 *
 * An invitation is SHARED (a QR, a WhatsApp message) — it writes nothing, so a
 * guest is never linked to an event by being invited. Only scanning does that.
 *
 * `max_guests_per_event` counts the phone book; `max_rsvp_per_event` counts
 * participants of one event. Two questions, two numbers.
 */
const PHONE_BOOK = { event_id: null };

/** Phone-book contacts on the account. Participants are NOT counted here. */
const countHostGuests = (hostId, transaction) =>
    EventGuest.count({ where: { website_client_id: hostId, ...PHONE_BOOK }, transaction });

/**
 * Refuse when adding `adding` guests would take the ACCOUNT past its plan's
 * guest limit. The limit is one total across every event, not a number per
 * event (§569) — a guest is a person on the client's list, not a row that
 * belongs to one event. Counts ROWS, not heads (§558).
 *
 * `eventId` only says whose account this is. Pass a transaction to lock the
 * host row: without it two quick saves both read "9 of 10" and both insert.
 */
const assertGuestCapacity = async (hostId, adding = 1, { transaction, message } = {}) => {
    if (transaction) {
        await WebsiteClient.findByPk(hostId, {
            attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE,
        });
    }

    const maxGuests = await guestLimitFor({ website_client_id: hostId, subscription_plan_id: null }, transaction);
    if (maxGuests === null) return;

    const used = await countHostGuests(hostId, transaction);
    if (used + adding > maxGuests) {
        const left = Math.max(0, maxGuests - used);
        throw ApiError.badRequest(
            message ?? (left === 0
                ? `Your plan allows ${maxGuests} guest${maxGuests === 1 ? '' : 's'} in total and you have reached that limit. Please upgrade your plan to add more guests.`
                : `Your plan allows ${maxGuests} guests in total and you can add only ${left} more. Please add fewer guests or upgrade your plan.`)
        );
    }
};

/**
 * PARTICIPANT cap (§578): how many people may JOIN one event, against the
 * plan's `max_rsvp_per_event` — "Max RSVP per event" and "max participants"
 * are the same number.
 *
 * Checked at the DOOR, when somebody would become a participant (a QR join, or
 * a row filed against an event), not when they answer. The earlier rule counted
 * only YES answers (§565), which let anyone in and then refused their answer —
 * a participant who had joined could not submit an RSVP, and the list showed
 * more people than the plan allows. Once someone is in, their answer is theirs
 * to give.
 *
 * Counts participant ROWS (people who joined), not party size. Soft-deleted
 * rows are excluded, so removing a participant frees the place. Pass a
 * transaction to lock the event row: two scans at once must not both take the
 * last place.
 */
const countParticipants = (eventId, transaction) =>
    EventGuest.count({ where: { event_id: eventId }, transaction });

const participantLimitFor = async (eventId, transaction) => {
    const event = await Event.findByPk(eventId, {
        attributes: ['id', 'website_client_id', 'subscription_plan_id'],
        transaction,
        lock: transaction ? transaction.LOCK.UPDATE : undefined,
    });
    if (!event) return null;
    return planLimitFor(event, 'max_rsvp_per_event', transaction);
};

/** { limit, used, full } for one event — for the QR screens to warn early. */
const getParticipantStatus = async (eventId) => {
    const limit = await participantLimitFor(eventId);
    const used = await countParticipants(eventId);
    return { limit, used, full: limit !== null && used >= limit };
};

const assertParticipantCapacity = async (eventId, adding = 1, { transaction, message } = {}) => {
    if (!eventId || adding <= 0) return;
    const max = await participantLimitFor(eventId, transaction);
    if (max === null) return;

    const used = await countParticipants(eventId, transaction);
    if (used + adding > max) {
        const left = Math.max(0, max - used);
        throw ApiError.badRequest(
            message ?? (left === 0
                ? `This event has reached its limit of ${max} participant${max === 1 ? '' : 's'}. Please upgrade your plan to allow more.`
                : `This event can take only ${left} more participant${left === 1 ? '' : 's'} (limit ${max}). Please add fewer or upgrade your plan.`)
        );
    }
};

/**
 * Guest capacity for the Add Guest gate — the guest twin of `events_used` on
 * /client/event-options. One TOTAL for the account (§569), counted exactly as
 * assertGuestCapacity counts it, so the portal blocks at the number the save
 * would be refused at. `events` is per-event information only; it no longer
 * decides anything.
 */
const getGuestCapacity = async (clientId) => {
    const events = await Event.findAll({
        where: { website_client_id: clientId },
        attributes: ['id', 'name', 'website_client_id', 'subscription_plan_id'],
        order: [['start_date', 'ASC']],
    });

    const limit = await guestLimitFor({ website_client_id: clientId, subscription_plan_id: null });
    const used = await countHostGuests(clientId);

    // Participants per event — information for the screens, not a limit.
    const counts = events.length
        ? await EventGuest.findAll({
            where: { event_id: { [Op.in]: events.map((e) => e.id) } },
            attributes: ['event_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'used']],
            group: ['event_id'],
            raw: true,
        })
        : [];
    const usedBy = new Map(counts.map((c) => [Number(c.event_id), Number(c.used)]));

    return {
        limit,
        used,
        full: limit !== null && used >= limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
        events: events.map((e) => ({ event_id: e.id, name: e.name, used: usedBy.get(e.id) || 0 })),
    };
};

/**
 * Add a guest.
 *
 * A duplicate email on the SAME event is refused; the same person on two
 * different events is entirely normal and allowed.
 */
const createGuest = async (clientId, companyId, body) => {
    const data = await normalise(clientId, body, { partial: false });

    // Same mobile twice on the same event — or twice on the general list — is a
    // duplicate (the phone number is the key, since email is optional). The same person on two different events is normal.
    const clash = await EventGuest.findOne({
        where: { website_client_id: clientId, event_id: data.event_id ?? null, mobile: data.mobile },
        attributes: ['id', 'name'],
    });
    if (clash) {
        throw ApiError.conflict(`${clash.name} is already on your guest list${data.event_id ? ' for this event' : ''}.`);
    }

    // Fall back to the default group when the form left it blank — that is what
    // "New guests will be added to this group by default" means.
    if (data.group_id === undefined) {
        const fallback = await EventGuestGroup.findOne({
            where: { website_client_id: clientId, is_default: 1 },
            attributes: ['id'],
        });
        if (fallback) data.group_id = fallback.id;
    }

    // Plan limit (see assertGuestCapacity) — checked and inserted under one
    // lock on the event row, so a double-click cannot slip a 6th guest past 5.
    const guest = await sequelize.transaction(async (transaction) => {
        if (data.event_id) {
            // Filed against an event → a participant, limited by Max RSVP.
            await assertParticipantCapacity(data.event_id, 1, { transaction });
        } else {
            // A phone-book contact → limited by Max Guests.
            await assertGuestCapacity(clientId, 1, { transaction });
        }
        return EventGuest.create({
            ...data,
            website_client_id: clientId,
            company_id: companyId ?? null,
        }, { transaction });
    });

    // Fire and forget — a failed feed row must never fail a guest that saved.
    notifications.notify(clientId, {
        type: 'guest_added',
        title: 'New guest added',
        body: `${guest.name} was added to your guest list.`,
        eventId: guest.event_id,
        guestId: guest.id,
        companyId: companyId ?? null,
        link: `/dashboard/guests/${guest.id}`,
    });

    // Trigger Welcome Invitation (respects client portal on/off toggle)
    notificationTrigger.triggerWelcomeInvitation({
        eventId: guest.event_id,
        guest,
        companyId: companyId ?? null,
    }).catch((err) => {
        console.error('[createGuest] Welcome invitation trigger error:', err.message);
    });

    return getGuestById(clientId, guest.id);
};

const updateGuest = async (clientId, guestId, body) => {
    const guest = await EventGuest.findOne({
        where: { id: guestId, website_client_id: clientId },
    });
    if (!guest) return null;

    const data = await normalise(clientId, body, { partial: true, existing: guest.toJSON() });

    if (data.mobile || data.event_id !== undefined) {
        const clash = await EventGuest.findOne({
            where: {
                website_client_id: clientId,
                event_id: (data.event_id !== undefined ? data.event_id : guest.event_id) ?? null,
                mobile: data.mobile ?? guest.mobile,
                id: { [Op.ne]: guest.id },
            },
            attributes: ['id', 'name'],
        });
        if (clash) {
            throw ApiError.conflict(`${clash.name} is already on the guest list for this event.`);
        }
    }

    /*
      The RSVP notification fires on the TRANSITION, not on every save.
      Comparing before and after is the only way to tell "they just accepted"
      from "somebody edited their table number and they had already accepted" —
      without it the feed fills with duplicates every time a guest row is
      touched.
    */
    // Moving onto an event makes this row a participant there — the participant
    // cap applies (§578). Answering, or changing party size, is never limited:
    // the check happened when they joined.
    const moving = data.event_id !== undefined && Number(data.event_id || 0) !== Number(guest.event_id || 0);

    const before = guest.response_type;
    await sequelize.transaction(async (transaction) => {
        if (moving && data.event_id) {
            await assertParticipantCapacity(Number(data.event_id), 1, { transaction });
        }
        await guest.update(data, { transaction });
    });
    const after = guest.response_type;

    if (after !== before && ['yes', 'no', 'maybe'].includes(after)) {
        const verb = after === 'yes' ? 'accepted' : after === 'no' ? 'declined' : 'tentatively replied to';
        notifications.notify(clientId, {
            type: after === 'yes' ? 'rsvp_accepted' : after === 'no' ? 'rsvp_declined' : 'rsvp_maybe',
            title: 'New RSVP received',
            body: `${guest.name} ${verb} your invitation.`,
            eventId: guest.event_id,
            guestId: guest.id,
            companyId: guest.company_id ?? null,
            link: `/dashboard/guests/${guest.id}`,
            meta: { response: after, email: guest.email, mobile: guest.mobile },
        });
    }

    return getGuestById(clientId, guestId);
};

const deleteGuest = async (clientId, guestId) => {
    const guest = await EventGuest.findOne({
        where: { id: guestId, website_client_id: clientId },
    });
    if (!guest) return false;
    await guest.destroy();
    return true;
};

/**
 * The list screen's checkbox column, made useful.
 *
 * One statement per action rather than a loop of saves — a 200-row selection
 * would otherwise be 200 round trips.
 */
const bulkUpdate = async (clientId, guestIds, action, value) => {
    const ids = [...new Set((Array.isArray(guestIds) ? guestIds : []).map(Number).filter(Boolean))];
    if (ids.length === 0) throw ApiError.badRequest('No guests selected.');
    if (ids.length > 500) throw ApiError.badRequest('Select 500 guests or fewer at a time.');

    const scope = { website_client_id: clientId, id: { [Op.in]: ids } };

    if (action === 'delete') {
        const affected = await EventGuest.destroy({ where: scope });
        return { action, affected };
    }

    if (action === 'group') {
        const groupId = value === null || value === '' ? null : Number(value);
        if (groupId) {
            const group = await EventGuestGroup.findOne({
                where: { id: groupId, website_client_id: clientId }, attributes: ['id'],
            });
            if (!group) throw ApiError.badRequest('That guest group is not on your account.');
        }
        const [affected] = await EventGuest.update({ group_id: groupId }, { where: scope });
        return { action, affected };
    }

    if (action === 'status') {
        const status = String(value || '').toLowerCase();
        if (!RSVP_STATUSES.includes(status)) throw ApiError.badRequest('Invalid RSVP status.');
        // Keep response in step with status, the same way applyResponse does
        // for a single guest — a bulk change must not create the contradiction
        // the per-guest path is careful to avoid.
        const response = status === 'accepted' ? 'yes'
            : status === 'declined' ? 'no'
                : status === 'pending' ? 'maybe' : 'none';

        const [affected] = await EventGuest.update(
            {
                rsvp_status: status,
                response_type: response,
                responded_at: response === 'none' ? null : new Date(),
            },
            { where: scope }
        );
        return { action, affected };
    }

    throw ApiError.badRequest('Unknown bulk action.');
};

/**
 * The Relationship and Food Preference dropdowns for the host's guest form.
 *
 * ── WHY THIS EXISTS RATHER THAN REUSING THE ADMIN ROUTES ────────────────────
 * `/guest-relationship-options` and `/guest-food-preference-options` sit behind
 * the admin JWT and `hasPermission`, so a website client gets 401 from both —
 * the same reason `/client/media/proxy` and the client avatar uploader exist.
 *
 * ── AND WHY NOT REUSE `resolveInvite` ───────────────────────────────────────
 * That one answers for somebody holding a QR token, which a host does not have
 * for their own event. Same two catalogues, same category scoping; different
 * caller, so a different door.
 *
 * Scoped by the EVENT's category, because the catalogues are: a wedding offers
 * "Bride's Father", a corporate event offers "Delegate". The event is looked up
 * through `website_client_id`, so a host can only ask about their own.
 */
const getGuestFormOptions = async (clientId, rawEventId) => {
    // Event optional (§570): with none, the category-less default lists apply.
    const eventId = Number(rawEventId) || null;
    const event = eventId
        ? await Event.findOne({
            where: { id: eventId, website_client_id: clientId },
            attributes: ['id', 'event_category_id'],
        })
        : null;
    if (eventId && !event) throw ApiError.notFound('Event not found.');
    const categoryId = event?.event_category_id ?? null;

    const [relationships, foods] = await Promise.all([
        relationshipOptions.listForCategory(categoryId, 1),
        foodOptions.listForCategory(categoryId, 1),
    ]);

    return {
        relationship_options: relationships.map((r) => ({ id: r.id, name: r.name })),
        food_preference_options: foods.map((r) => ({ id: r.id, name: r.name })),
        genders: GENDERS,
    };
};

module.exports = {
    WRITABLE_FIELDS,
    RSVP_STATUSES,
    RESPONSE_TYPES,
    getGuestFormOptions,
    listGuests,
    getGuestStats,
    getGuestById,
    createGuest,
    updateGuest,
    deleteGuest,
    bulkUpdate,
    present,
    composeName,
    applyResponse,
    assertGuestCapacity,
    guestLimitFor,
    getGuestCapacity,
    assertParticipantCapacity,
    getParticipantStatus,
};

