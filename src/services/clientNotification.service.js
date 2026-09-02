const { Sequelize, ClientNotification, ClientNotificationPref } = require('../models');
const { Op, fn, col, literal } = Sequelize;
const ApiError = require('../utils/apiError');

/**
 * The client's notification feed.
 *
 * ── THIS MODULE IS WRITTEN TO, NOT CALLED BY THE CLIENT ─────────────────────
 * `notify()` is the seam every other service uses to tell a client something
 * happened — a message campaign went out, an RSVP arrived, an event is
 * tomorrow. There is deliberately NO route that creates a notification: a
 * client who could write their own feed could forge "Payment Successful".
 *
 * The client-facing routes are all reads plus read/archive flags.
 *
 * ── ⚠ notify() MUST NEVER BREAK ITS CALLER ──────────────────────────────────
 * A failed notification is not a failed send. If writing the feed row throws —
 * the table is missing on a stale deploy, a column is too short — the campaign
 * that just went out must still be reported as sent. So `notify` swallows and
 * logs rather than propagating, and every caller treats it as fire-and-forget.
 *
 * That is the opposite of the usual rule, and it is deliberate: the feed is a
 * record OF the work, never a precondition FOR it.
 */

/* ── Categories ──────────────────────────────────────────────────────────── */

/**
 * Which tab a type lands under.
 *
 * Declared as a map rather than passed in by each caller, so a new type gets a
 * category once, here, instead of being filed differently by two call sites.
 */
const TYPE_CATEGORY = {
    // Messaging
    campaign_sent: 'system',
    campaign_scheduled: 'system',
    guest_message: 'message',
    // RSVP
    rsvp_accepted: 'rsvp',
    rsvp_declined: 'rsvp',
    rsvp_maybe: 'rsvp',
    // Guests
    guest_added: 'guest',
    guest_imported: 'guest',
    // Reminders
    event_reminder: 'reminder',
    draft_reminder: 'reminder',
    // Billing and lifecycle
    payment_received: 'system',
    event_published: 'system',
};

const CATEGORIES = ['rsvp', 'reminder', 'message', 'system', 'guest'];

/* ── Writing ─────────────────────────────────────────────────────────────── */

/**
 * Record something for a client to see.
 *
 * ⚠ Fire and forget. Returns the row on success and `null` on failure, and
 * never throws — see the header. Callers do not await a result they act on.
 *
 * `respectPrefs` consults `client_notification_prefs` for the in-app channel:
 * a client who switched a type off should stop seeing it, and honouring that
 * here means no caller has to remember to check.
 */
async function notify(clientId, {
    type,
    title,
    body = null,
    eventId = null,
    guestId = null,
    link = null,
    meta = null,
    companyId = null,
    respectPrefs = true,
} = {}) {
    try {
        if (!clientId || !type || !title) return null;

        if (respectPrefs) {
            const pref = await ClientNotificationPref.findOne({
                where: { website_client_id: clientId, channel: 'in_app', type },
            });
            // Absent means never configured, which is ON. Only an explicit
            // `enabled = 0` silences a type — a missing row must not silently
            // swallow every notification the moment a new type is introduced.
            if (pref && !pref.enabled) return null;
        }

        return await ClientNotification.create({
            website_client_id: clientId,
            company_id: companyId,
            category: TYPE_CATEGORY[type] || 'system',
            type,
            title: String(title).slice(0, 200),
            body: body ? String(body).slice(0, 500) : null,
            event_id: eventId,
            guest_id: guestId,
            link,
            meta,
        });
    } catch (err) {
        // Logged, never rethrown. The work that triggered this already happened.
        console.error(`[notify] could not record "${type}" for client ${clientId}:`, err.message);
        return null;
    }
}

/**
 * The same, for many clients at once.
 *
 * One INSERT rather than N — production is ~374ms a round trip, so a loop over
 * fifty clients is twenty seconds of nothing.
 */
