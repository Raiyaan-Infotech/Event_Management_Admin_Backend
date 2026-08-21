const {
    Sequelize,
    sequelize,
    Event,
    WebsiteClient,
    SubscriptionPlan,
    EventCategory,
    EventType,
    Religion,
    EventMenu,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const eventQr = require('../utils/eventQr');
const clientPortalService = require('./clientPortal.service');

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
    'event_category_id', 'event_type_id', 'religion_id',
    'name', 'tagline', 'description',
    'start_date', 'end_date', 'start_time', 'end_time', 'timezone',
    'venue_name', 'venue_address',
    'privacy', 'status',
    'menu_ids',
    'theme_id', 'primary_color',
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
    { model: EventType, as: 'eventType', attributes: ['id', 'name', 'color', 'icon'], required: false },
    { model: Religion, as: 'religion', attributes: ['id', 'name'], required: false },
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

    // ── Step 1 — taxonomy, checked against the plan's own scope ─────────────
    const allowedCategories = new Set(options.categories.map((r) => r.id));
    const allowedTypes = new Set(options.types.map((r) => r.id));
    const allowedReligions = new Set(options.religions.map((r) => r.id));

    if (required('event_category_id')) {
        const id = Number(picked.event_category_id);
        if (!id) throw ApiError.badRequest('Please select an event category.');
        if (!allowedCategories.has(id)) {
            throw ApiError.badRequest('That event category is not included in your subscription plan.');
        }
        data.event_category_id = id;
    }

    if (required('event_type_id')) {
        const id = Number(picked.event_type_id);
        if (!id) throw ApiError.badRequest('Please select an event type.');
        if (!allowedTypes.has(id)) {
            throw ApiError.badRequest('That event type is not included in your subscription plan.');
        }
        // The type must also sit under the chosen category. A plan scoped to
        // "all" returns every type, so without this a valid-looking pair could
        // still be a category and a type that have nothing to do with each other.
        const type = options.types.find((t) => t.id === id);
        const categoryId = data.event_category_id;
        if (categoryId && type?.event_category_id && type.event_category_id !== categoryId) {
            throw ApiError.badRequest('That event type does not belong to the selected category.');
        }
        data.event_type_id = id;
    }

    if (has('religion_id')) {
        // Optional on the form — '' and null both mean "not applicable".
        const raw = picked.religion_id;
        if (raw === '' || raw === null || raw === undefined) {
            data.religion_id = null;
        } else {
            const id = Number(raw);
            if (!id || !allowedReligions.has(id)) {
                throw ApiError.badRequest('That religion is not included in your subscription plan.');
            }
            data.religion_id = id;
        }
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

    const { data } = await normalise(clientId, body, { partial: false });

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
const getEventById = async (clientId, eventId) => {
    const event = await Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        include: EVENT_INCLUDE,
    });
    if (!event) return null;

    const presented = present(event);

    // Resolve the menu names for the ids stored on the row. Done here rather
    // than through an association because menu_ids is a JSON array — see the
    // model comment for why it is not a join table.
    presented.menus = presented.menu_ids.length
        ? (await EventMenu.findAll({
            where: { id: { [Op.in]: presented.menu_ids }, is_active: 1 },
            attributes: ['id', 'name', 'slug', 'menu_group'],
            order: [['sort_order', 'ASC'], ['id', 'ASC']],
        })).map((m) => m.toJSON())
        : [];

    return presented;
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
        rows: rows.map(present),
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
            'privacy', 'theme_id', 'menu_ids', 'event_category_id', 'event_type_id',
        ],
        include: [
            { model: EventCategory, as: 'category', attributes: ['id', 'name', 'color'], required: false },
            { model: EventType, as: 'eventType', attributes: ['id', 'name'], required: false },
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

module.exports = {
    WRITABLE_FIELDS,
    deriveStatus,
    createEvent,
    getEventById,
    listEvents,
    getDashboardStats,
    getAnalytics,
    updateEvent,
    deleteEvent,
    resolveQrToken,
};
