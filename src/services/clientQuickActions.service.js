const { Op } = require('sequelize');
const { WebsiteClient, EventMenu } = require('../models');
const ApiError = require('../utils/apiError');
const clientPortalService = require('./clientPortal.service');

/**
 * Home → Quick Actions, arranged by the organizer (2026-10-19).
 *
 * The app's Home grid = Edit Event (the app's own tile, always first, never
 * stored) + these. Every other tile must be a MENU THE ACCOUNT'S PLAN GRANTS
 * (Jamal): `available` is exactly that, and a saved list is cut back to it on
 * every read, so a downgraded plan drops its tiles without anyone re-saving.
 *
 * Stored on `website_clients.quick_actions` as ordered BASE slugs — the same
 * menu exists once per event category (`gallery`, `gallery-2`, ...) and Home is
 * not about one event, so the screen key is what is kept.
 */

/** What Home shows before the organizer customises it (the slugs that exist). */
const DEFAULT_SLUGS = [
    'splash-screens', 'guests', 'gallery', 'agenda',
    'event-invitation', 'invite-share', 'messages', 'participants',
];

const baseSlug = (slug) => String(slug || '').replace(/-\d+$/, '');

/** The plan's active menus, one per base slug, in Menu Management's order. */
const availableFor = async (clientId) => {
    const ids = await clientPortalService.ownerGrantedMenuIds(clientId);
    if (!ids.length) return [];
    const menus = await EventMenu.findAll({
        where: { id: { [Op.in]: ids }, is_active: 1 },
        attributes: ['id', 'name', 'slug', 'icon', 'color', 'is_default', 'sort_order'],
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    const seen = new Set();
    const out = [];
    for (const m of menus) {
        const slug = baseSlug(m.slug);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        out.push({
            slug,
            menu_id: m.id,
            name: m.name,
            icon: m.icon || null,
            color: m.color || null,
            is_default: !!m.is_default,
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

const shape = (available, stored) => {
    const allowed = new Set(available.map((m) => m.slug));
    const customised = Array.isArray(stored);
    return {
        available,
        selected: customised ? clean(stored, allowed) : clean(DEFAULT_SLUGS, allowed),
        is_custom: customised,
    };
};

/** GET /client/quick-actions */
const get = async (clientId) => {
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['id', 'quick_actions'] });
    if (!client) throw ApiError.notFound('Account not found.');
    return shape(await availableFor(clientId), client.quick_actions);
};

/**
 * PUT /client/quick-actions `{ slugs: [...] }` — the complete new order.
 * A slug the plan does not grant is dropped, not refused (an app showing a
 * stale list must still be able to save). `slugs: null` = back to the default.
 */
const save = async (clientId, slugs) => {
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['id', 'quick_actions'] });
    if (!client) throw ApiError.notFound('Account not found.');
    const available = await availableFor(clientId);
    if (slugs === null) {
        await WebsiteClient.update({ quick_actions: null }, { where: { id: clientId } });
        return shape(available, null);
    }
    if (!Array.isArray(slugs)) throw ApiError.badRequest('Send the quick actions as a list.');
    const list = clean(slugs, new Set(available.map((m) => m.slug)));
    await WebsiteClient.update({ quick_actions: list }, { where: { id: clientId } });
    return shape(available, list);
};

module.exports = { get, save, DEFAULT_SLUGS, baseSlug };
