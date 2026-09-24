const {
    Sequelize,
    sequelize,
    Event,
    GuestGroup,
    Guest,
    WebsiteClient,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const notifications = require('./clientNotification.service');
// The same two catalogues the guest's own registration form reads — see
// getGuestFormOptions for why the host cannot go through the admin routes.
const relationshipOptions = require('./guestRelationshipOption.service');
const foodOptions = require('./guestFoodPreferenceOption.service');
const {
    PERSON_FIELDS,
    composeName,
    mobileKey,
    normalisePerson,
    planLimitFor,
} = require('./guestFields');

/**
 * Guests = the client's PHONE BOOK (`guests`, §581).
 *
 * The client adds the people they know, organises them in groups, and SHARES
 * an event's invitation with them. Sharing writes nothing — a guest is never
 * attached to an event by being invited. Somebody who scans the QR becomes a
 * PARTICIPANT (`event_participants`, see clientParticipant.service), linked back here
 * by `guest_id` when their mobile matches.
 *
 * So a guest has no RSVP, party size or table number: those are answers about
 * one event and live on the participant.
 *
 * The routes are still `/client/guests` — the portal and the app call them that
 * and "guest" is the word on every screen. Only the table changed.
 *
 * ── OWNERSHIP ────────────────────────────────────────────────────────────────
 * `website_client_id` comes off the session, never the body, and every read is
 * scoped by it. An id from another account is a 404, not a 403.
 */

/** Kept exported for any caller that listed the writable fields. */
const WRITABLE_FIELDS = PERSON_FIELDS;

const GUEST_INCLUDE = [
    {
        model: GuestGroup, as: 'group',
        attributes: ['id', 'name', 'color'],
        required: false,
    },
];

/**
 * Events this guest has joined, as a SQL expression — so the list can show
 * "joined" without a second query per row.
 */
const joinedCount = Sequelize.literal(
    '(SELECT COUNT(*) FROM event_participants g WHERE g.guest_id = `Guest`.`id` AND g.deleted_at IS NULL)'
);

/** The row as the portal and the app read it. */
const present = (guest) => {
    const plain = guest.toJSON ? guest.toJSON() : guest;
    const joined = Number(plain.events_joined ?? 0);
    return {
        ...plain,
        full_name: plain.name,
        // A guest has no event (§581); the key is kept, null, so an older
        // client reading `event_id` gets a clear "none" rather than undefined.
        event_id: null,
        is_imported: plain.source === 'import',
        invite_source: plain.source,
        events_joined: joined,
        // Whether this person has joined ANY event by scanning its QR.
        has_joined: joined > 0,
    };
};

/** Same mobile as an existing guest of this client? (last 10 digits) */
const findByMobile = (clientId, mobile, { excludeId = null, transaction } = {}) => {
    const key = mobileKey(mobile);
    if (!key) return null;
    return Guest.findOne({
        where: {
            website_client_id: clientId,
            ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
            [Op.and]: Sequelize.where(
                Sequelize.fn('RIGHT', Sequelize.fn('REGEXP_REPLACE', Sequelize.col('mobile'), '[^0-9]', ''), 10),
                key,
            ),
        },
        attributes: ['id', 'name'],
        transaction,
    });
};

/**
 * The list. Tabs: `all`, `imported`, `joined` (has joined at least one event),
 * `not_joined`. RSVP tabs moved to the RSVP screen with the RSVP data.
 */
const listGuests = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 8));
    const tab = String(query.status || 'all').toLowerCase();
    const search = String(query.search || '').trim();
    const groupId = Number(query.group_id) || null;

    const where = { website_client_id: clientId };
    const and = [];
    if (tab === 'imported') where.source = 'import';
    if (tab === 'joined') and.push(Sequelize.where(joinedCount, Op.gt, 0));
    if (tab === 'not_joined') and.push(Sequelize.where(joinedCount, 0));
    if (and.length) where[Op.and] = and;

    // `group_id=0` is the UI's "Ungrouped" option — a real filter.
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

    const { rows, count } = await Guest.findAndCountAll({
        where,
        attributes: { include: [[joinedCount, 'events_joined']] },
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

/** The tiles above the list — all about the phone book, none about RSVPs. */
const getGuestStats = async (clientId) => {
    const [row] = await sequelize.query(
        `SELECT COUNT(*) AS total,
                SUM(c.group_id IS NOT NULL) AS grouped_n,
                SUM(c.source = 'import') AS imported,
                SUM(EXISTS (SELECT 1 FROM event_participants g
                             WHERE g.guest_id = c.id AND g.deleted_at IS NULL)) AS joined
           FROM guests c
          WHERE c.website_client_id = :clientId AND c.deleted_at IS NULL`,
        { replacements: { clientId }, type: Sequelize.QueryTypes.SELECT },
    );
    const total = Number(row?.total) || 0;
    const grouped = Number(row?.grouped_n) || 0;
    const joined = Number(row?.joined) || 0;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

    return {
        grouped, grouped_pct: pct(grouped),
        ungrouped: total - grouped, ungrouped_pct: pct(total - grouped),
        imported: Number(row?.imported) || 0,
        joined, joined_pct: pct(joined),
        // Older readers: one guest is one row and one person.
        total_guests: total,
        total_rows: total,
    };
};

const getGuestById = async (clientId, guestId) => {
    const guest = await Guest.findOne({
        where: { id: guestId, website_client_id: clientId },
        attributes: { include: [[joinedCount, 'events_joined']] },
        include: GUEST_INCLUDE,
    });
    return guest ? present(guest) : null;
};

// ── Plan limit: Max Guests = guests in the phone book, in total (§569) ────

const guestLimitFor = (holder, transaction) => planLimitFor(holder, 'max_guests_per_event', transaction);

/** Guests on the account. Soft-deleted ones are excluded, so removing frees a place. */
const countHostGuests = (hostId, transaction) =>
    Guest.count({ where: { website_client_id: hostId }, transaction });

/**
 * Refuse when adding `adding` guests would take the account past its plan's
 * guest limit. Pass a transaction to lock the host row: without it two quick
 * saves both read "9 of 10" and both insert.
 */
const assertGuestCapacity = async (hostId, adding = 1, { transaction, message } = {}) => {
    if (transaction) {
        await WebsiteClient.findByPk(hostId, {
            attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE,
        });
    }
    const maxGuests = await guestLimitFor({ website_client_id: hostId }, transaction);
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

/** For the Add Guest gate — the guest twin of `events_used` on event-options. */
const getGuestCapacity = async (clientId) => {
    const limit = await guestLimitFor({ website_client_id: clientId });
    const used = await countHostGuests(clientId);
    return {
        limit,
        used,
        full: limit !== null && used >= limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
    };
};

// ── Writes ─────────────────────────────────────────────────────────────────

const createGuest = async (clientId, companyId, body) => {
    const data = await normalisePerson(clientId, body, { partial: false });

    const guest = await sequelize.transaction(async (transaction) => {
        await assertGuestCapacity(clientId, 1, { transaction });
        const clash = await findByMobile(clientId, data.mobile, { transaction });
        if (clash) throw ApiError.conflict(`${clash.name} is already in your guest list with this mobile number.`);

        // No group chosen → the default group, which is what "New guests will
        // be added to this group by default" means.
        if (data.group_id === undefined) {
            const fallback = await GuestGroup.findOne({
                where: { website_client_id: clientId, is_default: 1 },
                attributes: ['id'],
                transaction,
            });
            if (fallback) data.group_id = fallback.id;
        }

        return Guest.create({
            ...data,
            website_client_id: clientId,
            company_id: companyId ?? null,
            source: 'manual',
        }, { transaction });
    });

    // Fire and forget — a failed feed row must never fail a save. No `guestId`:
    // client_notifications.guest_id points at event_participants (participants), and
    // a guest id there would name the wrong row.
    notifications.notify(clientId, {
        type: 'guest_added',
        title: 'New guest added',
        body: `${guest.name} was added to your guest list.`,
        companyId: companyId ?? null,
        link: `/dashboard/guests/${guest.id}`,
    });

    return getGuestById(clientId, guest.id);
};

const updateGuest = async (clientId, guestId, body) => {
    const guest = await Guest.findOne({ where: { id: guestId, website_client_id: clientId } });
    if (!guest) return null;

    const data = await normalisePerson(clientId, body, { partial: true, existing: guest.toJSON() });
    if (data.mobile) {
        const clash = await findByMobile(clientId, data.mobile, { excludeId: guest.id });
        if (clash) throw ApiError.conflict(`${clash.name} is already in your guest list with this mobile number.`);
    }
    await guest.update(data);
    return getGuestById(clientId, guestId);
};

/**
 * Remove a guest from the phone book. Their participations stay — somebody
 * who attended an event still attended it — and keep pointing at the
 * (soft-deleted) guest.
 */
const deleteGuest = async (clientId, guestId) => {
    const guest = await Guest.findOne({ where: { id: guestId, website_client_id: clientId } });
    if (!guest) return false;
    await guest.destroy();
    return true;
};

/**
 * The list screen's checkbox column. One statement per action, not a loop —
 * a 200-row selection would otherwise be 200 round trips.
 */
const bulkUpdate = async (clientId, guestIds, action, value) => {
    const ids = [...new Set((Array.isArray(guestIds) ? guestIds : []).map(Number).filter(Boolean))];
    if (ids.length === 0) throw ApiError.badRequest('No guests selected.');
    if (ids.length > 500) throw ApiError.badRequest('Select 500 guests or fewer at a time.');

    const scope = { website_client_id: clientId, id: { [Op.in]: ids } };

    if (action === 'delete') {
        const affected = await Guest.destroy({ where: scope });
        return { action, affected };
    }

    if (action === 'group') {
        const groupId = value === null || value === '' ? null : Number(value);
        if (groupId) {
            const group = await GuestGroup.findOne({
                where: { id: groupId, website_client_id: clientId }, attributes: ['id'],
            });
            if (!group) throw ApiError.badRequest('That guest group is not on your account.');
        }
        const [affected] = await Guest.update({ group_id: groupId }, { where: scope });
        return { action, affected };
    }

    if (action === 'status') {
        // RSVP status belongs to a participant of one event, not to a guest.
        throw ApiError.badRequest('RSVP status is set per event — change it on the RSVP screen.');
    }

    throw ApiError.badRequest('Unknown bulk action.');
};

/**
 * The Add/Edit form's dropdowns (Relationship, Food Preference, gender).
 *
 * Client-scoped on purpose — the admin option routes answer 401 for a website
 * client. The event is optional: a guest has none, so without one the
 * category-less default lists apply.
 */
const getGuestFormOptions = async (clientId, rawEventId) => {
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
        genders: ['male', 'female', 'other'],
    };
};

/** The phone-book guest with this mobile, for linking a participant (§581). */
const guestForMobile = (hostId, mobile, transaction) => findByMobile(hostId, mobile, { transaction });

module.exports = {
    WRITABLE_FIELDS,
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
    assertGuestCapacity,
    guestLimitFor,
    getGuestCapacity,
    guestForMobile,
};
