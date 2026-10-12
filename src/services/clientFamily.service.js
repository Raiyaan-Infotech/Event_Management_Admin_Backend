const { EventFamilyMember, Event, EventMenu, EventParticipant } = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

/**
 * An event's FAMILY list — the people the organizer shows on the event's Family
 * screen ("Mr. Rajesh Kumar · Father · Groom Side").
 *
 * Writing is host-only. Reading is open to the host and to the event's
 * participants, who get a VIEW-ONLY list. A family member has no login, no RSVP
 * and is not a guest (Jamal, 2026-10-12) — this is a display list, one table
 * (`event_family_members`), nothing tied to guests or guest groups.
 *
 * "Show in Event App" is NOT stored here: it is the Family MENU in the event's
 * `menu_ids`, saved with the normal event PUT (Default = locked, Add-on =
 * switchable) — same as Agenda. The list reports `menu_id` / `is_default`.
 *
 * What a participant is shown is the organizer's call too: `events.family_settings`
 * (profile photo, relationship, and whether a member's profile page opens).
 * The server strips what the host switched off, so a modified client cannot
 * read it. Mobile and email are never sent to a participant.
 */

const EVENT_ATTRS = ['id', 'name', 'company_id', 'website_client_id', 'menu_ids', 'family_settings'];
const MEDIA_URL = /^(https?:\/\/|\/uploads\/)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SETTINGS_DEFAULTS = Object.freeze({
    profile_screen: true,
    profile_photo: true,
    name: true,
    relationship: true,
});

const parseJson = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) || {}; } catch { return {}; }
    }
    return typeof raw === 'object' ? raw : {};
};

const bool = (value, fallback) => (value === undefined || value === null
    ? fallback
    : value === true || value === 1 || value === '1' || value === 'true');

/** Resolved settings for an event; `name` is always on (a row needs a name). */
const settingsOf = (event) => {
    const plain = event?.toJSON ? event.toJSON() : (event || {});
    const stored = parseJson(plain.family_settings);
    return {
        profile_screen: bool(stored.profile_screen, SETTINGS_DEFAULTS.profile_screen),
        profile_photo: bool(stored.profile_photo, SETTINGS_DEFAULTS.profile_photo),
        name: true,
        relationship: bool(stored.relationship, SETTINGS_DEFAULTS.relationship),
    };
};

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

    if (Number(event.website_client_id) === Number(clientId)) return { event, isOwner: true };

    const membership = await EventParticipant.findOne({
        where: { event_id: event.id, participant_client_id: clientId },
        attributes: ['id'],
    });
    if (!membership) throw ApiError.notFound('That event is not on your account.');
    return { event, isOwner: false };
};

/** A member the caller owns (through its event), or 404. */
const resolveMember = async (clientId, memberId) => {
    const member = await EventFamilyMember.findOne({
        where: { id: Number(memberId) || 0, website_client_id: clientId },
    });
    if (!member) throw ApiError.notFound('That family member was not found.');
    return member;
};

/**
 * One row as the caller may see it. The host gets everything; a participant gets
 * name / title / side / order, plus photo and relationship only when the host's
 * settings leave them on. Never mobile, email, notes or date of birth.
 */
const present = (row, { isOwner, settings }) => {
    const m = row.toJSON ? row.toJSON() : row;
    const base = {
        id: m.id,
        event_id: m.event_id,
        title: m.title,
        full_name: m.name,
        side: m.side,
        sort_order: m.sort_order,
    };
    if (isOwner) {
        return {
            ...base,
            photo: m.photo,
            relationship: m.relationship,
            relationship_option_id: m.relationship_option_id,
            date_of_birth: m.date_of_birth,
            dial_code: m.dial_code,
            mobile: m.mobile,
            email: m.email,
            notes: m.notes,
            created_at: m.created_at,
        };
    }
    return {
        ...base,
        photo: settings.profile_photo ? m.photo : null,
        relationship: settings.relationship ? m.relationship : null,
    };
};

const ORDER = [['sort_order', 'ASC'], ['id', 'ASC']];

const list = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);
    const settings = settingsOf(event);
    const [rows, menu] = await Promise.all([
        EventFamilyMember.findAll({ where: { event_id: event.id }, order: ORDER }),
        EventMenu.findOne({ where: { slug: 'family' }, attributes: ['id', 'is_default'] }),
    ]);
    const chosen = (Array.isArray(event.menu_ids) ? event.menu_ids : []).map(Number);
    const isDefault = !!menu && Number(menu.is_default) === 1;
    return {
        items: rows.map((r) => present(r, { isOwner, settings })),
        settings,
        /** The Family menu — its switch is this id in the event's menu_ids. */
        menu_id: menu ? menu.id : null,
        /** Default menus are always on; the app shows the switch locked. */
        is_default: isDefault,
        show_in_app: isDefault || (!!menu && chosen.includes(Number(menu.id))),
        can_edit: isOwner,
    };
};

const getOne = async (clientId, memberId) => {
    const row = await EventFamilyMember.findByPk(Number(memberId) || 0);
    if (!row) throw ApiError.notFound('That family member was not found.');
    const { event, isOwner } = await resolveEventForView(clientId, row.event_id);
    const settings = settingsOf(event);
    // A participant cannot open a profile the host switched off.
    if (!isOwner && !settings.profile_screen) {
        throw ApiError.forbidden('The organizer has turned off family profiles.');
    }
    return present(row, { isOwner, settings });
};

