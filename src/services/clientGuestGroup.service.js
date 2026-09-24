const { Sequelize, sequelize, GuestGroup, EventParticipant, Guest } = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');

/**
 * Guest groups — Family, Friends, Colleagues.
 *
 * Scoped to the CLIENT, not to an event: the Manage Groups screen counts how
 * many EVENTS each group is used in, which only makes sense if one "Family" is
 * shared across the account rather than recreated per event.
 *
 * Ownership comes from the session everywhere here. No handler takes a client
 * id from the request, which is what makes another client's group id a 404
 * rather than a read.
 */

const WRITABLE_FIELDS = ['name', 'description', 'color', 'visibility', 'is_default'];

const VISIBILITY = ['private', 'public'];
const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const str = (value, max) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Attach the two counts the list screen shows.
 *
 * Done as two grouped queries over the whole set rather than a subquery per
 * row: a client with 28 groups would otherwise cost 56 round trips, and at
 * ~374ms each against production (§103) that is half a minute.
 */
const withCounts = async (clientId, groups) => {
    if (groups.length === 0) return [];
    const ids = groups.map((g) => g.id);

    // Members = the phone-book guests in the group (§581).
    const members = await Guest.findAll({
        where: { website_client_id: clientId, group_id: { [Op.in]: ids } },
        attributes: ['group_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'members']],
        group: ['group_id'],
        raw: true,
    });

    // Events = DISTINCT events a member of the group has joined — through their
    // guest, or as a participant filed in the group directly (Add Family
    // Member). COUNT(DISTINCT), or 400 people at one wedding read as 400 events.
    const events = await sequelize.query(
        `SELECT grp.group_id, COUNT(DISTINCT grp.event_id) AS events FROM (
             SELECT g.group_id, g.event_id FROM event_participants g
              WHERE g.website_client_id = :clientId AND g.deleted_at IS NULL AND g.group_id IN (:ids)
             UNION
             SELECT c.group_id, g.event_id FROM event_participants g
               JOIN guests c ON c.id = g.guest_id AND c.deleted_at IS NULL
              WHERE g.website_client_id = :clientId AND g.deleted_at IS NULL AND c.group_id IN (:ids)
         ) grp GROUP BY grp.group_id`,
        { replacements: { clientId, ids }, type: Sequelize.QueryTypes.SELECT },
    );

    const memberCount = new Map(members.map((r) => [Number(r.group_id), Number(r.members)]));
    const eventCount = new Map(events.map((r) => [Number(r.group_id), Number(r.events)]));

    return groups.map((group) => {
        const plain = group.toJSON ? group.toJSON() : group;
        return {
            ...plain,
            members_count: memberCount.get(plain.id) ?? 0,
            events_count: eventCount.get(plain.id) ?? 0,
        };
    });
};

const normalise = (body, { partial = false } = {}) => {
    const data = {};
    const has = (f) => Object.prototype.hasOwnProperty.call(body, f);
    const required = (f) => !partial || has(f);

    if (required('name')) {
        const name = str(body.name, 120);
        if (!name) throw ApiError.badRequest('Please enter a group name.');
        data.name = name;
    }
    if (has('description')) data.description = str(body.description, 500);

    if (has('color')) {
        const color = str(body.color, 9);
        if (color && !HEX.test(color)) {
            throw ApiError.badRequest('Group colour must be a hex value like #EC4899.');
        }
        data.color = color;
    }

    if (has('visibility')) {
        const value = String(body.visibility || '').toLowerCase();
        if (!VISIBILITY.includes(value)) throw ApiError.badRequest('Invalid group visibility.');
        data.visibility = value;
    }

    if (has('is_default')) data.is_default = body.is_default ? 1 : 0;

    return data;
};

/**
 * Make one group the default, clearing any other.
 *
 * In a transaction with the write that set it, so there is never a moment where
 * two groups both claim to be the default — which the Add Guest form would
 * resolve arbitrarily.
 */
const clearOtherDefaults = async (clientId, keepId, transaction) => {
    await GuestGroup.update(
        { is_default: 0 },
        {
            where: {
                website_client_id: clientId,
                is_default: 1,
                ...(keepId ? { id: { [Op.ne]: keepId } } : {}),
            },
            transaction,
        }
    );
};

const listGroups = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 8));
    const search = String(query.search || '').trim();
    const visibility = String(query.visibility || '').toLowerCase();

    const where = { website_client_id: clientId };
    if (VISIBILITY.includes(visibility)) where.visibility = visibility;
    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
        ];
    }

    const { rows, count } = await GuestGroup.findAndCountAll({
        where,
        order: [['is_default', 'DESC'], ['name', 'ASC']],
        limit,
        offset: (page - 1) * limit,
    });

    return {
        rows: await withCounts(clientId, rows),
        pagination: {
            page,
            limit,
            totalItems: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
        },
    };
};

