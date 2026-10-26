const { Op } = require('sequelize');
const { WebsiteClient, EventMenu, Event } = require('../models');
const ApiError = require('../utils/apiError');
const clientPortalService = require('./clientPortal.service');

/**
 * Home → Quick Actions, arranged by the organizer (2026-10-19).
 *
 * The app's Home grid = Edit Event (the app's own tile, always first, never
 * stored) + these. Every tile is a MENU THE ACCOUNT'S PLAN GRANTS — event menus
 * and Home Quick Action menus alike: `available` is exactly that, and a saved
 * list is cut back to it on
 * every read, so a downgraded plan drops its tiles without anyone re-saving.
 *
 * Stored on `website_clients.quick_actions` as ordered BASE slugs — the same
 * menu exists once per event category (`gallery`, `gallery-2`, ...) and Home is
 * not about one event, so the screen key is what is kept.
 */

/**
 * What Home shows before the organizer customises it (Jamal, 2026-10-19):
 * Splash · Invitation · Venue · Agenda · Family · Participants · RSVP ·
 * Gallery · Contact Us — the same order as Menu Management (apply-menu-order.js),
 * only the ones the plan grants. Every Default menu is added after them.
 */
const DEFAULT_SLUGS = [
    'event-invitation', 'venue', 'agenda', 'family',
    'participants', 'rsvp', 'gallery', 'contact-us',
];

/**
 * Never a Quick Action (Jamal, 2026-10-21): Splash Screens and Messages moved
 * to the app's Quick View card, so they are left out here even though they are
 * Default menus (same idea as the event page's `_notTiles`).
 */
const NOT_QUICK_ACTIONS = new Set(['splash-screens', 'splash-screen', 'messages']);

const baseSlug = (slug) => String(slug || '').replace(/-\d+$/, '');

/**
 * The plan's active menus — event menus AND Home Quick Action menus (QR Code,
 * Notifications, My Plan, ...: menu_group `quick_action`) — one per base slug,
 * in Menu Management's order. Nothing here is hardcoded: what the admin adds
 * in Menu Management and ticks on the plan is what the organizer can pick.
 */
/**
 * The menu ids a CONTACT PERSON (organizer login) gets through the events
 * they run for somebody else (Jamal, 2026-10-26): per event, the owner's
 * plan menus that are ON for it (switched on, or Default for its category),
 * an additional one only when the owner allowed it in Menu Config
 * (`contact_menu_ids`, NULL = all). Home Quick Action menus of the owner's
 * plan (My Plan, …) are the owner's, so not included.
 */
const organisedMenuIds = async (caller) => {
    // The events the caller's number is the contact person of (2026-10-26).
    const organised = await require('../middleware/eventOrganizerAccess').organisedBy(caller);
    if (!organised.size) return [];
    const events = await Event.findAll({
        where: { id: { [Op.in]: [...organised.keys()] } },
        attributes: ['id', 'website_client_id', 'menu_ids', 'event_category_id', 'contact_menu_ids'],
        raw: true,
    });
    if (!events.length) return [];
    const parse = (v) => {
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch { return null; }
    };
    const owners = [...new Set(events.map((e) => Number(e.website_client_id)))];
    const grants = new Map(await Promise.all(
        owners.map(async (o) => [o, await clientPortalService.ownerGrantedMenuIds(o)]),
    ));
    const allIds = [...new Set([...grants.values()].flat().map(Number))];
    if (!allIds.length) return [];
    const defs = await EventMenu.findAll({
        where: { id: { [Op.in]: allIds }, is_active: 1, menu_group: { [Op.ne]: 'quick_action' } },
        attributes: ['id', 'is_default', 'event_category_id'],
        raw: true,
    });
    const out = new Set();
    for (const e of events) {
        const granted = new Set((grants.get(Number(e.website_client_id)) || []).map(Number));
        const chosen = new Set((parse(e.menu_ids) || []).map(Number));
        const allowedRaw = parse(e.contact_menu_ids);
        const allowed = Array.isArray(allowedRaw) ? new Set(allowedRaw.map(Number)) : null;
        const cat = e.event_category_id ? Number(e.event_category_id) : null;
        for (const m of defs) {
            const id = Number(m.id);
            if (!granted.has(id)) continue;
            const isDefault = Number(m.is_default) === 1;
            const on = chosen.has(id)
                || (isDefault && (!m.event_category_id || !cat || Number(m.event_category_id) === cat));
            if (!on) continue;
            if (!isDefault && allowed && !allowed.has(id)) continue;
            out.add(id);
        }
    }
    return [...out];
};

