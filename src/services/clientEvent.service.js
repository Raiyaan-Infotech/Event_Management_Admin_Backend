const {
    Sequelize,
    sequelize,
    Event,
    WebsiteClient,
    SubscriptionPlan,
    EventGuest,
    EventGuestGroup,
    EventCategory,
    EventMenu,
    EventTemplate,
    FrameStyle,
    Decoration,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const eventQr = require('../utils/eventQr');
const clientPortalService = require('./clientPortal.service');
const mediaService = require('./media.service');
const subscriptionPlanService = require('./subscriptionPlan.service');

/**
 * Events belonging to a signed-in website client.
 *
 * ── TWO RULES THIS FILE EXISTS TO ENFORCE ────────────────────────────────────
 *
 * 1. OWNERSHIP COMES FROM THE SESSION, NEVER THE BODY.
 *    `website_client_id`, `vendor_id`, `company_id` and `subscription_plan_id`
 *    are read off the authenticated client row. A request that POSTs them is
 *    ignored — `WRITABLE_FIELDS` does not contain them, so there is no path by
 *    which a client can file an event under another tenant.
 *
 * 2. THE PLAN IS THE GATEKEEPER, ON WRITE AS WELL AS ON READ.
 *    `/client/event-options` already narrows what the wizard may OFFER, but a
 *    hand-rolled POST bypasses the UI entirely. Every taxonomy id and every
 *    menu id on the way in is checked back against that same plan-scoped set,
 *    so the API grants exactly what the UI shows and not one row more.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The only fields a client may set. Everything about ownership and every QR
 * column is absent on purpose.
 *
 * Whitelists in this codebase have failed twice by omission rather than by
 * being too broad (a field silently dropped with no error), so this list is
 * kept in the same order as the wizard steps that fill it.
 */
const WRITABLE_FIELDS = [
    // Category only: event type and religion were removed from the project.
    'event_category_id',
    'name', 'host_one', 'host_two', 'tagline', 'description',
    'start_date', 'end_date', 'start_time', 'end_time', 'timezone',
    'venue_name', 'venue_address',
    'organizer', 'contact_phone', 'contact_email', 'footer_note',
    'privacy', 'status',
    'menu_ids',
    'theme_id', 'primary_color',
    'cover_image',
    'components', 'component_order',
];

/**
 * The invitation components a template can offer, and therefore the only keys a
 * per-event override may name.
 *
 * Kept in the canonical order the admin panel stores, so an override that
 * supplies no order at all still renders in the order everything else uses.
 * MUST match COMPONENT_KEYS in eventTemplate.service.js — an unknown key is
 * dropped rather than stored, so a typo silently does nothing instead of
 * writing a component nothing will ever render.
 */
const COMPONENT_KEYS = [
    'event_title', 'host_names', 'date_time', 'venue', 'event_qr_code', 'organizer',
    'event_photos', 'contact_details', 'invitation_message', 'social_icons',
    'footer_note', 'decoration_elements',
];

const PRIVACY_VALUES = ['private', 'public', 'unlisted'];
const STATUS_VALUES = ['draft', 'upcoming', 'cancelled'];

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** The form's <input type="time"> gives HH:MM; a re-read row gives HH:MM:SS. */
const TIME_ONLY = /^\d{2}:\d{2}(:\d{2})?$/;

/** What the list and detail endpoints join in. Kept in one place so every
 *  endpoint answers the same shape — the §178 lesson, where a single shared
 *  include meant the action endpoints needed no extra work. */
const EVENT_INCLUDE = [
    { model: SubscriptionPlan, as: 'plan', attributes: ['id', 'name', 'plan_code'], required: false },
    { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color', 'icon'], required: false },
];

/**
 * Whether an event reads as draft / cancelled / past / live / upcoming.
 *
 * NONE of past, live or upcoming is a stored status — they are this function,
 * and only this function. Storing them would need a nightly job to flip rows
 * and would leave a window where the database disagrees with the calendar;
 * deriving them means an event goes live and then ends exactly when it should.
 *
 * A draft or cancelled event stays draft or cancelled after its date: those are
 * statements about the event, not about the clock.
 *
 *   ended already ............ past      (the UI calls this "Completed")
 *   started, not yet ended ... live
 *   not started .............. upcoming
 *   no dates at all .......... upcoming  — an event with nothing filled in is
 *                                          not "happening now"
 */
const todayString = () => {
    // Built from local parts, never toISOString(). An event must not tick over
    // to "past" at 05:30 local because UTC has already rolled the date.
    const today = new Date();
    return [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
    ].join('-');
};

const deriveStatus = (event) => {
    if (event.status === 'draft' || event.status === 'cancelled') return event.status;

    // A one-day event fills only start_date; each end falls back to the other.
    const start = event.start_date || event.end_date;
    const end = event.end_date || event.start_date;
    if (!start && !end) return 'upcoming';

    // Compare date STRINGS, not Date objects. These are DATEONLY columns, and
    // parsing one into a Date drags the server's timezone into a value that
    // never had one — which is how an event goes past a few hours early.
    const today = todayString();
    if (String(end) < today) return 'past';
    if (String(start) <= today) return 'live';
    return 'upcoming';
};

/** The row as the portal reads it: joins flattened, derived status attached. */
const present = (event) => {
    const plain = event.toJSON ? event.toJSON() : event;
    return {
        ...plain,
        menu_ids: Array.isArray(plain.menu_ids) ? plain.menu_ids : [],
        derived_status: deriveStatus(plain),
    };
};

/** Trim a string field, mapping '' to null so an empty box is not stored as ''. */
const str = (value, max) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return trimmed.slice(0, max);
};

/**
 * Validate and normalise one submitted body against the client's plan.
 *
 * Throws ApiError.badRequest on the first problem, with a message written for
 * the person filling the form rather than for a log.
 */
const normalise = async (clientId, body, { partial = false } = {}) => {
    // The same call the wizard's dropdowns were populated from. Re-running it
    // here is what makes the check authoritative: if the plan changed between
    // the form loading and the submit, the submit is judged against the plan as
    // it is NOW.
    const options = await clientPortalService.getEventOptions(clientId);

    if (!options.plan) {
        throw ApiError.badRequest(
            options.reason || 'No subscription plan is assigned to your account yet.'
        );
    }

    const data = {};
    const picked = {};
    for (const field of WRITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, field)) picked[field] = body[field];
    }

    const has = (field) => Object.prototype.hasOwnProperty.call(picked, field);
    const required = (field) => !partial || has(field);

    // ── Step 1 — category, checked against the plan's own scope ─────────────
    const allowedCategories = new Set(options.categories.map((r) => r.id));

    if (required('event_category_id')) {
        const id = Number(picked.event_category_id);
        if (!id) throw ApiError.badRequest('Please select an event category.');
        if (!allowedCategories.has(id)) {
            throw ApiError.badRequest('That event category is not included in your subscription plan.');
        }
        data.event_category_id = id;
    }

    // ── Step 2 — details ────────────────────────────────────────────────────
    if (required('name')) {
        const name = str(picked.name, 200);
        if (!name) throw ApiError.badRequest('Please enter an event name.');
        data.name = name;
    }
    if (has('tagline')) data.tagline = str(picked.tagline, 150);
    if (has('description')) data.description = str(picked.description, 5000);
    if (has('venue_name')) data.venue_name = str(picked.venue_name, 255);
    if (has('venue_address')) data.venue_address = str(picked.venue_address, 500);
    if (has('timezone')) data.timezone = str(picked.timezone, 80);

    // The invitation's own detail fields. Each backs a template component; all
    // are optional, because a template that switches the component off has no
    // use for the value and should not force one.
    if (has('host_one')) data.host_one = str(picked.host_one, 120);
    if (has('host_two')) data.host_two = str(picked.host_two, 120);
    if (has('organizer')) data.organizer = str(picked.organizer, 200);
    if (has('footer_note')) data.footer_note = str(picked.footer_note, 300);

    if (has('contact_phone')) {
        const value = str(picked.contact_phone, 30);
        // Deliberately permissive: digits plus the punctuation international
        // numbers actually use. Anything stricter rejects a legitimate number
        // from some country, and this is printed on an invitation rather than
        // dialled by the system.
        if (value && !/^[\d\s+()-]{6,30}$/.test(value)) {
            throw ApiError.badRequest('Please enter a valid contact number.');
        }
        data.contact_phone = value;
    }

    if (has('contact_email')) {
        const value = str(picked.contact_email, 150);
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            throw ApiError.badRequest('Please enter a valid contact email address.');
        }
        data.contact_email = value;
    }

    for (const field of ['start_date', 'end_date']) {
        if (!required(field)) continue;
        const value = str(picked[field], 10);
        if (!value) throw ApiError.badRequest('Please fill in the event start and end dates.');
        if (!DATE_ONLY.test(value)) throw ApiError.badRequest('Dates must be in YYYY-MM-DD format.');
        data[field] = value;
    }

    for (const field of ['start_time', 'end_time']) {
        if (!required(field)) continue;
        const value = str(picked[field], 8);
        if (!value) throw ApiError.badRequest('Please fill in the event start and end times.');
        if (!TIME_ONLY.test(value)) throw ApiError.badRequest('Times must be in HH:MM format.');
        // Normalise HH:MM to HH:MM:SS so a stored value and a re-submitted one
        // compare equal instead of looking like an edit.
        data[field] = value.length === 5 ? `${value}:00` : value;
    }

    if (data.start_date && data.end_date && data.end_date < data.start_date) {
        throw ApiError.badRequest('The end date cannot be before the start date.');
    }

    if (has('privacy')) {
        const value = String(picked.privacy || '').toLowerCase();
        if (!PRIVACY_VALUES.includes(value)) throw ApiError.badRequest('Invalid event privacy.');
        data.privacy = value;
    }

    if (has('status')) {
        const value = String(picked.status || '').toLowerCase();
        // 'past' is deliberately not accepted: it is derived, and letting it be
        // set would create rows whose stored status contradicts their dates.
        if (!STATUS_VALUES.includes(value)) throw ApiError.badRequest('Invalid event status.');
        data.status = value;
    }

    // ── Step 3 — menus, checked against what the plan grants ────────────────
    if (has('menu_ids')) {
        const allowedMenus = new Set(options.menus.map((m) => m.id));
        const raw = Array.isArray(picked.menu_ids) ? picked.menu_ids : [];
        const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

        const forbidden = ids.filter((id) => !allowedMenus.has(id));
        if (forbidden.length) {
            throw ApiError.badRequest('One or more selected menus are not included in your subscription plan.');
        }

        // A menu tagged for another category does not belong on this event (the
        // wizard hides those). Menus carry a category only; NULL = suits all.
        // Checked only when the category is in this request, so a partial update
        // that leaves the taxonomy alone is not judged against a guess.
        if (data.event_category_id) {
            const byId = new Map(options.menus.map((m) => [m.id, m]));
            const offScope = ids.filter((id) => {
                const cat = byId.get(id).event_category_id;
                return cat && Number(cat) !== Number(data.event_category_id);
            });
            if (offScope.length) {
                throw ApiError.badRequest('One or more selected menus do not match the event category.');
            }
        }
        data.menu_ids = ids;
    }

    // ── Step 4 — design ─────────────────────────────────────────────────────
    if (has('theme_id')) {
        const value = str(picked.theme_id, 64);
        // The theme catalogue is a frontend constant, so the backend validates
        // the SHAPE rather than the membership — hardcoding the list here would
        // mean a new theme needs a backend deploy.
        if (value && !SLUG.test(value)) throw ApiError.badRequest('Invalid theme.');
        data.theme_id = value;
    }

    if (has('primary_color')) {
        const value = str(picked.primary_color, 9);
        if (value && !HEX_COLOR.test(value)) {
            throw ApiError.badRequest('Primary colour must be a hex value like #2457D6.');
        }
        data.primary_color = value;
    }

    // The event's own photo — a URL `uploadCoverImage` returned. Only a stored
    // upload is accepted (absolute http(s), or our own root-relative /uploads
    // path), so the field cannot be pointed at `javascript:` or a data URI
    // that every app and portal would then render. Null clears it.
    if (has('cover_image')) {
        const value = str(picked.cover_image, 500);
        if (value && !/^(https?:\/\/|\/uploads\/)/i.test(value)) {
            throw ApiError.badRequest('Invalid event image.');
        }
        data.cover_image = value;
    }

    /**
     * ── The client's per-event component override ───────────────────────────
     *
     * NULL means "inherit from the template", so an explicit null is accepted
     * and is how the UI resets back to the template's own design. Anything else
     * is normalised to a full 0/1 map over the known keys, because a partial
     * map would leave the reader guessing whether a missing key means off or
     * inherit — and those are different answers.
     *
     * Unknown keys are DROPPED rather than rejected: the catalogue can gain a
     * component, and an older client sending a stale key should not have its
     * whole save fail over a field it cannot render anyway.
     */
    if (has('components')) {
        const raw = picked.components;
        if (raw === null || raw === undefined || raw === '') {
            data.components = null;
        } else if (typeof raw !== 'object' || Array.isArray(raw)) {
            throw ApiError.badRequest('Invalid invitation component settings.');
        } else {
            const map = {};
            for (const key of COMPONENT_KEYS) {
                // Absent means ON, matching how every renderer reads a template's
                // own map — a key that was never stored is not "switched off".
                map[key] = raw[key] === undefined ? 1 : (Number(raw[key]) ? 1 : 0);
            }
            data.components = map;
        }
    }

    if (has('component_order')) {
        const raw = picked.component_order;
        if (raw === null || raw === undefined || raw === '') {
            data.component_order = null;
        } else if (!Array.isArray(raw)) {
            throw ApiError.badRequest('Invalid invitation component order.');
        } else {
            // De-duplicated, unknown keys dropped, then anything the client
            // omitted appended in canonical order — so the stored order is
            // always the complete list and a renderer never has to guess where
            // a missing component belongs.
            const seen = [];
            for (const key of raw) {
                if (COMPONENT_KEYS.includes(key) && !seen.includes(key)) seen.push(key);
            }
            data.component_order = [...seen, ...COMPONENT_KEYS.filter((k) => !seen.includes(k))];
        }
    }

    return { data, plan: options.plan };
};

