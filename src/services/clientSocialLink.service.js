const {
    Sequelize, Event, EventMenu, EventParticipant, EventSocialLink, WebsiteClient,
} = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

let sharp = null;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

/**
 * Social Links (2026-10-20) — the app's Social Links menu.
 *
 * Every event has four PRESET links — Instagram, Facebook, X, YouTube — made
 * the first time its list is read (one INSERT IGNORE, so concurrent reads are
 * safe). Their platform and icon are fixed: an edit changes only the title,
 * URL, description, order and the two switches; "delete" on a preset only
 * clears its link, the row stays. Every other link is CUSTOM: the organizer
 * types the platform name and uploads an icon (stored as a 256×256 PNG).
 *
 * Writing is host-only (an event's organizer works as the host through
 * eventOrganizerAccess); participants read the links that have a URL and are
 * switched on (Show in App). No plan limit.
 */

const PRESETS = [
    { key: 'instagram', name: 'Instagram' },
    { key: 'facebook', name: 'Facebook' },
    { key: 'x', name: 'X' },
    { key: 'youtube', name: 'YouTube' },
];
const PRESET_KEYS = new Set(PRESETS.map((p) => p.key));
const MENU_SLUG = 'social-links';

/** A custom icon is stored as a square PNG this many pixels a side. */
const ICON_SIZE = 256;
const MAX_ICON_BYTES = 1024 * 1024;
const ICON_MIMES = ['image/png', 'image/jpeg', 'image/webp'];

const WEB_URL = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const MEDIA_URL = /^(https?:\/\/|\/uploads\/)/i;
const ORDER = [['sort_order', 'ASC'], ['id', 'ASC']];
const EVENT_ATTRS = ['id', 'company_id', 'website_client_id', 'menu_ids'];

const clean = (raw, max) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s ? s.slice(0, max) : null;
};
const has = (body, f) => Object.prototype.hasOwnProperty.call(body, f);
const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';
const isPreset = (row) => !!row.platform_key;

const dropFile = (url, companyId) => (url
    ? mediaService.deleteByUrl(url, companyId || 1).catch(() => null)
    : Promise.resolve());

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
    // Event and membership probe read together — a guest pays one round trip, not two.
    const [event, membership] = await Promise.all([
        Event.findByPk(eventId, { attributes: EVENT_ATTRS }),
        EventParticipant.findOne({
            where: { event_id: eventId, participant_client_id: clientId },
            attributes: ['id'],
        }),
    ]);
    if (!event) throw ApiError.notFound('That event was not found.');
    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (isOwner) return { event, isOwner };
    if (!membership) throw ApiError.notFound('That event is not on your account.');
    return { event, isOwner: false };
};

const resolveLink = async (clientId, linkId) => {
    const row = await EventSocialLink.findOne({ where: { id: Number(linkId) || 0, website_client_id: clientId } });
    if (!row) throw ApiError.notFound('That social link was not found.');
    return row;
};

/**
 * The four preset rows, made the first time the list is read. One INSERT
 * IGNORE (the unique (event_id, platform_key) key) — never row by row, and two
 * readers at once cannot make duplicates. Presets go before everything else.
 */
const ensurePresets = async (event) => {
    const have = await EventSocialLink.count({
        where: { event_id: event.id, platform_key: [...PRESET_KEYS] },
    });
    // true = rows were just inserted (the caller re-reads); false = nothing to do.
    if (have >= PRESETS.length) return false;
    const values = PRESETS.map((p, i) => [
        event.id, event.website_client_id, p.key, p.name, p.name, i - PRESETS.length, event.company_id ?? null,
    ]);
    await EventSocialLink.sequelize.query(
        `INSERT IGNORE INTO event_social_links
            (event_id, website_client_id, platform_key, platform_name, title, sort_order, company_id, created_at, updated_at)
         VALUES ${values.map(() => '(?, ?, ?, ?, ?, ?, ?, NOW(), NOW())').join(', ')}`,
        { replacements: values.flat() },
    );
    return true;
};

const present = (row) => {
    const r = row.toJSON ? row.toJSON() : row;
    return {
        id: r.id,
        event_id: r.event_id,
        /** instagram / facebook / x / youtube = preset; null = custom. */
        platform_key: r.platform_key || null,
        is_preset: !!r.platform_key,
        platform_name: r.platform_name,
        title: r.title,
        url: r.url || null,
        description: r.description || null,
        icon_url: r.icon_url || null,
        sort_order: r.sort_order,
        open_external: r.open_external === true || r.open_external === 1,
        show_in_app: r.show_in_app === true || r.show_in_app === 1,
        created_at: r.created_at,
        updated_at: r.updated_at,
    };
};

