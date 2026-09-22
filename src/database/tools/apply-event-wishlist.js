/**
 * Event wishlist: `website_clients.favourite_events`.
 *
 *   node src/database/tools/apply-event-wishlist.js                 (dry run, local)
 *   node src/database/tools/apply-event-wishlist.js --apply
 *   node src/database/tools/apply-event-wishlist.js --prod          (dry run, production)
 *   node src/database/tools/apply-event-wishlist.js --prod --apply
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * The mobile app's Home replaces its "Invitations" tile with "Wishlist", and
 * every event card gets a heart. The list has to survive a reinstall and follow
 * the person to a second device, so it cannot live in SharedPreferences.
 *
 * ── WHY A JSON COLUMN AND NOT A TABLE ───────────────────────────────────────
 * It mirrors `favourite_templates`, which is the same shape of problem (a short
 * per-client list of ids, always read and written whole) and already sits on
 * this table. A join table would index better and would not read-modify-write,
 * but this list is per-client, small, and toggled from one device at a time —
 * and a second pattern for "the client's favourites" would be the worse cost.
 *
 * ⚠ The column holds ids the CLIENT chose, so it is not a permission of any
 * kind. Every read re-checks that the client may still see each event (owner,
 * or a guest row naming them) — see clientEvent.service's wishlist functions.
 * An id that stops being visible simply drops out of the list.
 *
 * Re-runnable: a second run finds nothing to do.
 */
require('dotenv').config();
const path = require('path');

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const { sequelize, Sequelize } = require('../../models');

(async () => {
    const q = (sql) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    try {
        const [table] = await q(
            "SELECT TABLE_NAME AS t FROM information_schema.TABLES "
            + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'website_clients'",
        );
        if (!table) throw new Error('website_clients does not exist here.');

        const [col] = await q(
            "SELECT COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS "
            + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'website_clients' "
            + "AND COLUMN_NAME = 'favourite_events'",
        );

        if (col) {
            console.log(`  website_clients.favourite_events: present (${col.d})  =`);
            console.log('\n  Nothing to do.\n');
            return;
        }

        console.log('  website_clients.favourite_events: MISSING  -> add JSON NULL');

        if (!APPLY) { console.log('\n  DRY RUN — add --apply to write.\n'); return; }

        // NULL-able with no default: MySQL will not accept a default on JSON,
        // and NULL is the honest value for "has never hearted anything" — the
        // service reads it as an empty list either way.
        await sequelize.query(
            'ALTER TABLE website_clients '
            + 'ADD COLUMN favourite_events JSON NULL AFTER favourite_templates',
        );

        console.log('\n  applied — website_clients.favourite_events added\n');
    } finally {
        await sequelize.close();
    }
})().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1); });