/**
 * Create an event and issue its QR code.
 *
 * Both halves run in ONE transaction. The QR payload needs the event id, which
 * only exists after the insert — so without the transaction a failure between
 * the two steps would leave an event with no code, which every downstream
 * reader would then have to handle.
 */
const createEvent = async (clientId, body) => {
    const client = await WebsiteClient.findByPk(clientId);
    if (!client) throw ApiError.notFound('Account not found.');

    const { data, plan } = await normalise(clientId, body, { partial: false });

    // Plan limit — see LIMIT_FIELDS in subscriptionPlan.service.js. Checked
    // against the client's CURRENT plan (same one `normalise` just validated the
    // rest of the body against), not the plan any existing event was created under.
    const maxEvents = await subscriptionPlanService.getPlanLimit(plan.id, 'max_events');
    if (maxEvents !== null) {
        const eventCount = await Event.count({ where: { website_client_id: client.id } });
        if (eventCount >= maxEvents) {
            throw ApiError.badRequest(
                `Your plan allows a maximum of ${maxEvents} event${maxEvents === 1 ? '' : 's'}. Please upgrade your plan to create more.`
            );
        }
    }

    const created = await sequelize.transaction(async (transaction) => {
        const event = await Event.create(
            {
                ...data,
                // Ownership from the session, not from the body. Nothing the
                // caller sent can reach these four columns.
                website_client_id: client.id,
                vendor_id: client.vendor_id,
                company_id: client.company_id ?? null,
                subscription_plan_id: client.subscription_plan_id ?? null,
            },
            { transaction }
        );

        const token = eventQr.issueToken(event);
        await event.update(
            {
                qr_token: token,
                qr_version: eventQr.QR_VERSION,
                qr_issued_at: new Date(),
            },
            { transaction }
        );

        return event;
    });

    return getEventById(clientId, created.id);
};

