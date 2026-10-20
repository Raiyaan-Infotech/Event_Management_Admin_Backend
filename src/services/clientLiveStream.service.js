const {
    Sequelize, Event, EventMenu, EventParticipant, EventLiveStream, EventLiveStreamType, WebsiteClient,
} = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

const { Op } = Sequelize;

/**
 * Live Streaming (2026-10-20) — the app's Live Streaming menu.
 *
 * Stream Types work like gallery categories — per event, the organizer adds /
 * renames / deletes / reorders them — but with NO built-in type (Jamal,
 * 2026-10-20): an event starts with none. A stream must belong to one type;
 * deleting a type deletes its streams.
 *
 * Writing is host-only (an event's organizer works as the host through
 * eventOrganizerAccess); reading is open to the host and to the event's
 * participants. Participants see ENABLED streams only, and only the types that
 * hold one. Nothing is played here — participants open `stream_url`.
 *
 * No plan limit: the plan decides only whether the Live Streaming menu exists.
 */

const PLATFORMS = ['youtube', 'facebook', 'instagram', 'zoom', 'google_meet', 'other'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MENU_SLUG = 'live-streaming';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const WEB_URL = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const MEDIA_URL = /^(https?:\/\/|\/uploads\/)/i;

const EVENT_ATTRS = ['id', 'name', 'company_id', 'website_client_id', 'menu_ids'];
const TYPE_ORDER = [['sort_order', 'ASC'], ['id', 'ASC']];
const STREAM_ORDER = [['sort_order', 'ASC'], ['stream_date', 'ASC'], ['stream_time', 'ASC'], ['id', 'ASC']];

const clean = (raw, max) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s ? s.slice(0, max) : null;
};
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const has = (body, f) => Object.prototype.hasOwnProperty.call(body, f);

/** The event, proven to belong to this client (writes). */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const event = await Event.findOne({ where: { id: eventId, website_client_id: clientId }, attributes: EVENT_ATTRS });
    if (!event) throw ApiError.notFound('That event is not on your account.');
    return event;
};

/** The event as a VIEWER may see it: the host, or a participant of it. */
const resolveEventForView = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const event = await Event.findByPk(eventId, { attributes: EVENT_ATTRS });
    if (!event) throw ApiError.notFound('That event was not found.');

    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (isOwner) return { event, isOwner };

    const membership = await EventParticipant.findOne({
        where: { event_id: event.id, participant_client_id: clientId },
        attributes: ['id'],
    });
    if (!membership) throw ApiError.notFound('That event is not on your account.');
    return { event, isOwner: false };
};

/** Stored files a change drops — removed from storage, best effort. */
const dropFile = (url, companyId) => (url
    ? mediaService.deleteByUrl(url, companyId || 1).catch(() => null)
    : Promise.resolve());

/* ─────────────────────────── Stream Types ─────────────────────────────── */

const presentType = (r, counts = {}, firstCover = null) => ({
    id: r.id,
    name: r.name,
    description: r.description || null,
    /** A type has no picture of its own; this is its first stream's cover. */
    cover_url: firstCover || null,
    sort_order: r.sort_order,
    stream_count: counts.total || 0,
    enabled_count: counts.enabled || 0,
});

/** The event's types with counts. A participant gets only types holding an enabled stream. */
const typesFor = async (eventId, { viewer = false } = {}) => {
    const [rows, streams] = await Promise.all([
        EventLiveStreamType.findAll({ where: { event_id: eventId }, order: TYPE_ORDER }),
        EventLiveStream.findAll({
            where: { event_id: eventId },
            attributes: ['type_id', 'is_enabled', 'cover_image'],
            order: STREAM_ORDER,
            raw: true,
        }),
    ]);
    const counts = new Map();
    const covers = new Map();
    for (const s of streams) {
        const enabled = s.is_enabled === true || s.is_enabled === 1;
        if (viewer && !enabled) continue;
        const c = counts.get(s.type_id) || { total: 0, enabled: 0 };
        c.total += 1;
        if (enabled) c.enabled += 1;
        counts.set(s.type_id, c);
        if (s.cover_image && !covers.has(s.type_id)) covers.set(s.type_id, s.cover_image);
    }
    const list = rows.map((r) => presentType(r, counts.get(r.id), covers.get(r.id)));
    return viewer ? list.filter((t) => t.stream_count > 0) : list;
};