/** Validate a create/update body into model fields; `partial` = update. */
const normalise = (body, partial) => {
    const has = (f) => Object.prototype.hasOwnProperty.call(body, f);
    const str = (v, max) => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s ? s.slice(0, max) : null;
    };
    const data = {};

    if (!partial || has('first_name') || has('last_name') || has('name')) {
        const name = has('name')
            ? str(body.name, 150)
            : str([body.first_name, body.last_name].filter(Boolean).join(' '), 150);
        if (!name) throw ApiError.badRequest('Please fill all mandatory fields.');
        data.name = name;
    }
    if (has('title')) data.title = str(body.title, 30);

    if (!partial || has('side')) {
        const side = String(body.side || '').trim().toLowerCase();
        if (!['groom', 'bride'].includes(side)) throw ApiError.badRequest('Please fill all mandatory fields.');
        data.side = side;
    }
    if (!partial || has('relationship')) {
        const relationship = str(body.relationship, 100);
        if (!relationship) throw ApiError.badRequest('Please fill all mandatory fields.');
        data.relationship = relationship;
    }
    if (has('relationship_option_id')) {
        const id = Number(body.relationship_option_id);
        data.relationship_option_id = Number.isInteger(id) && id > 0 ? id : null;
    }

    if (has('photo')) {
        const photo = str(body.photo, 500);
        if (photo && !MEDIA_URL.test(photo)) throw ApiError.badRequest('Invalid photo.');
        data.photo = photo;
    }
    if (has('email')) {
        const email = str(body.email, 150);
        if (email && !EMAIL.test(email)) throw ApiError.badRequest('Please enter a valid email address.');
        data.email = email;
    }
    if (has('mobile') || has('dial_code')) {
        const mobile = str(body.mobile, 20);
        const digits = (mobile || '').replace(/\D/g, '');
        if (mobile && (digits.length < 6 || digits.length > 15)) {
            throw ApiError.badRequest('Please enter a valid mobile number.');
        }
        data.mobile = mobile ? digits : null;
        data.dial_code = mobile ? (str(body.dial_code, 8) || '+91') : null;
    }
    if (has('date_of_birth')) {
        const dob = str(body.date_of_birth, 10);
        if (dob && (!DATE.test(dob) || Number.isNaN(Date.parse(dob)))) {
            throw ApiError.badRequest('Please choose a valid date of birth.');
        }
        if (dob && dob > new Date().toISOString().slice(0, 10)) {
            throw ApiError.badRequest('Date of birth cannot be in the future.');
        }
        data.date_of_birth = dob;
    }
    if (has('notes')) data.notes = str(body.notes, 500);

    return data;
};

const nextSort = async (eventId) => {
    const last = await EventFamilyMember.max('sort_order', { where: { event_id: eventId } });
    return Number.isFinite(Number(last)) ? Number(last) + 1 : 0;
};

const create = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    const data = normalise(body, false);
    const row = await EventFamilyMember.create({
        ...data,
        event_id: event.id,
        website_client_id: clientId,
        company_id: event.company_id ?? null,
        sort_order: await nextSort(event.id),
    });
    return present(row, { isOwner: true, settings: settingsOf(event) });
};

/** A replaced / deleted photo is removed from storage, best effort. */
const dropPhoto = (url) => (url ? mediaService.deleteFile(url).catch(() => null) : null);

const update = async (clientId, memberId, body = {}) => {
    const row = await resolveMember(clientId, memberId);
    const event = await resolveEvent(clientId, row.event_id);
    const before = row.photo;
    const data = normalise(body, true);
    await row.update(data);
    if (Object.prototype.hasOwnProperty.call(data, 'photo') && before && before !== data.photo) {
        await dropPhoto(before);
    }
    return present(row, { isOwner: true, settings: settingsOf(event) });
};

const remove = async (clientId, memberId) => {
    const row = await resolveMember(clientId, memberId);
    const photo = row.photo;
    await row.destroy();
    await dropPhoto(photo);
    return { removed: true };
};

/**
 * Save Change Order: `ids` is the event's full list in the new order. Ids of
 * other events are ignored; anyone missing keeps their place after those sent.
 */
const reorder = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    if (!Array.isArray(body.ids)) throw ApiError.badRequest('Invalid family order.');

    const rows = await EventFamilyMember.findAll({ where: { event_id: event.id }, order: ORDER, attributes: ['id'] });
    const known = new Set(rows.map((r) => r.id));
    const sent = [...new Set(body.ids.map(Number))].filter((id) => known.has(id));
    const order = [...sent, ...rows.map((r) => r.id).filter((id) => !sent.includes(id))];

    // One UPDATE with CASE — prod is ~370ms a query, so never row by row.
    if (order.length) {
        const cases = order.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ');
        await EventFamilyMember.sequelize.query(
            `UPDATE event_family_members SET sort_order = CASE id ${cases} END WHERE event_id = ? AND id IN (${order.map(Number).join(',')})`,
            { replacements: [event.id] }
        );
    }
    return list(clientId, event.id);
};

// ── Settings (the settings icon on the Family list) ─────────────────────────

const getSettings = async (clientId, eventId) => {
    const { event } = await resolveEventForView(clientId, eventId);
    return { event_id: event.id, settings: settingsOf(event) };
};

const updateSettings = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    const current = settingsOf(event);
    const next = {
        profile_screen: bool(body.profile_screen, current.profile_screen),
        profile_photo: bool(body.profile_photo, current.profile_photo),
        name: true,
        relationship: bool(body.relationship, current.relationship),
    };
    await event.update({ family_settings: next });
    return { event_id: event.id, settings: next };
};

module.exports = {
    SETTINGS_DEFAULTS,
    settingsOf,
    list,
    getOne,
    create,
    update,
    remove,
    reorder,
    getSettings,
    updateSettings,
};