/**
 * One event, scoped to its owner.
 *
 * The `website_client_id` in the WHERE is what makes an id from another
 * client's account a 404 rather than a read — the id alone is guessable.
 */
const getEventById = async (clientId, eventId, opts = {}) => {
    const event = await Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        include: EVENT_INCLUDE,
    });
    if (!event) return null;
    return presentOne(event, opts);
};

/**
 * What a guest may NOT read on an event they were invited to.
 *
 * `website_client_id` and `subscription_plan_id` are the two fields
 * `clientEvent.controller.js` already names as the reason its `decodeQr` sits
 * behind a session; `plan` is the host's billing tier by another name, and
 * `qr_token` is the capability that admits somebody to the event — a guest
 * holds their own copy already, but the server should not be the thing that
 * hands out a second one.
 */
const HOST_ONLY_FIELDS = [
    'website_client_id',
    'subscription_plan_id',
    'plan',
    'qr_token',
    'qr_issued_at',
];

/**
 * One event as a PARTICIPANT may read it, falling back to the owner read.
 *
 * `getEventById` alone answers 404 for a guest, because the event belongs to
 * the host and `website_client_id` is the host's id — so every event-scoped
 * screen was blank for anyone who joined by QR rather than creating the event.
 *
 * Membership is the guest row itself: `participant_client_id` is set only by
 * the join flow, which is gated on an OTP-verified number and a QR token that
 * decrypts. It is NOT `website_client_id` — that column names the host, and
 * reading it here would let every guest read every event of their own host.
 */
const getEventForViewer = async (clientId, eventId, opts = {}) => {
    /*
      ── ONE READ OF THE EVENT, AUTHORISED IN JS ────────────────────────
      This used to read the event owner-scoped, and then — for a guest, which is
      who the mobile app mostly is — read the guest row and read the event AGAIN
      unscoped: three serial round trips before any presentation work began. The
      event row and the membership row do not depend on each other, so they are
      fetched together and the ownership decision is made here. A guest open is
      two round trips instead of three, and an owner open pays nothing in time
      (the membership probe rides alongside).

      The rule is unchanged and still explicit: the event is returned ONLY to its
      owner, or to someone with a guest row naming them as the participant.
      `participant_client_id` is set only by the join flow, which is gated on an
      OTP-verified number and a QR token that decrypts. It is NOT
      `website_client_id` — that column names the HOST, and reading it here would
      let every guest read every event of their own host.
    */
    const [event, membership] = await Promise.all([
        Event.findOne({ where: { id: eventId }, include: EVENT_INCLUDE }),
        EventGuest.findOne({
            where: { event_id: eventId, participant_client_id: clientId },
            // relationship / group: only to decide viewerIsFamily below — never
            // sent to the client. See `familyCategoryOf`.
            attributes: ['id', 'relationship'],
            include: [{ model: EventGuestGroup, as: 'group', attributes: ['name'], required: false }],
        }),
    ]);

    if (!event) return null;

    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (!isOwner && !membership) return null;
    const viewerIsFamily = !isOwner && isFamilyCategory(membership.relationship, membership.group?.name);

    const presented = await presentOne(event, { ...opts, isOwner, viewerIsFamily });
    if (!isOwner) {
        for (const field of HOST_ONLY_FIELDS) delete presented[field];
    }
    /*
      Whether THIS caller owns the event, stated outright.

      The app cannot work it out for itself: `website_client_id` is the field
      that would answer it and it is stripped just above, precisely because a
      guest may not read it. Without this flag every client had to assume it was
      the host, so a guest was shown Edit and Delete controls that the server
      then refused — the guest list scopes writes by `website_client_id`, which
      is the host's id, so a participant's call matches no row.

      Safe to send: it tells the caller something about themselves that they
      already know, and names nobody else.
    */
    presented.is_owner = isOwner;
    return presented;
};