/** The Live Streaming menu: its "Show in Event App" switch is this id in the event's menu_ids. */
const menuState = async (event) => {
    const menu = await EventMenu.findOne({ where: { slug: MENU_SLUG }, attributes: ['id', 'is_default'] });
    const chosen = (Array.isArray(event.menu_ids) ? event.menu_ids : []).map(Number);
    const isDefault = !!menu && Number(menu.is_default) === 1;
    return {
        menu_id: menu ? menu.id : null,
        is_default: isDefault,
        show_in_app: isDefault || (!!menu && chosen.includes(Number(menu.id))),
    };
};

const listTypes = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);
    const [types, menu] = await Promise.all([typesFor(event.id, { viewer: !isOwner }), menuState(event)]);
    return { types, ...menu, can_edit: isOwner };
};

const assertTypeNameFree = async (eventId, name, exceptId = null) => {
    const clash = await EventLiveStreamType.findOne({
        where: { event_id: eventId, name, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
        attributes: ['id'],
    });
    if (clash) throw ApiError.conflict(`"${name}" is already a stream type on this event.`);
};

const checkCover = (raw) => {
    const url = clean(raw, 500);
    if (url && !MEDIA_URL.test(url)) throw ApiError.badRequest('Invalid cover image.');
    return url;
};

const createType = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    const name = clean(body.name, 120);
    if (!name) throw ApiError.badRequest('Please fill all mandatory fields.');
    await assertTypeNameFree(event.id, name);

    const last = await EventLiveStreamType.max('sort_order', { where: { event_id: event.id } });
    const row = await EventLiveStreamType.create({
        event_id: event.id,
        website_client_id: clientId,
        name,
        description: clean(body.description, 200),
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        company_id: event.company_id ?? null,
    });
    const types = await typesFor(event.id);
    return { type: types.find((t) => t.id === row.id), types };
};

const resolveType = async (clientId, typeId) => {
    const row = await EventLiveStreamType.findOne({ where: { id: Number(typeId) || 0, website_client_id: clientId } });
    if (!row) throw ApiError.notFound('That stream type was not found.');
    return row;
};

/** Only the fields SENT change. */
const updateType = async (clientId, typeId, body = {}) => {
    const row = await resolveType(clientId, typeId);
    if (has(body, 'name')) {
        const name = clean(body.name, 120);
        if (!name) throw ApiError.badRequest('Please fill all mandatory fields.');
        await assertTypeNameFree(row.event_id, name, row.id);
        row.name = name;
    }
    if (has(body, 'description')) row.description = clean(body.description, 200);
    await row.save();
    const types = await typesFor(row.event_id);
    return { type: types.find((t) => t.id === row.id), types };
};

/**
 * Delete a type AND its live streams (Jamal, 2026-10-20: there is no built-in
 * type to move them to). The app says how many go before it asks.
 */
const removeType = async (clientId, typeId) => {
    const row = await resolveType(clientId, typeId);
    const streams = await EventLiveStream.findAll({
        where: { type_id: row.id },
        attributes: ['id', 'cover_image', 'company_id'],
    });
    const eventId = row.event_id;
    if (streams.length) await EventLiveStream.destroy({ where: { type_id: row.id } });
    await row.destroy();
    const covers = streams.filter((s) => s.cover_image);
    for (let i = 0; i < covers.length; i += 5) {
        await Promise.all(covers.slice(i, i + 5).map((s) => dropFile(s.cover_image, s.company_id)));
    }
    return { removed: true, streams_removed: streams.length, types: await typesFor(eventId) };
};

