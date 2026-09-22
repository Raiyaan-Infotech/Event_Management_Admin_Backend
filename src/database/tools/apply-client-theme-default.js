/**
 * Client portal theme: default 'light' instead of 'system'.
 *
 *   node src/database/tools/apply-client-theme-default.js                 (dry run, local)
 *   node src/database/tools/apply-client-theme-default.js --apply
 *   node src/database/tools/apply-client-theme-default.js --prod          (dry run, production)
 *   node src/database/tools/apply-client-theme-default.js --prod --apply
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * `client_preferences.theme` defaulted to 'system', and the row is created on
 * the first read of Settings (findOrCreate). ThemeSync then pushes it into
 * next-themes — so every client whose OS is dark got a dark portal they never
 * chose.
 *
 * ── WHAT IT CHANGES ─────────────────────────────────────────────────────────
 * 1. The column default -> 'light' (the model says the same).
 * 2. Rows still on 'system' that were NEVER EDITED (updated_at within a few
 *    seconds of created_at) -> 'light'. Those hold the old default, not a
 *    choice. A row the client has saved is left exactly as it is, 'system'
 *    included — that may be what they picked.
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

const UNEDITED = "theme = 'system' AND updated_at <= DATE_ADD(created_at, INTERVAL 5 SECOND)";

(async () => {
    const q = (sql) => sequelize.query(sql, { type: Sequelize.QueryTypes.SELECT });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    try {
        const [col] = await q(
            "SELECT COLUMN_DEFAULT AS d FROM information_schema.COLUMNS "
            + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_preferences' AND COLUMN_NAME = 'theme'",
        );
        if (!col) throw new Error('client_preferences.theme does not exist here.');
        const [{ n: unedited }] = await q(`SELECT COUNT(*) AS n FROM client_preferences WHERE ${UNEDITED}`);
        const [{ n: chosen }] = await q(
            "SELECT COUNT(*) AS n FROM client_preferences WHERE theme = 'system' AND updated_at > DATE_ADD(created_at, INTERVAL 5 SECOND)",
        );

        const needsDefault = String(col.d).replace(/'/g, '') !== 'light';
        console.log(`  column default: ${col.d}${needsDefault ? "  -> 'light'" : '  (ok)'}`);
        console.log(`  unedited 'system' rows -> 'light': ${unedited}`);
        console.log(`  edited 'system' rows left alone:   ${chosen}`);

        if (!APPLY) { console.log('\n  DRY RUN — add --apply to write.\n'); return; }

        if (needsDefault) {
            await sequelize.query(
                "ALTER TABLE client_preferences MODIFY COLUMN theme ENUM('light','dark','system') NOT NULL DEFAULT 'light'",
            );
        }
        // `updated_at` is set explicitly to itself: MySQL would otherwise not
        // touch it (no ON UPDATE), but being explicit keeps "unedited" true, so a
        // re-run and any later audit still read these as never chosen.
        const [, meta] = await sequelize.query(
            `UPDATE client_preferences SET theme = 'light', updated_at = updated_at WHERE ${UNEDITED}`,
        );
        console.log(`\n  applied — default light, ${meta?.affectedRows ?? meta ?? 0} row(s) moved to light\n`);
    } finally {
        await sequelize.close();
    }
})().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1); });