/**
 * The shared tail of both reads: menus resolved and the design attached.
 *
 * ── `menus` IS GATED BY THE PLAN AS IT IS NOW ───────────────────────────────
 * `menu_ids` is what was chosen when the event was saved and is returned
 * untouched (the portal's edit form reads it). `menus` — what the event SHOWS —
 * is those ids narrowed to what the owner's plan grants today on the caller's
 * platform (`opts.platform`, 'website' | 'mobile'). So:
 *   - a menu the admin removes from the plan disappears from existing events
 *   - a web-only menu never reaches the app
 *   - adding the menu back to the plan brings it back, because nothing was
 *     deleted from the event.
 */
/**
 * Menus whose SCREEN is the host's guest register under another name.
 *
 * All three read `GET /client/guests`, which the server scopes to the caller's
 * own `website_client_id` — so for somebody who merely joined the event they
 * answer with an empty list, correctly and permanently. The app still drew the
 * tiles, because a tile comes from the HOST's plan (see the block in
 * `presentOne` below) and nothing narrowed that by who is asking: an invited
 * guest got Guests, Family and Participants, all three blank, no way to act on
 * any of them, and no explanation.
 *
 * Not a column on `event_menus` on purpose: "needs the owner's guest register"
 * is a fact about what these three SCREENS read, not a property an admin
 * should be able to toggle per menu in Menu Management.
 */
// The host's private guest register — mobiles, emails, notes included.
// `family` and `participants` used to be here too; both now have their own
// guest-safe directory (familyDirectory / participantsDirectory) and their
// own gate in the loop below, because "may see the tile" differs per slug —
// family needs the viewer's own row to be family-tagged, participants needs
// only that the viewer is a guest at all (reaching this function as a
// non-owner already proves that — see getEventForViewer).
const HOST_ONLY_MENU_SLUGS = new Set(['guests']);

/**
 * The app's own three Family sub-tabs (Family / Relative / Close Friend),
 * mirrored EXACTLY from `EventGuest.familyCategory` in
 * `lib/data/repositories/guest_repository.dart` — same keyword lists, same
 * fallback order. Kept in lock step on purpose: this is what decides whether
 * a GUEST (not the host) gets the Family tile at all (see `presentOne`), and
 * a mismatch would mean a guest sees a tile the app's own tabs then can't
 * place them in, or the reverse — a family member denied the tile.
 *
 * `relationship` is admin-authored free text ("Bride's Mother", "Best Man");
 * `groupName` is the client's own guest group name. Neither is sensitive —
 * both are already shown on the row itself.
 */
const familyCategoryOf = (relationship, groupName) => {
    const categoryOf = (label) => {
        const text = String(label || '').toLowerCase();
        if (!text) return 'other';
        if (text.includes('friend')) return 'closeFriend';
        if (text.includes('relative')) return 'relative';
        if (['family', 'father', 'mother', 'brother', 'sister', 'grand', 'uncle', 'aunt', 'cousin']
            .some((k) => text.includes(k))) return 'family';
        return 'other';
    };
    const fromText = categoryOf(relationship || groupName);
    if (fromText === 'other' && String(groupName || '').trim().toLowerCase() === 'family') {
        return 'family';
    }
    return fromText;
};

const isFamilyCategory = (relationship, groupName) =>
    familyCategoryOf(relationship, groupName) !== 'other';

/**
 * `isOwner` — whether the CALLER hosts this event. Defaults to true because
 * the two owner-scoped readers (`getEventById`, the portal) cannot be anything
 * else; `getEventForViewer` and the wishlist pass the real answer.
 *
 * `viewerIsFamily` — whether a non-owner CALLER's own guest row is itself
 * tagged Family / Relative / Close Friend. Gates the `family` tile only: a
 * guest with no such tag has no more business reading who else is family than
 * reading the full guest register does (`HOST_ONLY_MENU_SLUGS`). Irrelevant
 * when `isOwner` is true.
 */
const presentOne = async (event, { platform = 'website', isOwner = true, viewerIsFamily = false } = {}) => {
    const presented = present(event);

    const grantedIds = await clientPortalService.ownerGrantedMenuIds(presented.website_client_id, platform);
    const granted = new Set(grantedIds);
    const visibleIds = presented.menu_ids.map(Number).filter((id) => granted.has(id));

    /*
      ── EVENT FEATURES + APP FEATURES IN ONE QUERY ──────────────────────
      Resolve the menu names for the ids stored on the row. Done here rather
      than through an association because menu_ids is a JSON array — see the
      model comment for why it is not a join table.

      EVENT FEATURES are the event's own selection, narrowed by the plan.
      APP FEATURES are mobile-only and are NOT chosen per event: the host's plan
      granting them on MOBILE is the whole rule, so every event of that host
      shows them without its menu_ids having to list them. `portal` rows count
      when the plan also grants them on mobile (Guests is one menu for both
      surfaces). See apply-app-feature-menus.js.

      These were two sequential `findAll`s over the same table with disjoint
      groups — now ONE round trip, partitioned in JS. The design and the guest
      stats do not depend on the menus or on each other either, so all three go
      together instead of three-deep. On the event-open path that is three
      round trips saved, ~200–374ms each in production.
    */
    const wantsApp = platform === 'mobile' && grantedIds.length > 0;
    const menuIdsToRead = [...new Set([...visibleIds, ...(wantsApp ? grantedIds : [])])];

    const [menuRows] = await Promise.all([
        menuIdsToRead.length
            ? EventMenu.findAll({
                where: {
                    id: { [Op.in]: menuIdsToRead },
                    is_active: 1,
                },
                // name / icon / color / sort_order: the app draws its Explore
                // tiles straight from these (Menu Management is the source of
                // the label, icon and order — nothing about a tile is hardcoded).
                attributes: ['id', 'name', 'slug', 'menu_group', 'icon', 'color', 'sort_order'],
                order: [['sort_order', 'ASC'], ['id', 'ASC']],
                raw: true,
            })
            : [],
        // Same design block the list attaches, so the detail screen and the
        // card it was opened from cannot disagree about what the invitation
        // looks like.
        attachDesign([presented], presented.company_id ?? null),
        guestStatsFor(presented.id).then((stats) => { presented.stats = stats; }),
    ]);

    const visible = new Set(visibleIds);
    const eventFeatures = [];
    const appFeatures = [];
    for (const row of menuRows) {
        // The groups are disjoint, so a row lands in exactly one bucket and the
        // two buckets keep the order they were concatenated in before. Ordering
        // inside each is still the query's (sort_order, id).
        if (row.menu_group === 'app' || row.menu_group === 'portal') {
            if (!wantsApp) continue;
            if (!isOwner) {
                // See HOST_ONLY_MENU_SLUGS: this opens the host's guest
                // register, which answers a participant with an empty list.
                if (HOST_ONLY_MENU_SLUGS.has(row.slug)) continue;
                // Family opens a directory of OTHER family members, which only
                // makes sense to somebody who is one.
                if (row.slug === 'family' && !viewerIsFamily) continue;
                // `participants` needs no extra check: reaching this function
                // as a non-owner already proves the viewer joined the event.
            }
            appFeatures.push(row);
        } else if (visible.has(Number(row.id))) {
            eventFeatures.push(row);
        }
    }

    presented.menus = [...eventFeatures, ...appFeatures];

    return presented;
};