/** Save the drag order: `ids` = the event's types in the new order; other events' ids ignored. */
const reorderTypes = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    if (!Array.isArray(body.ids)) throw ApiError.badRequest('Invalid stream type order.');
    const rows = await EventLiveStreamType.findAll({ where: { event_id: event.id }, order: TYPE_ORDER, attributes: ['id'] });
    const known = new Set(rows.map((r) => r.id));
    const sent = [...new Set(body.ids.map(Number))].filter((id) => known.has(id));
    const order = [...sent, ...rows.map((r) => r.id).filter((id) => !sent.includes(id))];
    if (order.length) {
        // One UPDATE with CASE — prod is ~370ms a query, so never row by row.
        const cases = order.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ');
        await EventLiveStreamType.sequelize.query(
            `UPDATE event_live_stream_types SET sort_order = CASE id ${cases} END WHERE event_id = ? AND id IN (${order.map(Number).join(',')})`,
            { replacements: [event.id] },
        );
    }
    return { types: await typesFor(event.id) };
};

/* ───────────────────────────── Streams ─────────────────────────────────── */

const present = (row, typeName = null) => {
    const s = row.toJSON ? row.toJSON() : row;
    return {
        id: s.id,
        event_id: s.event_id,
        type_id: s.type_id,
        type_name: typeName,
        title: s.title,
        platform: s.platform,
        stream_url: s.stream_url,
        stream_date: s.stream_date,
        stream_time: hhmm(s.stream_time),
        description: s.description,
        cover_image: s.cover_image,
        is_enabled: s.is_enabled === true || s.is_enabled === 1,
        sort_order: s.sort_order,
        created_at: s.created_at,
        updated_at: s.updated_at,
    };
};

/** A type id proven to belong to THIS event. A stream must have one. */
const requireType = async (eventId, raw) => {
    const id = Number(raw);
    if (!id) throw ApiError.badRequest('Please fill all mandatory fields.');
    const row = await EventLiveStreamType.findOne({ where: { id, event_id: eventId }, attributes: ['id'] });
    if (!row) throw ApiError.badRequest('Please choose a valid stream type.');
    return row.id;
};

/**
 * Validate a create / update body. `current` set = update: only the fields
 * present are checked and changed.
 */
const normalise = (body, current = null) => {
    const partial = !!current;
    const data = {};
    const need = (f) => !partial || has(body, f);

    if (need('title')) {
        const title = clean(body.title, 150);
        if (!title) throw ApiError.badRequest('Please fill all mandatory fields.');
        data.title = title;
    }
    if (need('platform')) {
        const p = String(body.platform || '').trim().toLowerCase();
        if (!PLATFORMS.includes(p)) throw ApiError.badRequest('Please choose a platform.');
        data.platform = p;
    }
    if (need('stream_url')) {
        const url = clean(body.stream_url, 500);
        if (!url) throw ApiError.badRequest('Please fill all mandatory fields.');
        if (!WEB_URL.test(url)) throw ApiError.badRequest('Please enter a valid link starting with http:// or https://.');
        data.stream_url = url;
    }
    if (need('stream_date')) {
        const d = clean(body.stream_date, 10);
        if (!d) throw ApiError.badRequest('Please fill all mandatory fields.');
        if (!DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw ApiError.badRequest('Please choose a valid date.');
        data.stream_date = d;
    }
    if (need('stream_time')) {
        const t = clean(body.stream_time, 8);
        if (!t) throw ApiError.badRequest('Please fill all mandatory fields.');
        if (!TIME.test(t)) throw ApiError.badRequest('Please choose a valid time.');
        data.stream_time = t;
    }
    if (has(body, 'description')) data.description = clean(body.description, 500);
    if (has(body, 'cover_image')) data.cover_image = checkCover(body.cover_image);
    if (has(body, 'is_enabled')) data.is_enabled = body.is_enabled === true || body.is_enabled === 1 || body.is_enabled === '1' || body.is_enabled === 'true';
    return data;
};

const countsOf = (list) => ({
    total: list.length,
    enabled: list.filter((s) => s.is_enabled).length,
    disabled: list.filter((s) => !s.is_enabled).length,
});

/**
 * The streams of one event — of one type when `type_id` is given. Host: every
 * stream + counts; participant: enabled streams only.
 */
const list = async (clientId, eventId, query = {}) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);
    const types = await typesFor(event.id, { viewer: !isOwner });
    const where = { event_id: event.id };
    const typeId = Number(query.type_id) || null;
    if (typeId) where.type_id = typeId;
    if (!isOwner) where.is_enabled = true;

    const [rows, menu] = await Promise.all([
        EventLiveStream.findAll({ where, order: STREAM_ORDER }),
        menuState(event),
    ]);
    // Names from the types already read — no join per row.
    const allTypes = isOwner ? types : await typesFor(event.id);
    const nameOf = new Map(allTypes.map((t) => [t.id, t.name]));
    const streams = rows.map((r) => present(r, nameOf.get(r.type_id) || null));
    return {
        streams,
        counts: countsOf(streams),
        types,
        type: typeId ? (allTypes.find((t) => t.id === typeId) || null) : null,
        platforms: PLATFORMS,
        ...menu,
        can_edit: isOwner,
    };
};