const availableFor = async (caller) => {
    const clientId = caller.id;
    // The caller's own plan, plus the menus of the events they run as a
    // contact person — a contact person with no plan of their own got an
    // empty Home before this.
    const [own, organised] = await Promise.all([
        clientPortalService.ownerGrantedMenuIds(clientId),
        organisedMenuIds(caller),
    ]);
    const ids = [...new Set([...own, ...organised].map(Number))];
    if (!ids.length) return [];
    const menus = await EventMenu.findAll({
        where: { id: { [Op.in]: ids }, is_active: 1 },
        attributes: ['id', 'name', 'slug', 'description', 'icon', 'color', 'is_default', 'menu_group', 'sort_order'],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    const seen = new Set();
    const out = [];
    for (const m of menus) {
        const slug = baseSlug(m.slug);
        if (!slug || seen.has(slug) || NOT_QUICK_ACTIONS.has(slug)) continue;
        seen.add(slug);
        out.push({
            slug,
            menu_id: m.id,
            name: m.name,
            description: m.description || null,
            icon: m.icon || null,
            color: m.color || null,
            is_default: !!m.is_default,
            kind: m.menu_group === 'quick_action' ? 'quick_action' : 'menu',
        });
    }
    return out;
};

const clean = (list, allowed) => {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const slug = baseSlug(raw);
        if (!allowed.has(slug) || seen.has(slug)) continue;
        seen.add(slug);
        out.push(slug);
    }
    return out;
};

/**
 * A DEFAULT menu (Menu Management's "Default" switch) is always a Quick
 * Action and cannot be removed (Jamal, 2026-10-19): any default missing from
 * the list is added after the others, in the plan's order. The app draws them
 * grey with no ✕; they can still be moved.
 */
const withDefaults = (list, available) => {
    const out = [...list];
    for (const m of available) {
        if (m.is_default && !out.includes(m.slug)) out.push(m.slug);
    }
    return out;
};

const shape = (available, stored) => {
    const allowed = new Set(available.map((m) => m.slug));
    const customised = Array.isArray(stored);
    const base = customised ? clean(stored, allowed) : clean(DEFAULT_SLUGS, allowed);
    return {
        available: available.map((m) => ({ ...m, locked: !!m.is_default })),
        selected: withDefaults(base, available),
        is_custom: customised,
    };
};

/** GET /client/quick-actions */
const get = async (caller) => {
    const clientId = caller.id;
    // A contact person has no account to keep an order on: the default order.
    if (caller.is_contact_person) return shape(await availableFor(caller), null);
    // The saved list and the plan's menus are independent — read together.
    const [client, available] = await Promise.all([
        WebsiteClient.findByPk(clientId, { attributes: ['id', 'quick_actions'] }),
        availableFor(caller),
    ]);
    if (!client) throw ApiError.notFound('Account not found.');
    return shape(available, client.quick_actions);
};

/**
 * PUT /client/quick-actions `{ slugs: [...] }` — the complete new order.
 * A slug the plan does not grant is dropped, not refused (an app showing a
 * stale list must still be able to save). `slugs: null` = back to the default.
 */
const save = async (caller, slugs) => {
    const clientId = caller.id;
    if (caller.is_contact_person) {
        throw ApiError.forbidden('As an event contact person, your Quick Actions follow the event.');
    }
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['id', 'quick_actions'] });
    if (!client) throw ApiError.notFound('Account not found.');
    const available = await availableFor(caller);
    if (slugs === null) {
        await WebsiteClient.update({ quick_actions: null }, { where: { id: clientId } });
        return shape(available, null);
    }
    if (!Array.isArray(slugs)) throw ApiError.badRequest('Send the quick actions as a list.');
    const list = withDefaults(clean(slugs, new Set(available.map((m) => m.slug))), available);
    await WebsiteClient.update({ quick_actions: list }, { where: { id: clientId } });
    return shape(available, list);
};

module.exports = { get, save, DEFAULT_SLUGS, NOT_QUICK_ACTIONS, baseSlug };
