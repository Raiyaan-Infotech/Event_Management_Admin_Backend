const {
    Sequelize,
    sequelize,
    Event,
    EventParticipant,
    GuestGroup,
    Guest,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const notifications = require('./clientNotification.service');
const notificationTrigger = require('./notificationTrigger.service');
const guests = require('./clientGuest.service');
const {
    RSVP_STATUSES,
    normalisePerson,
    normaliseAttendance,
    planLimitFor,
} = require('./guestFields');

/**
 * PARTICIPANTS — the people attending ONE event (`event_participants`, §581).
 *
 * Mostly created by scanning the event's QR (guestRegistration.join); the host
 * can also add one by hand. A participant may be one of the host's phone-book
 * guests (`guest_id` set) or a stranger who scanned the invitation — both
 * are participants.
 *
 * Same person fields as a guest (guestFields.normalisePerson) plus the
 * answers about this event (normaliseAttendance): RSVP, party size, table.
 *
 * HOST-only: every read is scoped by `website_client_id`, which on a
 * participant row is the HOST (denormalised from the event). Another
 * participant reads the directory instead
 * (guestRegistration.participantsDirectory), which carries no contact details.
 */

const INCLUDE = [
    {
        model: Event, as: 'event',
        attributes: ['id', 'name', 'start_date', 'start_time', 'theme_id'],
        required: false,
    },
    {
        model: GuestGroup, as: 'group',
        attributes: ['id', 'name', 'color'],
        required: false,
    },
    {
        model: Guest, as: 'guest',
        attributes: ['id', 'name'],
        required: false,
    },
];

const present = (guest) => {
    const plain = guest.toJSON ? guest.toJSON() : guest;
    return {
        ...plain,
        full_name: plain.name,
        is_imported: plain.invite_source === 'import',
        // Joined through the app (scanned + verified) vs added by the host.
        // A boolean, never the id — the id names another person's account.
        has_joined: Boolean(plain.participant_client_id),
        participant_client_id: undefined,
    };
};

// ── Participant limit = the plan's Max RSVP per event (§578) ─────────────────

const countParticipants = (eventId, transaction) =>
    EventParticipant.count({ where: { event_id: eventId }, transaction });

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

/**
 * Checked at the DOOR — when somebody would become a participant — never when
 * they answer (§578). Counts participant rows; removing one frees the place.
 * Pass a transaction to lock the event row so two joins cannot both take the
 * last place.
 */
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

// ── Reads ──────────────────────────────────────────────────────────────────

/** The host's own event, or a clear refusal. */
const ownEvent = async (clientId, eventId, transaction) => {
    const id = Number(eventId);
    if (!id) throw ApiError.badRequest('Please select an event.');
    const event = await Event.findOne({
        where: { id, website_client_id: clientId },
        attributes: ['id', 'website_client_id', 'company_id', 'subscription_plan_id'],
        transaction,
    });
    if (!event) throw ApiError.badRequest('That event is not on your account.');
    return event;
};

/** `status` tabs are the stored RSVP statuses; `joined` = came in through the app. */
const listParticipants = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const tab = String(query.status || 'all').toLowerCase();
    const search = String(query.search || '').trim();

    const where = { website_client_id: clientId };
    if (query.event_id) where.event_id = Number(query.event_id);
    if (tab === 'joined') where.participant_client_id = { [Op.ne]: null };
    else if (tab === 'not_responded') where.rsvp_status = { [Op.in]: ['not_responded', 'invited'] };
    else if (RSVP_STATUSES.includes(tab)) where.rsvp_status = tab;

    const groupId = Number(query.group_id) || null;
    if (groupId) where.group_id = groupId;
    else if (String(query.group_id) === '0') where.group_id = null;

    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { mobile: { [Op.like]: `%${search}%` } },
        ];
    }

    const { rows, count } = await EventParticipant.findAndCountAll({
        where,
        include: INCLUDE,
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

/**
 * The RSVP tiles for the host's participants — one event (`event_id`) or all.
 * Rows by status, plus heads (party size): a family of four is one row and
 * four people at the venue.
 */
const getParticipantStats = async (clientId, query = {}) => {
    const where = { website_client_id: clientId };
    const eventId = Number(query.event_id) || null;
    if (eventId) where.event_id = eventId;

    const rows = await EventParticipant.findAll({ where, attributes: ['rsvp_status', 'party_size', 'invite_source'] });

    const counts = { accepted: 0, pending: 0, declined: 0, not_responded: 0, invited: 0 };
    let heads = 0;
    let imported = 0;
    for (const r of rows) {
        counts[r.rsvp_status] = (counts[r.rsvp_status] || 0) + 1;
        heads += Number(r.party_size) || 1;
        if (r.invite_source === 'import') imported += 1;
    }
    const total = rows.length;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    // The tabs group invited with not-responded, so the tile agrees with them.
    const awaiting = counts.not_responded + counts.invited;

    return {
        total_guests: heads,
        total_rows: total,
        accepted: counts.accepted, accepted_pct: pct(counts.accepted),
        pending: counts.pending, pending_pct: pct(counts.pending),
        declined: counts.declined, declined_pct: pct(counts.declined),
        not_responded: awaiting, not_responded_pct: pct(awaiting),
        imported,
    };
};

/** getParticipantStatus for one of the CALLER's own events. */
const getParticipantCapacity = async (clientId, eventId) => {
    const event = await ownEvent(clientId, eventId);
    return getParticipantStatus(event.id);
};

const getParticipantById = async (clientId, id) => {
    const guest = await EventParticipant.findOne({
        where: { id: Number(id) || 0, website_client_id: clientId },
        include: INCLUDE,
    });
    return guest ? present(guest) : null;
};

// ── Writes ─────────────────────────────────────────────────────────────────

/** Same person on this event already? (last 10 digits of the mobile) */
const clashOnEvent = (eventId, mobile, { excludeId = null, transaction } = {}) => {
    const key = String(mobile || '').replace(/\D/g, '').slice(-10);
    if (!key) return null;
    return EventParticipant.findOne({
        where: {
            event_id: eventId,
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
 * The host adds a participant by hand (the app's Add Participant). Limited by
 * Max RSVP per event, linked to the phone-book guest with the same mobile.
 */
const createParticipant = async (clientId, companyId, body = {}) => {
    const person = await normalisePerson(clientId, body, { partial: false });
    const attendance = normaliseAttendance(body);

    const guest = await sequelize.transaction(async (transaction) => {
        const event = await ownEvent(clientId, body.event_id, transaction);
        await assertParticipantCapacity(event.id, 1, { transaction });

        const clash = await clashOnEvent(event.id, person.mobile, { transaction });
        if (clash) throw ApiError.conflict(`${clash.name} is already a participant of this event.`);

        const guest = await guests.guestForMobile(clientId, person.mobile, transaction);

        return EventParticipant.create({
            invite_source: 'manual',
            ...person,
            ...attendance,
            event_id: event.id,
            website_client_id: clientId,
            company_id: companyId ?? event.company_id ?? null,
            guest_id: guest?.id ?? null,
        }, { transaction });
    });

    // Fire and forget — a failed feed row must never fail a save.
    notifications.notify(clientId, {
        type: 'guest_added',
        title: 'New participant added',
        body: `${guest.name} was added to your event.`,
        eventId: guest.event_id,
        guestId: guest.id,
        companyId: companyId ?? null,
        link: `/dashboard/rsvps/${guest.id}`,
    });
    notificationTrigger.triggerWelcomeInvitation({
        eventId: guest.event_id,
        guest,
        companyId: companyId ?? null,
    }).catch((err) => {
        console.error('[createParticipant] Welcome invitation trigger error:', err.message);
    });

    return getParticipantById(clientId, guest.id);
};

const updateParticipant = async (clientId, id, body = {}) => {
    const guest = await EventParticipant.findOne({ where: { id: Number(id) || 0, website_client_id: clientId } });
    if (!guest) return null;

    const person = await normalisePerson(clientId, body, { partial: true, existing: guest.toJSON() });
    const attendance = normaliseAttendance(body, { existing: guest.toJSON() });
    const data = { ...person, ...attendance };

    const moving = body.event_id !== undefined && Number(body.event_id) !== Number(guest.event_id);
    const before = guest.response_type;

    await sequelize.transaction(async (transaction) => {
        let eventId = guest.event_id;
        if (moving) {
            const event = await ownEvent(clientId, body.event_id, transaction);
            await assertParticipantCapacity(event.id, 1, { transaction });
            eventId = event.id;
            data.event_id = event.id;
        }
        if (data.mobile || moving) {
            const clash = await clashOnEvent(eventId, data.mobile ?? guest.mobile, { excludeId: guest.id, transaction });
            if (clash) throw ApiError.conflict(`${clash.name} is already a participant of this event.`);
        }
        if (data.mobile) {
            const guest = await guests.guestForMobile(clientId, data.mobile, transaction);
            data.guest_id = guest?.id ?? null;
        }
        await guest.update(data, { transaction });
    });

    // The RSVP notification fires on the TRANSITION, not on every save — editing
    // a table number for somebody who already accepted must not write another.
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
            link: `/dashboard/rsvps/${guest.id}`,
            meta: { response: after, email: guest.email, mobile: guest.mobile },
        });
    }

    return getParticipantById(clientId, id);
};

/** Removing a participant frees their place against Max RSVP (§578). */
const deleteParticipant = async (clientId, id) => {
    const guest = await EventParticipant.findOne({ where: { id: Number(id) || 0, website_client_id: clientId } });
    if (!guest) return false;
    await guest.destroy();
    return true;
};

module.exports = {
    present,
    listParticipants,
    getParticipantStats,
    getParticipantById,
    createParticipant,
    updateParticipant,
    deleteParticipant,
    countParticipants,
    getParticipantStatus,
    getParticipantCapacity,
    assertParticipantCapacity,
};