/**
 * The app's Event Info tiles: Invited Guests / Guests Joined / Invitations Sent.
 *
 *   invited_guests    guest ROWS on the event — one invitation each, however
 *                     many people it covers (the portal's "Total Invitations")
 *   guests_joined     rows with `participant_client_id` — the guest opened the
 *                     app and joined by QR, not merely listed by the host
 *   invitations_sent  `event_messages` of kind `invite` that actually left
 *                     (`sent`/`delivered`). Counted from the send log, NOT from
 *                     `event_guests.invited_at`: the QR join stamps that too,
 *                     with nothing sent.
 *
 * ONE round trip of three sub-selects rather than three queries — production
 * is ~370ms a query, and this runs on every event open.
 *
 * Null on failure, never a thrown error: a count is decoration on the event,
 * and the app shows "—" rather than losing the whole screen.
 */
const guestStatsFor = async (eventId) => {
    try {
        const [row] = await sequelize.query(
            `SELECT
                (SELECT COUNT(*) FROM event_guests
                  WHERE event_id = :id AND deleted_at IS NULL) AS invited_guests,
                (SELECT COUNT(*) FROM event_guests
                  WHERE event_id = :id AND deleted_at IS NULL
                    AND participant_client_id IS NOT NULL) AS guests_joined,
                (SELECT COUNT(*) FROM event_messages
                  WHERE event_id = :id AND deleted_at IS NULL
                    AND kind = 'invite' AND status IN ('sent', 'delivered')) AS invitations_sent`,
            { replacements: { id: eventId }, type: Sequelize.QueryTypes.SELECT },
        );
        return {
            invited_guests: Number(row?.invited_guests) || 0,
            guests_joined: Number(row?.guests_joined) || 0,
            invitations_sent: Number(row?.invitations_sent) || 0,
        };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[clientEvent] guest stats not computed', { event_id: eventId, error: err.message });
        return null;
    }
};

/**
 * The SQL half of `deriveStatus`, for the three date-derived buckets.
 *
 * These have to be expressed twice — once in JS for a row already loaded, once
 * in SQL so the LIST can filter and paginate in the database. Paginating in
 * JS would mean fetching every event to show six of them.
 *
 * COALESCE both ways round so a one-day event, which fills only `start_date`,
 * still lands in a bucket instead of being dropped by a NULL comparison. The
 * IS NOT NULL guard keeps a dateless row out of `live` and `past` — matching
 * the JS, which calls it upcoming.
 */
const DATE_BUCKET_SQL = {
    past:
        '(`Event`.`start_date` IS NOT NULL OR `Event`.`end_date` IS NOT NULL) AND ' +
        'COALESCE(`Event`.`end_date`, `Event`.`start_date`) < CURDATE()',
    live:
        '(`Event`.`start_date` IS NOT NULL OR `Event`.`end_date` IS NOT NULL) AND ' +
        'COALESCE(`Event`.`end_date`, `Event`.`start_date`) >= CURDATE() AND ' +
        'COALESCE(`Event`.`start_date`, `Event`.`end_date`) <= CURDATE()',
    upcoming:
        '(`Event`.`start_date` IS NULL AND `Event`.`end_date` IS NULL) OR ' +
        'COALESCE(`Event`.`start_date`, `Event`.`end_date`) > CURDATE()',
};

/**
 * What the Filter menu's Sort options mean.
 *
 * A whitelist rather than a column name off the query string: letting the
 * caller name the ORDER BY column is how an ordering parameter turns into an
 * injection point. `id` is the tiebreak in every one of them, so two events
 * sharing a date never swap places between page loads.
 */
const SORT_ORDERS = {
    date_asc: [['start_date', 'ASC'], ['id', 'ASC']],
    date_desc: [['start_date', 'DESC'], ['id', 'DESC']],
    name_asc: [['name', 'ASC'], ['id', 'ASC']],
    name_desc: [['name', 'DESC'], ['id', 'DESC']],
    created_desc: [['created_at', 'DESC'], ['id', 'DESC']],
};

/**
 * Soonest-first when looking forward, most recent first otherwise.
 *
 * A "what's next" list sorted newest-first puts the furthest-away event on top,
 * which is backwards for the only question that list answers.
 */
const defaultOrder = (status) =>
    status === 'upcoming' || status === 'live' ? SORT_ORDERS.date_asc : SORT_ORDERS.date_desc;


/**
 * Attach each event's DESIGN so a client can draw the invitation.
 *
 * ── WHY THE LIST NEEDS THIS ─────────────────────────────────────────────────
 * An event stores only `theme_id` (the template's `code`) and `primary_color`.
 * Everything that makes an invitation look like itself — background, frame
 * artwork, decorations, fonts — lives on `event_templates`. Without this, a list
 * row can draw a coloured rectangle and nothing else, which is exactly the
 * §277 gap: the admin drew an arch and a toran while the client got a flat
 * swatch, and it read as a styling bug rather than a missing SELECT.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * THREE queries for the whole page, not three per row: templates, then frames
 * and decorations resolved in one round each. At ~374ms per round trip to
 * production, per-row lookups on a 12-row page would be twenty seconds.
 *
 * ── theme_id MAY NOT BE A TEMPLATE AT ALL ───────────────────────────────────
 * It also holds legacy built-in slugs (`floral-bliss`) from before the admin
 * catalogue existed, and a code whose template was since deleted. Both resolve
 * to `design: null`, which the client renders as its own fallback rather than
 * as an error — an old event keeps working.
 */
const TEMPLATE_DESIGN_ATTRS = [
    'id', 'code', 'name', 'orientation', 'layout_style',
    'background_type', 'background_color', 'background_image',
    'gradient_from', 'gradient_via', 'gradient_to', 'gradient_type', 'gradient_direction',
    'overlay_enabled', 'overlay_color', 'overlay_opacity',
    'secondary_color', 'primary_font', 'secondary_font', 'border_style',
    'frame_style_id', 'decoration_ids',
];

