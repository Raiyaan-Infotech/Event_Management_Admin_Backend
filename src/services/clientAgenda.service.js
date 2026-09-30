const { Sequelize, EventAgendaItem, Event, EventMenu, EventParticipant, WebsiteClient } = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

/**
 * An event's agenda / schedule — replaces the app's sample timeline.
 *
 * Writing is host-only; reading is open to the host and to the event's
 * participants (the guest Agenda screen). No plan limit: the plan decides only
 * whether the Agenda menu exists (decided by Jamal, 2026-09-30).
 *
 * The organizer's "Show in Event App" switch is NOT stored here: it is the
 * Agenda menu in the event's `menu_ids`, saved with the normal event PUT —
 * the same switch App Settings uses. Default menus are locked on (Default =
 * locked, Add-on = switchable), so the list reports `is_default` too.
 */

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MEDIA_URL = /^(https?:\/\/|\/uploads\/)/i;

const EVENT_ATTRS = ['id', 'name', 'start_date', 'end_date', 'company_id', 'website_client_id', 'menu_ids'];

/** The event, proven to belong to this client. */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const event = await Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        attributes: EVENT_ATTRS,
    });
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

/** An item the caller owns (through its event), or 404. */
const resolveItem = async (clientId, itemId) => {
    const item = await EventAgendaItem.findOne({
        where: { id: Number(itemId) || 0, website_client_id: clientId },
    });
    if (!item) throw ApiError.notFound('That agenda item was not found.');
    return item;
};

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

const imagesOf = (raw) => {
    let list = raw;
    if (typeof list === 'string') {
        try { list = JSON.parse(list); } catch { list = []; }
    }
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u) : [];
};

const present = (row) => {
    const item = row.toJSON ? row.toJSON() : row;
    return {
        id: item.id,
        event_id: item.event_id,
        title: item.title,
        description: item.description,
        agenda_date: item.agenda_date,
        end_date: item.end_date,
        start_time: hhmm(item.start_time),
        end_time: hhmm(item.end_time),
        location: item.location,
        images: imagesOf(item.images),
        sort_order: item.sort_order,
    };
};

/**
 * Every calendar day the event spans, for the Day 1 / Day 2 tabs. Only the
 * event's own range — an item cannot sit outside it (see `normalise`).
 */
const eventDays = (event) => {
    if (!event.start_date) return [];
    const days = [];
    const start = new Date(`${event.start_date}T00:00:00Z`);
    const end = new Date(`${event.end_date || event.start_date}T00:00:00Z`);
    for (let d = start; d <= end && days.length < 60; d = new Date(d.getTime() + 86400000)) {
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
};

/**
 * Validate a create/update body into model fields.
 *
 * `partial` (update) checks only the fields present; the date/time rules are
 * re-checked against the merged row so an update of just the end time cannot
 * slip past a start time it never sent.
 */
const normalise = (body, event, current = null) => {
    const partial = !!current;
    const has = (f) => Object.prototype.hasOwnProperty.call(body, f);
    const str = (v, max) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s ? s.slice(0, max) : null;
    };
    const data = {};

    if (!partial || has('title')) {
        const title = str(body.title, 100);
        if (!title) throw ApiError.badRequest('Please fill all mandatory fields.');
        data.title = title;
    }
    if (has('description')) data.description = str(body.description, 200);
    if (has('location')) data.location = str(body.location, 150);

    for (const f of ['agenda_date', 'start_time', 'end_time']) {
        if (!partial || has(f)) {
            const v = typeof body[f] === 'string' ? body[f].trim() : '';
            if (!v) throw ApiError.badRequest('Please fill all mandatory fields.');
            data[f] = v;
        }
    }
    if (has('end_date')) {
        const v = typeof body.end_date === 'string' ? body.end_date.trim() : '';
        data.end_date = v || null;
    }

    if (has('images')) {
        if (body.images !== null && !Array.isArray(body.images)) {
            throw ApiError.badRequest('Invalid agenda images.');
        }
        const list = [...new Set((body.images || []).filter((u) => typeof u === 'string'))];
        if (list.some((u) => !MEDIA_URL.test(u))) throw ApiError.badRequest('Invalid agenda image.');
        if (list.length > MAX_IMAGES) {
            throw ApiError.badRequest(`An agenda item can have up to ${MAX_IMAGES} images.`);
        }
        data.images = list;
    }

    // ── Dates and times, judged on the row as it will be saved ──────────────
    const merged = { ...(current ? current.toJSON() : {}), ...data };
    if (!DATE.test(merged.agenda_date)) throw ApiError.badRequest('Please choose a valid date.');
    if (merged.end_date && !DATE.test(merged.end_date)) throw ApiError.badRequest('Please choose a valid end date.');
    if (merged.end_date && merged.end_date <= merged.agenda_date) {
        throw ApiError.badRequest('The end date must be after the start date.');
    }
    if (!TIME.test(String(merged.start_time)) || !TIME.test(String(merged.end_time))) {
        throw ApiError.badRequest('Please choose a valid time.');
    }
    // End before start is allowed — it ends after midnight. Equal is not.
    if (!merged.end_date && hhmm(merged.start_time) === hhmm(merged.end_time)) {
        throw ApiError.badRequest('The end time must be different from the start time.');
    }

    if (event.start_date && merged.agenda_date < event.start_date) {
        throw ApiError.badRequest('The agenda date must be within the event dates.');
    }
    const lastDay = event.end_date || event.start_date;
    if (lastDay && (merged.end_date || merged.agenda_date) > lastDay) {
        throw ApiError.badRequest('The agenda date must be within the event dates.');
    }

    return data;
};