/** The Social Links menu: its "Show in Event App" switch is this id in the event's menu_ids. */
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

const rowsFor = (eventId) => EventSocialLink.findAll({ where: { event_id: eventId }, order: ORDER });

/** Host: every link, presets with no URL included. Participant: links with a URL that are switched on. */
const list = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);
    // The presets exist on every event after its first read, so the rows are
    // read beside the check rather than after it; only the one read that has
    // to create them reads the rows again.
    const [created, firstRows, menu] = await Promise.all([
        ensurePresets(event), rowsFor(event.id), menuState(event),
    ]);
    const rows = created ? await rowsFor(event.id) : firstRows;
    const links = rows.map(present).filter((l) => isOwner || (l.url && l.show_in_app));
    return { links, ...menu, icon_size: ICON_SIZE, can_edit: isOwner };
};

const getOne = async (clientId, linkId) => {
    const row = await EventSocialLink.findByPk(Number(linkId) || 0);
    if (!row) throw ApiError.notFound('That social link was not found.');
    const { isOwner } = await resolveEventForView(clientId, row.event_id);
    if (!isOwner && (!row.url || !row.show_in_app)) throw ApiError.notFound('That social link was not found.');
    return { link: present(row), can_edit: isOwner };
};

/**
 * Put one link at a 1-based position and renumber the event's links 0..n-1 in
 * ONE update — the form's Display Order is a place in the list.
 */
const place = async (eventId, linkId, rawPosition) => {
    const rows = await EventSocialLink.findAll({ where: { event_id: eventId }, order: ORDER, attributes: ['id'] });
    const ids = rows.map((r) => r.id).filter((id) => id !== linkId);
    const position = Number(rawPosition);
    const index = Number.isFinite(position) && position >= 1 ? Math.min(Math.floor(position) - 1, ids.length) : ids.length;
    ids.splice(index, 0, linkId);
    await saveOrder(eventId, ids);
};

const saveOrder = async (eventId, ids) => {
    if (!ids.length) return;
    const cases = ids.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ');
    await EventSocialLink.sequelize.query(
        `UPDATE event_social_links SET sort_order = CASE id ${cases} END WHERE event_id = ? AND id IN (${ids.map(Number).join(',')})`,
        { replacements: [eventId] },
    );
};

const hasPosition = (body) => body.position !== undefined && body.position !== null && body.position !== '';

const checkUrl = (raw) => {
    const url = clean(raw, 500);
    if (!url) throw ApiError.badRequest('Please fill all mandatory fields.');
    if (!WEB_URL.test(url)) throw ApiError.badRequest('Please enter a valid link starting with http:// or https://.');
    return url;
};

const checkIcon = (raw) => {
    const url = clean(raw, 500);
    if (url && !MEDIA_URL.test(url)) throw ApiError.badRequest('Invalid icon.');
    return url;
};

/** A new CUSTOM link. Presets already exist and are edited, never created. */
const create = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    await ensurePresets(event);
    const platformName = clean(body.platform_name, 60);
    const title = clean(body.title, 100);
    if (!platformName || !title) throw ApiError.badRequest('Please fill all mandatory fields.');
    const url = checkUrl(body.url);

    const last = await EventSocialLink.max('sort_order', { where: { event_id: event.id } });
    const row = await EventSocialLink.create({
        event_id: event.id,
        website_client_id: clientId,
        platform_key: null,
        platform_name: platformName,
        title,
        url,
        description: clean(body.description, 300),
        icon_url: checkIcon(body.icon_url),
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        open_external: has(body, 'open_external') ? bool(body.open_external) : true,
        show_in_app: has(body, 'show_in_app') ? bool(body.show_in_app) : true,
        company_id: event.company_id ?? null,
    });
    if (hasPosition(body)) await place(event.id, row.id, body.position);
    await row.reload();
    return present(row);
};

/**
 * Only the fields SENT change. A preset keeps its platform and icon — sending
 * a different one is refused, not silently dropped.
 */