const attachDesign = async (rows, companyId) => {
    const codes = [...new Set(rows.map((r) => r.theme_id).filter(Boolean))];
    if (!codes.length) {
        for (const row of rows) row.design = null;
        return rows;
    }

    const templates = await EventTemplate.findAll({
        where: {
            code: { [Op.in]: codes },
            ...(companyId ? { company_id: companyId } : {}),
        },
        attributes: TEMPLATE_DESIGN_ATTRS,
        raw: true,
    });

    const frameIds = [...new Set(templates.map((t) => t.frame_style_id).filter(Boolean))];
    const decoIds = [...new Set(templates.flatMap((t) => t.decoration_ids ?? []))];

    const [frames, decos] = await Promise.all([
        frameIds.length
            ? FrameStyle.findAll({
                where: { id: frameIds, is_active: 1 },
                attributes: ['id', 'name', 'file_url'],
                raw: true,
            })
            : [],
        decoIds.length
            ? Decoration.findAll({
                where: { id: decoIds, is_active: 1 },
                attributes: ['id', 'name', 'type', 'file_url'],
                raw: true,
            })
            : [],
    ]);

    const frameById = new Map(frames.map((f) => [f.id, f]));
    const decoById = new Map(decos.map((d) => [d.id, d]));

    const byCode = new Map(
        templates.map((t) => {
            // Same field names the existing preview components already read, so
            // nothing has to be re-mapped on the client.
            const { frame_style_id: frameId, decoration_ids: decoList, ...rest } = t;
            return [t.code, {
                ...rest,
                frame_url: frameById.get(frameId)?.file_url ?? null,
                decorationItems: (decoList ?? [])
                    .map((id) => decoById.get(id))
                    .filter(Boolean),
            }];
        })
    );

    for (const row of rows) row.design = byCode.get(row.theme_id) ?? null;
    return rows;
};

/**
 * The client's events, filtered the way the My Events tabs filter them.
 *
 * `past`, `live` and `upcoming` cannot be plain WHERE clauses, because none of
 * them is stored — each translates into a date comparison plus "not a draft and
 * not cancelled". `published` means everything a guest could see: anything that
 * is neither a draft nor cancelled, whatever its dates.
 */
const listEvents = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 12));
    const status = String(query.status || 'all').toLowerCase();
    const search = String(query.search || '').trim();
    const categoryId = Number(query.category_id) || null;
    const privacy = String(query.privacy || '').toLowerCase();
    const sort = String(query.sort || '').toLowerCase();

    const where = { website_client_id: clientId };

    if (status === 'draft' || status === 'cancelled') {
        where.status = status;
    } else if (status === 'published') {
        where.status = 'upcoming';
    } else if (DATE_BUCKET_SQL[status]) {
        where.status = 'upcoming';
        where[Op.and] = [Sequelize.literal(`(${DATE_BUCKET_SQL[status]})`)];
    }

    // Plan-gated on the way IN, so no membership check is needed here: an id
    // outside the plan simply matches nothing this client owns.
    if (categoryId) where.event_category_id = categoryId;

    // Whitelisted, not passed through. An unrecognised value is ignored rather
    // than reaching the query, so a junk filter shows everything instead of
    // erroring or, worse, matching nothing and reading as "you have no events".
    if (PRIVACY_VALUES.includes(privacy)) where.privacy = privacy;

    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { tagline: { [Op.like]: `%${search}%` } },
            { venue_name: { [Op.like]: `%${search}%` } },
        ];
    }

    const { rows, count } = await Event.findAndCountAll({
        where,
        include: EVENT_INCLUDE,
        order: SORT_ORDERS[sort] ?? defaultOrder(status),
        limit,
        offset: (page - 1) * limit,
        distinct: true,
    });

    return {
        rows: await attachDesign(rows.map(present), rows[0]?.company_id ?? null),
        pagination: {
            page,
            limit,
            totalItems: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
        },
    };
};

/**
 * The four dashboard tiles.
 *
 * Guests and RSVPs are reported as 0 with `available: false` beside them: there
 * is no guest table in this system yet, and a tile that silently shows 0 is
 * indistinguishable from a tile whose real answer is 0. The flag lets the UI
 * say which it is instead of guessing.
 */
const getDashboardStats = async (clientId) => {
    const events = await Event.findAll({
        where: { website_client_id: clientId },
        attributes: ['id', 'status', 'start_date', 'end_date'],
    });

    const counts = { total: events.length, upcoming: 0, live: 0, past: 0, draft: 0, cancelled: 0 };
    let upcomingSoon = 0;

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    // Local parts again, for the same reason as todayString().
    const horizonStr = [
        horizon.getFullYear(),
        String(horizon.getMonth() + 1).padStart(2, '0'),
        String(horizon.getDate()).padStart(2, '0'),
    ].join('-');

    for (const event of events) {
        const derived = deriveStatus(event);
        counts[derived] = (counts[derived] || 0) + 1;
        if (derived === 'upcoming') {
            const start = event.start_date ? String(event.start_date) : null;
            if (start && start <= horizonStr) upcomingSoon += 1;
        }
    }

    return {
        total_events: counts.total,
        // Everything a guest could see. Live, upcoming and completed alike are
        // published; only a draft and a cancellation are not.
        published_events: counts.live + counts.upcoming + counts.past,
        live_events: counts.live,
        upcoming_events: counts.upcoming,
        past_events: counts.past,
        draft_events: counts.draft,
        cancelled_events: counts.cancelled,
        upcoming_next_30_days: upcomingSoon,
        // No guest module exists. Reported honestly rather than omitted, so the
        // tiles the design calls for can render and say which kind of zero this
        // is — `guests_available: false` is what the UI reads to label them.
        total_guests: 0,
        rsvps_received: 0,
        rsvp_going: 0,
        rsvp_pending: 0,
        rsvp_declined: 0,
        // The list/dashboard tiles still read the event tables only; the
        // guest-backed figures live on /events/analytics.
        guests_available: false,
    };
};

/**
 * Analytics over the client's own events.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT RETURN ───────────────────────────────────
 * Guests, RSVPs, message sends, open rates and click rates. There is no guest
 * table and no client-messaging table in this system — `company_templates` and
 * the `mail*` tables belong to the Website Builder and the vendor portal, not
 * to a client's event. Rather than invent those numbers, the payload carries
 * `guests_available` / `messaging_available` as false and the UI states it.
 *
 * Everything that IS here is a real aggregate over the `events` table.
 *
 * Computed in JS rather than as five GROUP BY queries: three of the groupings
 * key off `deriveStatus`, which is a date comparison the DB would have to
 * re-express, and a client owns tens of events, not millions. One SELECT beats
 * five round trips — at ~374ms each against production (§103) that is the
 * difference between instant and noticeable.
 */
