const {
    Sequelize,
    sequelize,
    Event,
    EventGuest,
    EventGuestGroup,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');

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
const WRITABLE_FIELDS = [
    'event_id', 'group_id',
    'title', 'first_name', 'last_name', 'email', 'dial_code', 'mobile', 'whatsapp',
    'company', 'table_number', 'party_size',
    'rsvp_status', 'response_type', 'invite_source',
    'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
    'dietary_preference', 'special_requirements', 'plus_one', 'plus_one_count',
    'custom_answers', 'notes',
];

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

    // ── Event: must be one of the client's own ─────────────────────────────
    if (required('event_id')) {
        const eventId = Number(picked.event_id);
        if (!eventId) throw ApiError.badRequest('Please select an event.');
        const event = await Event.findOne({
            where: { id: eventId, website_client_id: clientId },
            attributes: ['id'],
        });
        // Scoped lookup, not a plain findByPk — otherwise a guest could be
        // filed against another client's event by id.
        if (!event) throw ApiError.badRequest('That event is not on your account.');
        data.event_id = eventId;
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

    if (data.first_name !== undefined || data.last_name !== undefined) {
        data.name = composeName(
            data.first_name ?? existing?.first_name,
            data.last_name !== undefined ? data.last_name : existing?.last_name,
            existing?.name
        );
    }

    if (required('email')) {
        const email = str(picked.email, 255);
        if (!email) throw ApiError.badRequest('Please enter the guest’s email address.');
        if (!EMAIL.test(email)) throw ApiError.badRequest('Please enter a valid email address.');
        data.email = email.toLowerCase();
    }

    if (has('dial_code')) data.dial_code = str(picked.dial_code, 8);
    // Digits, +, spaces and dashes only — a pasted "(+91) 98765-43210" is fine,
    // a name in the phone box is not.
    for (const field of ['mobile', 'whatsapp']) {
        if (!has(field)) continue;
        const value = str(picked[field], 20);
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
        special_requirements: 500, notes: 500,
    };
    for (const [field, max] of Object.entries(optional)) {
        if (has(field)) data[field] = str(picked[field], max);
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
    if (eventId) where.event_id = eventId;

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
 * Add a guest.
 *
 * A duplicate email on the SAME event is refused; the same person on two
 * different events is entirely normal and allowed.
 */
const createGuest = async (clientId, companyId, body) => {
    const data = await normalise(clientId, body, { partial: false });

    const clash = await EventGuest.findOne({
        where: { website_client_id: clientId, event_id: data.event_id, email: data.email },
        attributes: ['id', 'name'],
    });
    if (clash) {
        throw ApiError.conflict(`${clash.name} is already on the guest list for this event.`);
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

    const guest = await EventGuest.create({
        ...data,
        website_client_id: clientId,
        company_id: companyId ?? null,
    });

    return getGuestById(clientId, guest.id);
};

const updateGuest = async (clientId, guestId, body) => {
    const guest = await EventGuest.findOne({
        where: { id: guestId, website_client_id: clientId },
    });
    if (!guest) return null;

    const data = await normalise(clientId, body, { partial: true, existing: guest.toJSON() });

    if (data.email || data.event_id) {
        const clash = await EventGuest.findOne({
            where: {
                website_client_id: clientId,
                event_id: data.event_id ?? guest.event_id,
                email: data.email ?? guest.email,
                id: { [Op.ne]: guest.id },
            },
            attributes: ['id', 'name'],
        });
        if (clash) {
            throw ApiError.conflict(`${clash.name} is already on the guest list for this event.`);
        }
    }

    await guest.update(data);
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

module.exports = {
    WRITABLE_FIELDS,
    RSVP_STATUSES,
    RESPONSE_TYPES,
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
};
