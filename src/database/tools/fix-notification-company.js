/**
 * Gives notification_templates / notification_categories rows with a NULL
 * `company_id` the company the admin panel runs as (session §592).
 *
 * WHY: `sync-notification-data-to-prod.js` inserted these without `company_id`.
 * The admin list is company-scoped (`base.service` → `company_id = req.companyId`),
 * so on production the Transactional Templates page showed "All Templates (0)"
 * — while the welcome push still fired, because the trigger lookup has no
 * company filter. The sync tool now copies `company_id`; this repairs the rows
 * it already wrote.
 *
 * The company: the ONLY live row in `companies`, or `--company=N` when there is
 * more than one. Only NULLs are touched — a row that already has a company is
 * left alone. One UPDATE per table, in a transaction, after a JSON backup.
 *
 *   node src/database/tools/fix-notification-company.js                    (dry run, local)
 *   node src/database/tools/fix-notification-company.js --prod             (dry run, production)
 *   node src/database/tools/fix-notification-company.js --prod --apply
 *   node src/database/tools/fix-notification-company.js --prod --apply --company=1
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const COMPANY_ARG = (process.argv.find((a) => a.startsWith('--company=')) || '').split('=')[1];
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';
const TABLES = ['notification_categories', 'notification_templates'];

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const l of raw.split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = PROD ? parseEnv('.env.production') : localEnv;
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}  ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

    const [companies] = await conn.query('SELECT id, name FROM companies WHERE deleted_at IS NULL ORDER BY id');
    console.log(`Companies: ${companies.map((c) => `#${c.id} ${c.name}`).join(', ') || '(none)'}`);

    let companyId = COMPANY_ARG ? Number(COMPANY_ARG) : null;
    if (!companyId) {
        if (companies.length !== 1) {
            console.log('\nMore than one company (or none) — pass --company=N to choose.');
            await conn.end();
            return;
        }
        companyId = companies[0].id;
    }
    if (!companies.some((c) => Number(c.id) === companyId)) {
        console.log(`\nCompany #${companyId} does not exist here.`);
        await conn.end();
        return;
    }
    console.log(`Target company: #${companyId}\n`);

    const nulls = {};
    for (const table of TABLES) {
        const [rows] = await conn.query(
            `SELECT id, name, company_id FROM \`${table}\` WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY id`,
        );
        nulls[table] = rows;
        console.log(`${table}: ${rows.length} row(s) with no company`);
        rows.forEach((r) => console.log(`   #${String(r.id).padEnd(4)} ${r.name}`));
    }

    const total = TABLES.reduce((n, t) => n + nulls[t].length, 0);
    if (!APPLY || !total) {
        console.log(APPLY ? '\nNothing to fix.' : '\nDry run — nothing written. Add --apply to write.');
        await conn.end();
        return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-notification-company-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(nulls, null, 2));
    console.log(`\nBackup: ${backup}`);

    await conn.beginTransaction();
    try {
        for (const table of TABLES) {
            if (!nulls[table].length) continue;
            await conn.query(
                `UPDATE \`${table}\` SET company_id = ? WHERE id IN (?) AND company_id IS NULL`,
                [companyId, nulls[table].map((r) => r.id)],
            );
        }
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    }
    console.log(`Updated ${total} row(s) to company #${companyId}. Reload the admin page.`);
    await conn.end();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