async function notifyMany(rows = []) {
    if (!rows.length) return 0;
    try {
        const prepared = rows
            .filter((r) => r.clientId && r.type && r.title)
            .map((r) => ({
                website_client_id: r.clientId,
                company_id: r.companyId ?? null,
                category: TYPE_CATEGORY[r.type] || 'system',
                type: r.type,
                title: String(r.title).slice(0, 200),
                body: r.body ? String(r.body).slice(0, 500) : null,
                event_id: r.eventId ?? null,
                guest_id: r.guestId ?? null,
                link: r.link ?? null,
                meta: r.meta ?? null,
            }));
        if (!prepared.length) return 0;
        await ClientNotification.bulkCreate(prepared);
        return prepared.length;
    } catch (err) {
        console.error('[notifyMany] could not record notifications:', err.message);
        return 0;
    }
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

const shape = (row) => {
    const j = row.toJSON ? row.toJSON() : row;
    return {
        id: Number(j.id),
        category: j.category,
        type: j.type,
        title: j.title,
        body: j.body,
        event_id: j.event_id,
        guest_id: j.guest_id,
        link: j.link,
        meta: j.meta ?? null,
        is_read: Boolean(j.is_read),
        read_at: j.read_at,
        created_at: j.created_at,
        event: j.event ? { id: j.event.id, name: j.event.name } : null,
        guest: j.guest
            ? { id: j.guest.id, name: j.guest.name, email: j.guest.email, mobile: j.guest.mobile }
            : null,
    };
};

/**
 * The feed.
 *
 * `unread` is a separate flag rather than a sixth category, because the design's
 * Unread tab crosses all five: it is a filter on the same list, not a kind of
 * notification.
 */
const list = async (clientId, {
    category, unread, search, page = 1, limit = 10, includeArchived = false,
} = {}) => {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(50, Math.max(1, Number(limit) || 10));

    const where = { website_client_id: clientId };
    if (!includeArchived) where.archived_at = null;
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (unread === true || unread === 'true') where.is_read = false;
    if (search) {
        const like = `%${String(search).trim()}%`;
        where[Op.or] = [{ title: { [Op.like]: like } }, { body: { [Op.like]: like } }];
    }

    const { rows, count } = await ClientNotification.findAndCountAll({
        where,
        include: [
            { association: 'event', attributes: ['id', 'name'], required: false },
            {
                association: 'guest',
                attributes: ['id', 'name', 'email', 'mobile'],
                required: false,
                // The guest table is paranoid; a notification about somebody
                // since removed should still show who it was about.
                paranoid: false,
            },
        ],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        offset: (p - 1) * l,
        limit: l,
    });

    return {
        notifications: rows.map(shape),
        pagination: { page: p, limit: l, totalItems: count, totalPages: Math.ceil(count / l) || 1 },
        stats: await getStats(clientId),
    };
};

/**
 * The four tiles, plus the per-tab counts the tab bar needs.
 *
 * ⚠ Counted over the WHOLE account, never the filtered page. A "Total
 * Notifications" that moved while somebody typed in the search box would be
 * reporting the search.
 */
const getStats = async (clientId) => {
    const byCategory = await ClientNotification.findAll({
        where: { website_client_id: clientId, archived_at: null },
        attributes: [
            'category',
            [fn('COUNT', col('id')), 'total'],
            [fn('SUM', literal('CASE WHEN is_read = 0 THEN 1 ELSE 0 END')), 'unread'],
        ],
        group: ['category'],
        raw: true,
    });

    const counts = {};
    let total = 0;
    let unread = 0;
    for (const row of byCategory) {
        const t = Number(row.total);
        const u = Number(row.unread);
        counts[row.category] = { total: t, unread: u };
        total += t;
        unread += u;
    }
    for (const c of CATEGORIES) counts[c] = counts[c] || { total: 0, unread: 0 };

    return {
        total,
        unread,
        // The design's own two tiles. Named from the categories rather than
        // recomputed, so a tile and its tab can never disagree.
        reminders: counts.reminder.total,
        guest_activity: counts.guest.total + counts.rsvp.total,
        by_category: counts,
    };
};

/** Just the badge. One indexed COUNT — this runs on every page load. */
const unreadCount = async (clientId) =>
    ClientNotification.count({
        where: { website_client_id: clientId, is_read: false, archived_at: null },
    });

/* ── Flags ───────────────────────────────────────────────────────────────── */

/** Owner-scoped: "not found" and "not yours" are the same answer, deliberately. */
const own = async (clientId, id) => {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        throw ApiError.notFound('Notification not found.');
    }
    const row = await ClientNotification.findOne({
        where: { id: numeric, website_client_id: clientId },
    });
    if (!row) throw ApiError.notFound('Notification not found.');
    return row;
};

const markRead = async (clientId, id, read = true) => {
    const row = await own(clientId, id);
    row.is_read = read;
    // Cleared when un-reading, so "read at" can never name a time the client
    // has since undone.
    row.read_at = read ? new Date() : null;
    await row.save();
    return shape(row);
};

/**
 * Mark everything read.
 *
 * Scoped to what is actually SHOWING — unarchived, and the same category filter
 * the feed is under. "Mark all as read" pressed while looking at the RSVP tab
 * must not silently clear the System tab the client has not looked at.
 */
const markAllRead = async (clientId, { category } = {}) => {
    const where = { website_client_id: clientId, is_read: false, archived_at: null };
    if (category && CATEGORIES.includes(category)) where.category = category;
    const [affected] = await ClientNotification.update(
        { is_read: true, read_at: new Date() },
        { where },
    );
    return { marked: affected, stats: await getStats(clientId) };
};

/**
 * Archive.
 *
 * Also marks read: a row you have dealt with is not still waiting for you, and
 * leaving it unread would keep the badge lit for something removed from view.
 */
const archive = async (clientId, id) => {
    const row = await own(clientId, id);
    row.archived_at = new Date();
    if (!row.is_read) { row.is_read = true; row.read_at = new Date(); }
    await row.save();
    return { id: Number(row.id), stats: await getStats(clientId) };
};

module.exports = {
    notify,
    notifyMany,
    list,
    getStats,
    unreadCount,
    markRead,
    markAllRead,
    archive,
    TYPE_CATEGORY,
    CATEGORIES,
};