/** Every group, unpaginated — for the pickers on Add Guest and Send Message. */
const listAllGroups = async (clientId) => {
    const rows = await GuestGroup.findAll({
        where: { website_client_id: clientId },
        order: [['is_default', 'DESC'], ['name', 'ASC']],
    });
    return withCounts(clientId, rows);
};

const getGroupById = async (clientId, groupId) => {
    const group = await GuestGroup.findOne({
        where: { id: groupId, website_client_id: clientId },
    });
    if (!group) return null;
    const [withCount] = await withCounts(clientId, [group]);
    return withCount;
};

/** The four tiles on Manage Groups. */
const getGroupStats = async (clientId) => {
    const groups = await GuestGroup.findAll({
        where: { website_client_id: clientId },
        attributes: ['id', 'visibility'],
    });
    const counted = await withCounts(clientId, groups);

    return {
        total_groups: counted.length,
        total_members: counted.reduce((sum, g) => sum + g.members_count, 0),
        // "Groups added to events" — groups actually in use, not merely created.
        groups_in_use: counted.filter((g) => g.events_count > 0).length,
        private_groups: counted.filter((g) => g.visibility === 'private').length,
    };
};

const createGroup = async (clientId, companyId, body) => {
    const data = normalise(body, { partial: false });

    // Case-insensitive, because "family" and "Family" are the same group to the
    // person typing them, and two of them makes the picker unusable.
    const clash = await GuestGroup.findOne({
        where: {
            website_client_id: clientId,
            name: { [Op.like]: data.name },
        },
    });
    if (clash) throw ApiError.conflict(`You already have a group called "${clash.name}".`);

    return sequelize.transaction(async (transaction) => {
        const group = await GuestGroup.create(
            { ...data, website_client_id: clientId, company_id: companyId ?? null },
            { transaction }
        );
        if (data.is_default) await clearOtherDefaults(clientId, group.id, transaction);
        return group.toJSON();
    });
};

const updateGroup = async (clientId, groupId, body) => {
    const group = await GuestGroup.findOne({
        where: { id: groupId, website_client_id: clientId },
    });
    if (!group) return null;

    const data = normalise(body, { partial: true });

    if (data.name) {
        const clash = await GuestGroup.findOne({
            where: {
                website_client_id: clientId,
                name: { [Op.like]: data.name },
                id: { [Op.ne]: group.id },
            },
        });
        if (clash) throw ApiError.conflict(`You already have a group called "${clash.name}".`);
    }

    await sequelize.transaction(async (transaction) => {
        await group.update(data, { transaction });
        if (data.is_default) await clearOtherDefaults(clientId, group.id, transaction);
    });

    return getGroupById(clientId, groupId);
};

/**
 * Delete a group.
 *
 * The FK is ON DELETE SET NULL, so its guests are UNGROUPED rather than
 * deleted. The count is returned so the UI can say how many were affected
 * instead of the deletion being silent.
 */
const deleteGroup = async (clientId, groupId) => {
    const group = await GuestGroup.findOne({
        where: { id: groupId, website_client_id: clientId },
    });
    if (!group) return null;

    const members = await Guest.count({
        where: { website_client_id: clientId, group_id: group.id },
    });

    await sequelize.transaction(async (transaction) => {
        // Explicit, not relying on the FK: these rows are soft-deleted, and
        // ON DELETE SET NULL only fires on a HARD delete.
        // Guests AND participants filed in the group (§581).
        await Guest.update(
            { group_id: null },
            { where: { website_client_id: clientId, group_id: group.id }, transaction }
        );
        await EventParticipant.update(
            { group_id: null },
            { where: { website_client_id: clientId, group_id: group.id }, transaction }
        );
        await group.destroy({ transaction });
    });

    return { deleted: true, ungrouped_guests: members };
};

module.exports = {
    WRITABLE_FIELDS,
    listGroups,
    listAllGroups,
    getGroupById,
    getGroupStats,
    createGroup,
    updateGroup,
    deleteGroup,
};
