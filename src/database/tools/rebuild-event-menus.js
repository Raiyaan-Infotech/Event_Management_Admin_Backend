#!/usr/bin/env node
/**
 * Deletes EVERY event menu and rebuilds the catalogue from the list below.
 *
 * ── THE LIST ────────────────────────────────────────────────────────────────
 * Jamal's twelve (Event Info, Agenda, Venue, Gallery, Family, Participants,
 * Near By, Chat, Wishes, Social Wall, Downloads, Contact Us) plus the seven the
 * code looks up by slug and would otherwise lose:
 *   rsvp .................. portal "RSVPs" sidebar, QR-registration RSVP gating, app tile
 *   invite-share .......... app tile
 *   guests, messages, splash-screens
 *                           ... client-portal sidebar sections (lib/navigation.ts)
 * (Analytics and Notification Templates are NOT menus — the portal always
 * shows them. See remove-event-menu.js.)
 * Slugs MUST match: event_client_single lib/navigation.ts `section`,
 * Event_Invite_Mobile_App wedding_home_screen.dart `_routes`, and
 * subscriptionPlan.service LIMIT_CATALOG keys.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *   1. Backs up every event_menus row (live AND soft-deleted), every grant,
 *      and every events / plan_types menu_ids list.
 *   2. In ONE transaction: deletes all grants and all menus (hard delete),
 *      inserts the new catalogue with ids 1…N, re-creates each plan's grants
 *      by SLUG (limits kept — so plans keep what they had), and
 *      re-points events.menu_ids / plan_types.menu_ids by slug. A menu whose
 *      slug is not in the new list (e.g. an old "speakers") is dropped from
 *      grants and events.
 *   3. Resets AUTO_INCREMENT to N+1.
 * Every menu gets the event category named CATEGORY_NAME. An existing icon /
 * colour / description for the same slug is kept; otherwise the defaults below.
 *
 *   node src/database/tools/rebuild-event-menus.js                  dry run, local
 *   node src/database/tools/rebuild-event-menus.js --apply          local
 *   node src/database/tools/rebuild-event-menus.js --prod           dry run, production
 *   node src/database/tools/rebuild-event-menus.js --prod --apply   production
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}

const CATEGORY_NAME = 'Wedding';
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

// group: core = chosen per event in the wizard · app = mobile feature granted by
// the plan · portal = client-portal sidebar section. web/mob = per-platform Active.
const CATALOGUE = [
    { slug: 'event-information', name: 'Event Information', group: 'core', web: 1, mob: 1, icon: 'mdi:information-outline', color: '#6E22FE' },
    { slug: 'agenda', name: 'Agenda', group: 'core', web: 1, mob: 1, icon: 'mdi:calendar-clock', color: '#F59E0B' },
    { slug: 'venue', name: 'Venue', group: 'core', web: 1, mob: 1, icon: 'mdi:map-marker-outline', color: '#EF4444' },
    { slug: 'gallery', name: 'Gallery', group: 'core', web: 1, mob: 1, icon: 'mdi:image-multiple', color: '#EC4899' },
    { slug: 'rsvp', name: 'RSVP', group: 'core', web: 1, mob: 1, icon: 'mdi:clipboard-check-outline', color: '#10B981' },
    { slug: 'contact-us', name: 'Contact Us', group: 'core', web: 1, mob: 1, icon: 'mdi:phone-outline', color: '#0D9488' },
    { slug: 'family', name: 'Family', group: 'app', web: 0, mob: 1, icon: 'mdi:account-group', color: '#8B5CF6' },
    { slug: 'participants', name: 'Participants', group: 'app', web: 0, mob: 1, icon: 'mdi:clipboard-list-outline', color: '#0EA5E9' },
    { slug: 'invite-share', name: 'Invite & Share', group: 'app', web: 0, mob: 1, icon: 'mdi:share-variant', color: '#14B8A6' },
    { slug: 'near-by', name: 'Near By', group: 'app', web: 0, mob: 1, icon: 'mdi:near-me', color: '#F97316' },
    { slug: 'chat', name: 'Chat', group: 'app', web: 0, mob: 1, icon: 'mdi:chat-outline', color: '#3B82F6' },
    { slug: 'wishes', name: 'Wishes', group: 'app', web: 0, mob: 1, icon: 'mdi:heart-outline', color: '#E11D48' },
    { slug: 'social-wall', name: 'Social Wall', group: 'app', web: 0, mob: 1, icon: 'mdi:post-outline', color: '#6366F1' },
    { slug: 'downloads', name: 'Downloads', group: 'app', web: 0, mob: 1, icon: 'mdi:download', color: '#22C55E' },
    { slug: 'guests', name: 'Guests', group: 'portal', web: 1, mob: 1, icon: 'mdi:account-multiple-outline', color: '#7C3AED' },
    { slug: 'messages', name: 'Messages', group: 'portal', web: 1, mob: 0, icon: 'mdi:message-text-outline', color: '#2563EB' },
    { slug: 'splash-screens', name: 'Splash Screens', group: 'portal', web: 1, mob: 0, icon: 'mdi:cellphone-screenshot', color: '#DB2777' },
];

const parseIds = (raw) => {
    if (raw === null || raw === undefined) return null;
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.map(Number) : null;
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        charset: 'utf8mb4', ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        const [cat] = await q('SELECT id FROM event_categories WHERE name = ? AND deleted_at IS NULL ORDER BY id LIMIT 1', [CATEGORY_NAME]);
        if (!cat) throw new Error(`No "${CATEGORY_NAME}" event category.`);
        const oldMenus = await q('SELECT * FROM event_menus ORDER BY id');
        const live = oldMenus.filter((m) => !m.deleted_at);
        const companyId = (live.find((m) => m.company_id) || oldMenus.find((m) => m.company_id) || {}).company_id ?? null;
        const grants = await q('SELECT * FROM subscription_plan_menus ORDER BY id');
        const events = await q('SELECT id, menu_ids FROM events WHERE menu_ids IS NOT NULL');
        const planTypes = await q('SELECT id, menu_ids FROM plan_types WHERE menu_ids IS NOT NULL');

        // Old id -> slug (live rows only; a soft-deleted row's grant is dead anyway).
        const slugById = new Map(live.map((m) => [m.id, m.slug]));
        const oldBySlug = new Map(live.map((m) => [m.slug, m]));
        const newIdBySlug = new Map(CATALOGUE.map((c, i) => [c.slug, i + 1]));
        const remap = (id) => newIdBySlug.get(slugById.get(Number(id)));

        const newRows = CATALOGUE.map((c, i) => {
            const old = oldBySlug.get(c.slug);
            return {
                id: i + 1, name: c.name, slug: c.slug, menu_group: c.group,
                description: old?.description ?? null, remarks: old?.remarks ?? null,
                event_category_id: cat.id,
                active_website: c.web, active_mobile: c.mob,
                icon: old?.icon || c.icon, color: old?.color || c.color,
                sort_order: i + 1, is_active: 1, company_id: companyId,
            };
        });

        const newGrants = [];
        const seen = new Set();
        let droppedGrants = 0;
        for (const g of grants) {
            const id = remap(g.menu_id);
            if (!id) { droppedGrants += 1; continue; }
            const key = `${g.plan_id}|${id}`;
            if (seen.has(key)) { droppedGrants += 1; continue; }
            seen.add(key);
            newGrants.push({ ...g, menu_id: id });
        }
        const remapList = (list) => [...new Set(list.map(remap).filter(Boolean))];
        const eventFixes = events.map((e) => ({ id: e.id, before: parseIds(e.menu_ids) }))
            .filter((e) => e.before).map((e) => ({ ...e, after: remapList(e.before) }));
        const ptFixes = planTypes.map((e) => ({ id: e.id, before: parseIds(e.menu_ids) }))
            .filter((e) => e.before).map((e) => ({ ...e, after: remapList(e.before) }));

        const gone = live.filter((m) => !newIdBySlug.has(m.slug)).map((m) => m.slug);
        console.log(`  delete   ${oldMenus.length} menu rows (${live.length} live, ${oldMenus.length - live.length} soft-deleted)`);
        console.log(`  create   ${newRows.length} menus, category "${CATEGORY_NAME}" (#${cat.id}), company ${companyId}`);
        newRows.forEach((r) => console.log(`             #${String(r.id).padEnd(3)} ${r.slug.padEnd(24)} ${r.menu_group.padEnd(7)} web ${r.active_website} mob ${r.active_mobile}  ${r.icon}`));
        console.log(`  grants   ${grants.length} -> ${newGrants.length} (dropped ${droppedGrants}: menu not in the new list or duplicate)`);
        console.log(`  events   ${eventFixes.length} menu_ids list(s) re-pointed · plan_types ${ptFixes.length}`);
        if (gone.length) console.log(`  ⚠ live menus NOT in the new list (grants removed): ${gone.join(', ')}`);

        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }

        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-rebuild-event-menus-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify({ oldMenus, grants, events, planTypes }, null, 2));
        console.log(`\n  backup: ${file}`);

        await conn.beginTransaction();
        try {
            await q('DELETE FROM subscription_plan_menus');
            await q('DELETE FROM event_menus');
            const cols = Object.keys(newRows[0]);
            await q(`INSERT INTO event_menus (${cols.join(', ')}, created_at, updated_at) VALUES ?`,
                [newRows.map((r) => [...cols.map((c) => r[c]), new Date(), new Date()])]);
            if (newGrants.length) {
                await q(`INSERT INTO subscription_plan_menus (plan_id, menu_id, limits_json, sort_order, created_at, updated_at) VALUES ?`,
                    [newGrants.map((g) => [g.plan_id, g.menu_id,
                        g.limits_json === null ? null : (typeof g.limits_json === 'string' ? g.limits_json : JSON.stringify(g.limits_json)),
                        g.sort_order, g.created_at, new Date()])]);
            }
            for (const [table, fixes] of [['events', eventFixes], ['plan_types', ptFixes]]) {
                if (!fixes.length) continue;
                await q(`UPDATE ${table} SET menu_ids = CASE id ${fixes.map(() => 'WHEN ? THEN CAST(? AS JSON)').join(' ')} END WHERE id IN (?)`,
                    [...fixes.flatMap((f) => [f.id, JSON.stringify(f.after)]), fixes.map((f) => f.id)]);
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }
        await q(`ALTER TABLE event_menus AUTO_INCREMENT = ${newRows.length + 1}`);
        console.log('  applied.');
    } finally {
        await conn.end();
    }
})().catch((err) => { console.error(`\nFAILED: ${err.message}`); process.exit(1); });