const getAnalytics = async (clientId, query = {}) => {
    const months = Math.min(24, Math.max(3, Number(query.months) || 6));

    const events = await Event.findAll({
        where: { website_client_id: clientId },
        attributes: [
            'id', 'name', 'status', 'start_date', 'end_date', 'created_at',
            'privacy', 'theme_id', 'menu_ids', 'event_category_id',
        ],
        include: [
            { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color'], required: false },
        ],
        order: [['start_date', 'DESC'], ['id', 'DESC']],
    });

    const byStatus = { live: 0, upcoming: 0, past: 0, draft: 0, cancelled: 0 };
    const byPrivacy = { private: 0, public: 0, unlisted: 0 };
    const categoryCounts = new Map();
    const themeCounts = new Map();
    const menuCounts = new Map();

    for (const event of events) {
        byStatus[deriveStatus(event)] += 1;
        if (byPrivacy[event.privacy] !== undefined) byPrivacy[event.privacy] += 1;

        const categoryName = event.category?.name || 'Uncategorised';
        const existing = categoryCounts.get(categoryName) || { name: categoryName, color: event.category?.color || null, count: 0 };
        existing.count += 1;
        categoryCounts.set(categoryName, existing);

        const theme = event.theme_id || 'unset';
        themeCounts.set(theme, (themeCounts.get(theme) || 0) + 1);

        for (const menuId of Array.isArray(event.menu_ids) ? event.menu_ids : []) {
            menuCounts.set(menuId, (menuCounts.get(menuId) || 0) + 1);
        }
    }

    // A dense month axis — built from the calendar, not from the data. Deriving
    // it from the rows would silently drop empty months and draw a trend line
    // that skips from March to June as though they were adjacent.
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            label: d.toLocaleString('en', { month: 'short' }),
            year: d.getFullYear(),
            created: 0,
            scheduled: 0,
        });
    }
    const bucketByKey = new Map(buckets.map((b) => [b.key, b]));

    for (const event of events) {
        const created = event.created_at ? new Date(event.created_at) : null;
        if (created) {
            const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
            const bucket = bucketByKey.get(key);
            if (bucket) bucket.created += 1;
        }
        // start_date is a DATEONLY string; slicing beats parsing it into a Date,
        // which would apply the server's timezone to a value that has none.
        if (event.start_date) {
            const bucket = bucketByKey.get(String(event.start_date).slice(0, 7));
            if (bucket) bucket.scheduled += 1;
        }
    }

    const menuIds = [...menuCounts.keys()];
    const menuRows = menuIds.length
        ? await EventMenu.findAll({ where: { id: { [Op.in]: menuIds } }, attributes: ['id', 'name'] })
        : [];
    const menuNames = new Map(menuRows.map((m) => [m.id, m.name]));

    const published = byStatus.live + byStatus.upcoming + byStatus.past;

    /**
     * Period-over-period, for the tiles' delta line.
     *
     * Only CREATION has an honest delta. "Completed" and "Upcoming" are
     * point-in-time counts — comparing them across periods would compare two
     * snapshots taken at different times, which is not a trend, and dressing
     * that up with a green arrow would be inventing a claim.
     *
     * The window is the same `months` the timeline uses, compared against the
     * `months` immediately before it.
     */
    const periodStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const previousStart = new Date(now.getFullYear(), now.getMonth() - (months * 2 - 1), 1);

    let createdThisPeriod = 0;
    let createdPreviousPeriod = 0;
    for (const event of events) {
        if (!event.created_at) continue;
        const at = new Date(event.created_at);
        if (at >= periodStart) createdThisPeriod += 1;
        else if (at >= previousStart) createdPreviousPeriod += 1;
    }

    // Growth from zero is not "infinity percent" — it is reported as null and
    // the UI says "no prior activity" rather than printing ∞ or a bare 100%.
    const changePct = createdPreviousPeriod === 0
        ? null
        : Math.round(((createdThisPeriod - createdPreviousPeriod) / createdPreviousPeriod) * 1000) / 10;

    const busiest = buckets.reduce(
        (best, b) => (b.scheduled > (best?.scheduled ?? 0) ? b : best),
        null
    );

    return {
        period: {
            months,
            created_this_period: createdThisPeriod,
            created_previous_period: createdPreviousPeriod,
            created_change_pct: changePct,
            busiest_month: busiest && busiest.scheduled > 0
                ? { label: busiest.label, year: busiest.year, count: busiest.scheduled }
                : null,
        },
        totals: {
            total_events: events.length,
            published_events: published,
            live_events: byStatus.live,
            upcoming_events: byStatus.upcoming,
            past_events: byStatus.past,
            draft_events: byStatus.draft,
            cancelled_events: byStatus.cancelled,
            // Of everything published, how much has already happened. Guarded:
            // a client with nothing published would otherwise divide by zero and
            // report NaN, which renders as a blank tile rather than a 0.
            completion_rate: published ? Math.round((byStatus.past / published) * 1000) / 10 : 0,
        },
        by_status: Object.entries(byStatus).map(([key, count]) => ({ key, count })),
        by_privacy: Object.entries(byPrivacy).map(([key, count]) => ({ key, count })),
        by_category: [...categoryCounts.values()].sort((a, b) => b.count - a.count),
        by_theme: [...themeCounts.entries()]
            .map(([theme_id, count]) => ({ theme_id, count }))
            .sort((a, b) => b.count - a.count),
        top_menus: [...menuCounts.entries()]
            .map(([id, count]) => ({ id, name: menuNames.get(id) || `Menu #${id}`, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6),
        timeline: buckets,
        recent_events: events.slice(0, 5).map((event) => ({
            id: event.id,
            name: event.name,
            start_date: event.start_date,
            theme_id: event.theme_id,
            derived_status: deriveStatus(event),
            category: event.category?.name || null,
            menu_count: Array.isArray(event.menu_ids) ? event.menu_ids.length : 0,
        })),
    };
};

/** Soft-delete, scoped to the owner. */
const deleteEvent = async (clientId, eventId) => {
    const event = await Event.findOne({ where: { id: eventId, website_client_id: clientId } });
    if (!event) return false;
    await event.destroy();
    return true;
};

/**
 * Update an event, then REISSUE its QR code.
 *
 * The payload is a snapshot of the event's details, so leaving the old token in
 * place would make a scan report the pre-edit name and dates. Reissuing means
 * any code printed before the edit stops matching what is stored — correct, but
 * worth knowing before printing invitations early.
 */
const updateEvent = async (clientId, eventId, body) => {
    const event = await Event.findOne({ where: { id: eventId, website_client_id: clientId } });
    if (!event) return null;

    const { data } = await normalise(clientId, body, { partial: true });

    await sequelize.transaction(async (transaction) => {
        await event.update(data, { transaction });
        await event.update(
            {
                qr_token: eventQr.issueToken(event),
                qr_version: eventQr.QR_VERSION,
                qr_issued_at: new Date(),
            },
            { transaction }
        );
    });

    return getEventById(clientId, eventId);
};

/**
 * Decrypt a scanned QR string.
 *
 * The token is self-contained — the ids it carries came out of the ciphertext,
 * not out of a lookup — but the live row is joined on top when it still exists,
 * so a scanner sees the CURRENT event rather than only the snapshot taken when
 * the code was issued. `payload` and `event` are returned side by side so the
 * caller can tell the two apart.
 */
const resolveQrToken = async (token) => {
    const payload = eventQr.decrypt(token);
    if (!payload) return null;

    const expanded = eventQr.expandPayload(payload);
    if (!expanded.event_id) return { payload: expanded, event: null };

    const event = await Event.findOne({
        where: { id: expanded.event_id },
        include: EVENT_INCLUDE,
    });

    return { payload: expanded, event: event ? present(event) : null };
};

/**
 * Store an event's cover photo and return its URL.
 *
 * Uploaded on pick, before the event is saved — the wizard's final step then
 * sends the URL as `cover_image`, the same shape as the splash-screen uploader.
 * Not tied to an event id for that reason: a new event has no id yet.
 */
const uploadCoverImage = async (companyId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');

    const result = await mediaService.upload(file, { folder: 'event-covers' }, companyId || 1);
    if (!result || !result.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: result.url };
};


/* ── Wishlist ────────────────────────────────────────────────────────────────
 *
 * The client's hearted events, stored as an array of ids in
 * `website_clients.favourite_events` (see the model, and
 * tools/apply-event-wishlist.js for why a JSON column rather than a table).
 *
 * ⚠ THE STORED IDS ARE INPUT, NOT AUTHORITY.
 * They are whatever the client sent, so nothing here may fetch an event just
 * because its id is in the list. Both functions re-apply the SAME rule
 * [getEventForViewer] uses — the caller owns the event, or has a guest row
 * naming them as the participant. Without that, hearting id 1, 2, 3… would be
 * a way to read every event on the platform.
 */

/** Ids the client has hearted, normalised: positive ints, no duplicates. */
const readWishlistIds = (client) => {
    const raw = client?.favourite_events;
    const list = Array.isArray(raw) ? raw : [];
    return [...new Set(
        list
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0),
    )].slice(0, 500); // a bounded list cannot be used to stuff the row
};

