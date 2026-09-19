#!/usr/bin/env node
/**
 * Phase 3 of removing Event Type and Religion from the project — the schema.
 *
 * The code stopped reading and writing these in commit 08f3a7f (session §521).
 * This drops what is left in the database:
 *
 *   1. Foreign keys, type/religion-only indexes, and the columns
 *        events, event_templates, subscription_plans ... event_type_id, religion_id
 *        notification_templates ....................... event_type_id
 *        event_menus ................................... event_type_id, religion_id,
 *                                                        is_website, is_mobile
 *      (MySQL trims a dropped column out of any composite index it was part of.)
 *   2. The `religions` and `event_types` tables.
 *   3. RBAC: the `event_types` / `religions` modules, their permissions and
 *      every role grant of those permissions.
 *   4. The `nav.event_types` / `nav.religions` sidebar translations.
 *   5. Approval requests filed against the two modules (soft-deleted — the
 *      service that would execute them no longer exists).
 *
 * A JSON backup of every row it removes, and of every non-NULL value in every
 * column it drops, is written FIRST (--apply only). DDL auto-commits in MySQL,
 * so there is no rollback: the backup is the way back.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/drop-event-type-religion.js                  dry run, local
 *   node src/database/tools/drop-event-type-religion.js --apply          local
 *   node src/database/tools/drop-event-type-religion.js --prod           dry run, production
 *   node src/database/tools/drop-event-type-religion.js --prod --apply   production
 *
 * Idempotent: each step checks what exists, so a re-run (or a run after a
 * partial failure) only does what is still left.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const COLUMNS = {
    events: ['event_type_id', 'religion_id'],
    event_templates: ['event_type_id', 'religion_id'],
    subscription_plans: ['event_type_id', 'religion_id'],
    notification_templates: ['event_type_id'],
    event_menus: ['event_type_id', 'religion_id', 'is_website', 'is_mobile'],
};
const TABLES = ['religions', 'event_types']; // religions first: it references event_types
const MODULE_SLUGS = ['event_types', 'religions'];
const NAV_KEYS = ['nav.event_types', 'nav.religions'];
// An index is a type/religion lookup (and goes) when everything else in it is one of these.
const NEUTRAL_INDEX_COLS = new Set(['company_id', 'deleted_at']);
const BACKUP_DIR = path.join(__dirname, '..', '..', '..', '..', 'prod-backups');

(async () => {
    const DB = process.env.DB_NAME;
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: DB,
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    const q = async (sql, params) => (await conn.query(sql, params))[0];
    const say = (sign, label, text) => console.log(`  ${sign} ${label.padEnd(44)} ${text}`);

    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${DB} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        // ── Plan ─────────────────────────────────────────────────────────────
        const existingCols = await q(
            `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)`,
            [DB, Object.keys(COLUMNS)],
        );
        const has = (t, c) => existingCols.some((r) => r.t === t && r.c === c);

        const fks = await q(
            `SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS name, COLUMN_NAME AS c
               FROM information_schema.KEY_COLUMN_USAGE
              WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                AND (REFERENCED_TABLE_NAME IN (?) OR (TABLE_NAME IN (?) AND COLUMN_NAME IN ('event_type_id','religion_id')))`,
            [DB, TABLES, Object.keys(COLUMNS)],
        );
        const idxRows = await q(
            `SELECT TABLE_NAME AS t, INDEX_NAME AS name, COLUMN_NAME AS c
               FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?) AND INDEX_NAME <> 'PRIMARY'`,
            [DB, Object.keys(COLUMNS)],
        );
        const indexes = new Map(); // "t|name" -> [cols]
        idxRows.forEach((r) => {
            const k = `${r.t}|${r.name}`;
            if (!indexes.has(k)) indexes.set(k, []);
            indexes.get(k).push(r.c);
        });
        const fkNames = new Set(fks.map((f) => `${f.t}|${f.name}`));
        const indexesToDrop = [...indexes]
            .filter(([k, cols]) => {
                const [t] = k.split('|');
                if (fkNames.has(k)) return false; // the FK's own index — goes with the column
                const dropped = cols.filter((c) => (COLUMNS[t] || []).includes(c));
                return dropped.length && cols.every((c) => dropped.includes(c) || NEUTRAL_INDEX_COLS.has(c));
            })
            .map(([k]) => { const [t, name] = k.split('|'); return { t, name }; });

        const tablesLeft = await q(
            'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)',
            [DB, TABLES],
        );
        const modules = await q('SELECT * FROM modules WHERE slug IN (?)', [MODULE_SLUGS]);
        const moduleIds = modules.map((m) => m.id);
        const permissions = moduleIds.length
            ? await q('SELECT * FROM permissions WHERE module_id IN (?) OR slug LIKE ? OR slug LIKE ?', [moduleIds, 'event_types.%', 'religions.%'])
            : await q('SELECT * FROM permissions WHERE slug LIKE ? OR slug LIKE ?', ['event_types.%', 'religions.%']);
        const permIds = permissions.map((p) => p.id);
        const rolePerms = permIds.length ? await q('SELECT * FROM role_permissions WHERE permission_id IN (?)', [permIds]) : [];
        const navKeys = await q('SELECT * FROM translation_keys WHERE `key` IN (?)', [NAV_KEYS]);
        const navTranslations = navKeys.length
            ? await q('SELECT * FROM translations WHERE translation_key_id IN (?)', [navKeys.map((k) => k.id)])
            : [];
        const missingKeys = await q('SELECT * FROM missing_translation_keys WHERE `key` IN (?)', [NAV_KEYS]);
        const approvals = await q(
            'SELECT * FROM approval_requests WHERE module_slug IN (?) AND deleted_at IS NULL', [MODULE_SLUGS]);

        for (const [t, cols] of Object.entries(COLUMNS)) {
            for (const c of cols) say(has(t, c) ? '-' : '=', `${t}.${c}`, has(t, c) ? 'drop column' : 'already gone');
        }
        fks.forEach((f) => say('-', `FK ${f.t}.${f.name}`, 'drop'));
        indexesToDrop.forEach((i) => say('-', `index ${i.t}.${i.name}`, 'drop'));
        TABLES.forEach((t) => say(tablesLeft.some((r) => r.t === t) ? '-' : '=', `table ${t}`,
            tablesLeft.some((r) => r.t === t) ? 'drop table' : 'already gone'));
        say('-', 'RBAC', `${modules.length} module(s), ${permissions.length} permission(s), ${rolePerms.length} role grant(s)`);
        say('-', 'translations', `${navKeys.length} key(s), ${navTranslations.length} value(s), ${missingKeys.length} missing-key row(s)`);
        say('-', 'approval requests', `${approvals.length} soft-deleted`);

        if (!APPLY) {
            console.log('\nDry run — nothing written.');
            return;
        }

        // ── Backup ───────────────────────────────────────────────────────────
        const backup = { tables: {}, columns: {}, modules, permissions, rolePerms, navKeys, navTranslations, missingKeys, approvals };
        for (const { t } of tablesLeft) backup.tables[t] = await q(`SELECT * FROM \`${t}\``);
        for (const [t, cols] of Object.entries(COLUMNS)) {
            const present = cols.filter((c) => has(t, c));
            if (!present.length) continue;
            backup.columns[t] = await q(
                `SELECT id, ${present.map((c) => `\`${c}\``).join(', ')} FROM \`${t}\`
                  WHERE ${present.map((c) => `\`${c}\` IS NOT NULL`).join(' OR ')}`,
            );
        }
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const file = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-drop-event-type-religion-${Date.now()}.json`);
        fs.writeFileSync(file, JSON.stringify(backup, null, 2));
        console.log(`\n  backup: ${file}\n`);

        // ── Schema ───────────────────────────────────────────────────────────
        for (const f of fks) {
            await q(`ALTER TABLE \`${f.t}\` DROP FOREIGN KEY \`${f.name}\``);
            say('✓', `FK ${f.t}.${f.name}`, 'dropped');
        }
        for (const i of indexesToDrop) {
            await q(`ALTER TABLE \`${i.t}\` DROP INDEX \`${i.name}\``);
            say('✓', `index ${i.t}.${i.name}`, 'dropped');
        }
        for (const [t, cols] of Object.entries(COLUMNS)) {
            const present = cols.filter((c) => has(t, c));
            if (!present.length) continue;
            await q(`ALTER TABLE \`${t}\` ${present.map((c) => `DROP COLUMN \`${c}\``).join(', ')}`);
            say('✓', t, `dropped ${present.join(', ')}`);
        }
        for (const t of TABLES) {
            if (!tablesLeft.some((r) => r.t === t)) continue;
            await q(`DROP TABLE \`${t}\``);
            say('✓', `table ${t}`, 'dropped');
        }

        // ── Data ─────────────────────────────────────────────────────────────
        await conn.beginTransaction();
        try {
            if (permIds.length) {
                await q('DELETE FROM role_permissions WHERE permission_id IN (?)', [permIds]);
                await q('DELETE FROM permissions WHERE id IN (?)', [permIds]);
            }
            if (moduleIds.length) await q('DELETE FROM modules WHERE id IN (?)', [moduleIds]);
            if (navKeys.length) {
                await q('DELETE FROM translations WHERE translation_key_id IN (?)', [navKeys.map((k) => k.id)]);
                await q('DELETE FROM translation_keys WHERE id IN (?)', [navKeys.map((k) => k.id)]);
            }
            if (missingKeys.length) await q('DELETE FROM missing_translation_keys WHERE id IN (?)', [missingKeys.map((k) => k.id)]);
            if (approvals.length) {
                await q('UPDATE approval_requests SET deleted_at = NOW() WHERE id IN (?)', [approvals.map((a) => a.id)]);
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }
        say('✓', 'RBAC / translations / approvals', 'removed');
        console.log('\n  applied.');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error(`\nFAILED: ${err.message}`);
    process.exit(1);
});
