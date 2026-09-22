#!/usr/bin/env node
/**
 * Plan storage limit: `storage_gb` (GB only, fixed list) becomes a number +
 * unit — `storage_limit` (1–100) and `storage_unit` ('MB' / 'GB'), both NULL
 * for unlimited (session §548).
 *
 * TWO PHASES, because the deploy order runs opposite ways for each:
 *
 *   1. default         ADD storage_limit + storage_unit and COPY storage_gb into
 *                      them (unit GB) where still NULL. Run BEFORE deploying the
 *                      new code — the new SubscriptionPlan model selects them.
 *                      Harmless to the old code, which never selects them.
 *   2. --drop-old      DROP storage_gb. Run AFTER the new code is live — the
 *                      old model selects it.
 *
 *   node src/database/tools/apply-plan-storage-unit.js                     dry run, local
 *   node src/database/tools/apply-plan-storage-unit.js --apply             phase 1, local
 *   node src/database/tools/apply-plan-storage-unit.js --drop-old --apply  phase 2, local
 *   (add --prod for production)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');
const DROP_OLD = args.includes('--drop-old');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        charset: 'utf8mb4', ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const q = async (sql, p) => (await conn.query(sql, p))[0];
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(`PHASE ${DROP_OLD ? '2 (drop storage_gb)' : '1 (add + copy)'} — ${APPLY ? 'APPLY' : 'DRY RUN (add --apply to write)'}\n`);

    try {
        const cols = (await q(
            `SELECT COLUMN_NAME FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscription_plans'`
        )).map((r) => r.COLUMN_NAME);
        const hasOld = cols.includes('storage_gb');
        const hasNew = cols.includes('storage_limit') && cols.includes('storage_unit');

        if (DROP_OLD) {
            if (!hasNew) throw new Error('Run phase 1 first — storage_limit / storage_unit are missing.');
            if (!hasOld) { console.log('  = storage_gb already dropped — nothing to do'); return; }
            const rows = await q('SELECT id, name, storage_gb FROM subscription_plans WHERE storage_gb IS NOT NULL');
            console.log(`  - plans holding a storage_gb value: ${rows.length}`);
            if (!APPLY) { console.log('\nDry run — nothing written.'); return; }
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
            const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-plan-storage-drop-old-${Date.now()}.json`);
            fs.writeFileSync(file, JSON.stringify(rows, null, 2));
            console.log(`\n  backup: ${file}`);
            await q('ALTER TABLE subscription_plans DROP COLUMN `storage_gb`');
            console.log('  + subscription_plans: dropped storage_gb');
            return;
        }

        console.log(`  - columns to add: ${hasNew ? '(none — already there)' : 'storage_limit, storage_unit'}`);
        const copies = hasOld
            ? await q(`SELECT id, name, storage_gb FROM subscription_plans
                        WHERE storage_gb IS NOT NULL${hasNew ? ' AND storage_limit IS NULL' : ''}`)
            : [];
        console.log(`  - plans to copy storage_gb into (unit GB): ${copies.length}`);
        copies.forEach((r) => console.log(`      #${r.id} ${r.name}: ${r.storage_gb} GB${r.storage_gb > 100 ? '  ! above the form\'s 1–100 — kept as is' : ''}`));

        if (!APPLY) { console.log('\nDry run — nothing written.'); return; }

        if (!hasNew) {
            // One ALTER, so the table never has only one of the pair.
            const after = cols.includes('max_videos') ? 'max_videos' : 'event_category_id';
            await q(`ALTER TABLE subscription_plans
                ADD COLUMN \`storage_limit\` int unsigned DEFAULT NULL COMMENT 'plan limit 1-100 in storage_unit, NULL = unlimited' AFTER \`${after}\`,
                ADD COLUMN \`storage_unit\` enum('MB','GB') COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'NULL = unlimited' AFTER \`storage_limit\``);
            console.log('  + subscription_plans: added storage_limit, storage_unit');
        }
        for (const r of copies) {
            await q("UPDATE subscription_plans SET storage_limit = ?, storage_unit = 'GB' WHERE id = ?", [r.storage_gb, r.id]);
        }
        if (copies.length) console.log(`  + copied ${copies.length} plan(s)`);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