const resolveStream = async (clientId, streamId) => {
    const row = await EventLiveStream.findOne({ where: { id: Number(streamId) || 0, website_client_id: clientId } });
    if (!row) throw ApiError.notFound('That live stream was not found.');
    return row;
};

const withType = async (row) => {
    const type = row.type_id ? await EventLiveStreamType.findByPk(row.type_id, { attributes: ['name'] }) : null;
    return present(row, type ? type.name : null);
};

const getOne = async (clientId, streamId) => {
    const row = await EventLiveStream.findByPk(Number(streamId) || 0);
    if (!row) throw ApiError.notFound('That live stream was not found.');
    const { isOwner } = await resolveEventForView(clientId, row.event_id);
    if (!isOwner && !row.is_enabled) throw ApiError.notFound('That live stream was not found.');
    return { stream: await withType(row), can_edit: isOwner };
};

const create = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    const data = normalise(body);
    const typeId = await requireType(event.id, body.type_id);
    const last = await EventLiveStream.max('sort_order', { where: { event_id: event.id } });
    const row = await EventLiveStream.create({
        ...data,
        is_enabled: has(body, 'is_enabled') ? data.is_enabled : true,
        event_id: event.id,
        website_client_id: clientId,
        type_id: typeId,
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        company_id: event.company_id ?? null,
    });
    return withType(row);
};

const update = async (clientId, streamId, body = {}) => {
    const row = await resolveStream(clientId, streamId);
    const data = normalise(body, row);
    if (has(body, 'type_id')) data.type_id = await requireType(row.event_id, body.type_id);
    const oldCover = has(data, 'cover_image') && row.cover_image && row.cover_image !== data.cover_image
        ? row.cover_image : null;
    await row.update(data);
    if (oldCover) await dropFile(oldCover, row.company_id);
    return withType(row);
};

const remove = async (clientId, streamId) => {
    const row = await resolveStream(clientId, streamId);
    const { cover_image: cover, company_id: companyId } = row;
    await row.destroy();
    if (cover) await dropFile(cover, companyId);
    return { removed: true };
};

/** Store a stream's cover and hand back its URL; the form saves the URL. */
const uploadCover = async (clientId, eventId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const event = await resolveEvent(clientId, eventId);
    if (!IMAGE_MIMES.includes(file.mimetype)) throw ApiError.badRequest('Please choose a JPG, PNG or WEBP image.');
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['company_id'] });
    const stored = await mediaService.upload(
        file, { folder: `event-live-streams/${event.id}` }, event.company_id || client?.company_id || 1,
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: stored.url };
};

/** A deleted event's stream covers leave storage, then its streams and types go. */
const purgeEvent = async (eventId) => {
    const streams = await EventLiveStream.findAll({
        where: { event_id: eventId }, attributes: ['cover_image', 'company_id'], raw: true,
    });
    const files = streams.filter((r) => r.cover_image);
    for (let i = 0; i < files.length; i += 5) {
        await Promise.all(files.slice(i, i + 5).map((r) => dropFile(r.cover_image, r.company_id)));
    }
    await EventLiveStream.destroy({ where: { event_id: eventId } });
    await EventLiveStreamType.destroy({ where: { event_id: eventId } });
};

module.exports = {
    PLATFORMS,
    MAX_IMAGE_BYTES,
    IMAGE_MIMES,
    listTypes,
    createType,
    updateType,
    removeType,
    reorderTypes,
    list,
    getOne,
    create,
    update,
    remove,
    uploadCover,
    purgeEvent,
};