const update = async (clientId, linkId, body = {}) => {
    const row = await resolveLink(clientId, linkId);
    const preset = isPreset(row);

    if (preset) {
        if (has(body, 'platform_name') && clean(body.platform_name, 60) !== row.platform_name) {
            throw ApiError.badRequest(`The ${row.platform_name} platform cannot be changed.`);
        }
        if (has(body, 'icon_url') && clean(body.icon_url, 500)) {
            throw ApiError.badRequest(`The ${row.platform_name} icon cannot be changed.`);
        }
    } else if (has(body, 'platform_name')) {
        const name = clean(body.platform_name, 60);
        if (!name) throw ApiError.badRequest('Please fill all mandatory fields.');
        row.platform_name = name;
    }
    if (has(body, 'title')) {
        const title = clean(body.title, 100);
        if (!title) throw ApiError.badRequest('Please fill all mandatory fields.');
        row.title = title;
    }
    if (has(body, 'url')) row.url = checkUrl(body.url);
    if (has(body, 'description')) row.description = clean(body.description, 300);
    let oldIcon = null;
    if (!preset && has(body, 'icon_url')) {
        const next = checkIcon(body.icon_url);
        if (row.icon_url && row.icon_url !== next) oldIcon = row.icon_url;
        row.icon_url = next;
    }
    if (has(body, 'open_external')) row.open_external = bool(body.open_external);
    if (has(body, 'show_in_app')) row.show_in_app = bool(body.show_in_app);
    await row.save();
    if (oldIcon) await dropFile(oldIcon, row.company_id);
    if (hasPosition(body)) {
        await place(row.event_id, row.id, body.position);
        await row.reload();
    }
    return present(row);
};

/** Custom: deleted (its icon too). Preset: the row stays, its link is cleared. */
const remove = async (clientId, linkId) => {
    const row = await resolveLink(clientId, linkId);
    if (isPreset(row)) {
        const name = PRESETS.find((p) => p.key === row.platform_key)?.name || row.platform_name;
        await row.update({ url: null, description: null, title: name, open_external: true, show_in_app: true });
        return { removed: false, cleared: true, link: present(row) };
    }
    const { icon_url: icon, company_id: companyId } = row;
    await row.destroy();
    if (icon) await dropFile(icon, companyId);
    return { removed: true, cleared: false };
};

/** Save the drag order: `ids` = the event's links in the new order; other events' ids ignored. */
const reorder = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    if (!Array.isArray(body.ids)) throw ApiError.badRequest('Invalid social link order.');
    const rows = await EventSocialLink.findAll({ where: { event_id: event.id }, order: ORDER, attributes: ['id'] });
    const known = new Set(rows.map((r) => r.id));
    const sent = [...new Set(body.ids.map(Number))].filter((id) => known.has(id));
    await saveOrder(event.id, [...sent, ...rows.map((r) => r.id).filter((id) => !sent.includes(id))]);
    return { links: (await rowsFor(event.id)).map(present) };
};

/**
 * Store a custom link's icon. Whatever is uploaded is turned into a square
 * ICON_SIZE × ICON_SIZE PNG (centred, transparent padding), so every icon in
 * the list is the same size and crisp at the app's 40 px. Returns its URL.
 */
const uploadIcon = async (clientId, eventId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const event = await resolveEvent(clientId, eventId);
    if (!ICON_MIMES.includes(file.mimetype)) throw ApiError.badRequest('Please choose a PNG, JPG or WEBP image.');

    let upload = file;
    if (sharp) {
        try {
            const png = await sharp(file.buffer, { animated: false })
                .rotate()
                .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
            const base = (file.originalname || 'icon').replace(/\.[^.]+$/, '');
            upload = { buffer: png, size: png.length, mimetype: 'image/png', originalname: `${base}.png` };
        } catch (_) {
            throw ApiError.badRequest('That image could not be read. Please choose another one.');
        }
    }
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['company_id'] });
    const stored = await mediaService.upload(
        upload, { folder: `event-social-links/${event.id}` }, event.company_id || client?.company_id || 1,
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: stored.url, size: ICON_SIZE };
};

/** A deleted event's custom icons leave storage, then its links go. */
const purgeEvent = async (eventId) => {
    const rows = await EventSocialLink.findAll({
        where: { event_id: eventId, icon_url: { [Sequelize.Op.ne]: null } },
        attributes: ['icon_url', 'company_id'],
        raw: true,
    });
    for (let i = 0; i < rows.length; i += 5) {
        await Promise.all(rows.slice(i, i + 5).map((r) => dropFile(r.icon_url, r.company_id)));
    }
    await EventSocialLink.destroy({ where: { event_id: eventId } });
};

module.exports = {
    PRESETS,
    ICON_SIZE,
    MAX_ICON_BYTES,
    ICON_MIMES,
    list,
    getOne,
    create,
    update,
    remove,
    reorder,
    uploadIcon,
    purgeEvent,
};