/**
 * Every event the client may still see, out of the ones they hearted.
 *
 * Ids that no longer resolve — the event was deleted, or they were removed as
 * a guest — are dropped from the RESPONSE but deliberately left in the column.
 * A transient read failure must not quietly empty somebody's wishlist; the
 * only thing that removes an id is the client un-hearting it.
 */
const getWishlist = async (clientId, { platform = 'website' } = {}) => {
    const client = await WebsiteClient.findByPk(clientId, {
        attributes: ['id', 'favourite_events'],
    });
    if (!client) return [];

    const ids = readWishlistIds(client);
    if (ids.length === 0) return [];

    // Two queries, not one per id: the events, and the caller's guest rows on
    // them. Production is ~374ms per round trip (see the prod-latency note), so
    // a per-id loop here would take seconds on a list of twenty.
    const [events, memberships] = await Promise.all([
        Event.findAll({ where: { id: { [Op.in]: ids } }, include: EVENT_INCLUDE }),
        EventGuest.findAll({
            where: { event_id: { [Op.in]: ids }, participant_client_id: clientId },
            // relationship / group: only to decide viewerIsFamily below, same
            // as getEventForViewer — see `familyCategoryOf`.
            attributes: ['event_id', 'relationship'],
            include: [{ model: EventGuestGroup, as: 'group', attributes: ['name'], required: false }],
        }),
    ]);

    const membershipByEvent = new Map(memberships.map((m) => [Number(m.event_id), m]));
    const joined = new Set(membershipByEvent.keys());

    const visible = events.filter((event) => (
        Number(event.website_client_id) === Number(clientId)
        || joined.has(Number(event.id))
    ));

    // Presented in the order the client hearted them, not the order MySQL
    // happened to return rows in.
    const order = new Map(ids.map((id, index) => [id, index]));
    visible.sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0));

    return Promise.all(visible.map(async (event) => {
        const isOwner = Number(event.website_client_id) === Number(clientId);
        const membership = membershipByEvent.get(Number(event.id));
        const viewerIsFamily = !isOwner && !!membership
            && isFamilyCategory(membership.relationship, membership.group?.name);
        const presented = await presentOne(event, { platform, isOwner, viewerIsFamily });
        if (!isOwner) {
            for (const field of HOST_ONLY_FIELDS) delete presented[field];
        }
        return { ...presented, wishlisted: true };
    }));
};

/**
 * Heart or un-heart one event. Returns the new state.
 *
 * ADDING is authorised, removing is not: you may always take something off
 * your own list, even an event you can no longer see — otherwise a stale id
 * would be stuck there forever with no way to clear it.
 */
const setWishlisted = async (clientId, eventId, wishlisted) => {
    const id = Number(eventId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(400, 'A valid event id is required');
    }

    const client = await WebsiteClient.findByPk(clientId);
    if (!client) throw new ApiError(404, 'Client not found');

    const ids = readWishlistIds(client);

    if (wishlisted) {
        const [event, membership] = await Promise.all([
            Event.findOne({ where: { id }, attributes: ['id', 'website_client_id'] }),
            EventGuest.findOne({
                where: { event_id: id, participant_client_id: clientId },
                attributes: ['id'],
            }),
        ]);

        // Same answer for "does not exist" and "not yours": a 404 that only
        // fired for real events would confirm which ids exist.
        const isOwner = event && Number(event.website_client_id) === Number(clientId);
        if (!event || (!isOwner && !membership)) {
            throw new ApiError(404, 'Event not found');
        }

        if (!ids.includes(id)) ids.push(id);
    } else {
        const at = ids.indexOf(id);
        if (at !== -1) ids.splice(at, 1);
    }

    await client.update({ favourite_events: ids });
    return { event_id: id, wishlisted: Boolean(wishlisted), count: ids.length };
};

module.exports = {
    WRITABLE_FIELDS,
    uploadCoverImage,
    deriveStatus,
    isFamilyCategory,
    createEvent,
    getEventById,
    getEventForViewer,
    listEvents,
    getDashboardStats,
    getAnalytics,
    updateEvent,
    deleteEvent,
    resolveQrToken,
    getWishlist,
    setWishlisted,
    readWishlistIds,
};
