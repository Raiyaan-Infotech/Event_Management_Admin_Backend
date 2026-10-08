/**
 * Read-only: one client's events (live + soft-deleted) and their plan's event
 * limit, looked up by mobile number. Used before clearing a test account.
 *
 *   node src/database/tools/client-events-report.js 7010051951          (local)
 *   node src/database/tools/client-events-report.js 7010051951 --prod   (production)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PROD = process.argv.includes('--prod');
const MOBILE = process.argv.slice(2).find((a) => !a.startsWith('--'));

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
    if (!MOBILE) throw new Error('Pass a mobile number.');
    const env = parseEnv(PROD ? '.env.production' : '.env');
    const conn = await mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        ssl: PROD && env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : undefined,
    });
    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}`);

    const [clients] = await conn.query(
        `SELECT * FROM website_clients WHERE mobile LIKE ? OR mobile LIKE ?`,
        [`%${MOBILE}`, `%${MOBILE}%`]
    );
    if (!clients.length) {
        console.log('No client with that mobile.');
        await conn.end();
        return;
    }
    for (const c of clients) {
        console.log(`\nclient #${c.id}  ${c.name ?? c.first_name ?? ''}  mobile=${c.mobile}  plan_id=${c.plan_id ?? c.subscription_id ?? '-'}`);
        const [events] = await conn.query(
            `SELECT id, name, start_date, status, deleted_at FROM events
              WHERE website_client_id = ? ORDER BY id`,
            [c.id]
        );
        for (const e of events) {
            console.log(`  event #${e.id}  ${e.deleted_at ? 'DELETED' : 'live   '}  ${e.start_date ?? ''}  ${e.name}`);
        }
        console.log(`  total ${events.length} (live ${events.filter((e) => !e.deleted_at).length})`);
    }
    await conn.end();
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