const ORDER = [['sort_order', 'ASC'], ['agenda_date', 'ASC'], ['start_time', 'ASC'], ['id', 'ASC']];

const listFor = async (event) => {
    const rows = await EventAgendaItem.findAll({ where: { event_id: event.id }, order: ORDER });
    return rows.map(present);
};

const list = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);
    const [items, menu] = await Promise.all([
        listFor(event),
        EventMenu.findOne({ where: { slug: 'agenda' }, attributes: ['id', 'is_default'] }),
    ]);
    const chosen = (Array.isArray(event.menu_ids) ? event.menu_ids : []).map(Number);
    const isDefault = !!menu && Number(menu.is_default) === 1;
    return {
        items,
        days: eventDays(event),
        /** The Agenda menu — its switch is this id in the event's menu_ids. */
        menu_id: menu ? menu.id : null,
        /** Default menus are always on; the app shows the switch locked. */
        is_default: isDefault,
        show_in_app: isDefault || (!!menu && chosen.includes(Number(menu.id))),
        can_edit: isOwner,
    };
};

const getOne = async (clientId, itemId) => {
    const item = await EventAgendaItem.findByPk(Number(itemId) || 0);
    if (!item) throw ApiError.notFound('That agenda item was not found.');
    await resolveEventForView(clientId, item.event_id);
    return present(item);
};

const nextSort = async (eventId) => {
    const last = await EventAgendaItem.max('sort_order', { where: { event_id: eventId } });
    return Number.isFinite(Number(last)) ? Number(last) + 1 : 0;
};

const create = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    const data = normalise(body, event);
    const row = await EventAgendaItem.create({
        ...data,
        event_id: event.id,
        website_client_id: clientId,
        sort_order: await nextSort(event.id),
        company_id: event.company_id ?? null,
    });
    return present(row);
};

/** Stored images an update or delete drops — removed from storage, best effort. */
const deleteImages = (urls) => Promise.all(
    urls.map((u) => mediaService.deleteFile(u).catch(() => null))
);

const update = async (clientId, itemId, body = {}) => {
    const item = await resolveItem(clientId, itemId);
    const event = await resolveEvent(clientId, item.event_id);
    const before = imagesOf(item.images);
    const data = normalise(body, event, item);
    await item.update(data);
    if (data.images) await deleteImages(before.filter((u) => !data.images.includes(u)));
    return present(item);
};

/**
 * A copy placed right after the original. Images are shared by URL, so the
 * copy's images are NOT deleted from storage while either row still uses them
 * (see `remove`).
 */
const duplicate = async (clientId, itemId) => {
    const item = await resolveItem(clientId, itemId);
    const src = item.toJSON();
    await EventAgendaItem.increment('sort_order', {
        by: 1,
        where: { event_id: src.event_id, sort_order: { [Sequelize.Op.gt]: src.sort_order } },
    });
    const copy = await EventAgendaItem.create({
        event_id: src.event_id,
        website_client_id: src.website_client_id,
        title: `${src.title}`.slice(0, 93) + ' (Copy)',
        description: src.description,
        agenda_date: src.agenda_date,
        end_date: src.end_date,
        start_time: src.start_time,
        end_time: src.end_time,
        location: src.location,
        images: imagesOf(src.images),
        sort_order: src.sort_order + 1,
        company_id: src.company_id,
    });
    return present(copy);
};

const remove = async (clientId, itemId) => {
    const item = await resolveItem(clientId, itemId);
    const images = imagesOf(item.images);
    const eventId = item.event_id;
    await item.destroy();

    // A duplicated item shares its images — keep any URL another item still uses.
    if (images.length) {
        const others = await EventAgendaItem.findAll({ where: { event_id: eventId }, attributes: ['images'] });
        const inUse = new Set(others.flatMap((o) => imagesOf(o.images)));
        await deleteImages(images.filter((u) => !inUse.has(u)));
    }
    return { removed: true };
};

/**
 * Save the Reorder screen: `ids` is the event's full list in the new order.
 * Ids of other events are ignored; any item missing from the list keeps its
 * place after the ones sent.
 */
const reorder = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    if (!Array.isArray(body.ids)) throw ApiError.badRequest('Invalid agenda order.');

    const rows = await EventAgendaItem.findAll({ where: { event_id: event.id }, order: ORDER, attributes: ['id'] });
    const known = new Set(rows.map((r) => r.id));
    const sent = [...new Set(body.ids.map(Number))].filter((id) => known.has(id));
    const order = [...sent, ...rows.map((r) => r.id).filter((id) => !sent.includes(id))];

    // One UPDATE with CASE — prod is ~370ms a query, so never row by row.
    if (order.length) {
        const cases = order.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ');
        await EventAgendaItem.sequelize.query(
            `UPDATE event_agenda_items SET sort_order = CASE id ${cases} END WHERE event_id = ? AND id IN (${order.map(Number).join(',')})`,
            { replacements: [event.id] }
        );
    }
    return { items: await listFor(event) };
};

const uploadImage = async (clientId, eventId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const event = await resolveEvent(clientId, eventId);
    if (!IMAGE_MIMES.includes(file.mimetype)) {
        throw ApiError.badRequest('Please choose a JPG, PNG or WEBP image.');
    }
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['company_id'] });
    const stored = await mediaService.upload(
        file, { folder: `event-agenda/${event.id}` }, event.company_id || client?.company_id || 1
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: stored.url };
};

module.exports = {
    MAX_IMAGE_BYTES,
    IMAGE_MIMES,
    list,
    getOne,
    create,
    update,
    duplicate,
    remove,
    reorder,
    uploadImage,
};
