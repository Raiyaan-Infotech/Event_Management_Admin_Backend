/**
 * Sets the agreed Plan Configuration numbers on the four live plans.
 *
 * Matched by the FIRST WORD of the name, because the ids differ between local
 * and production and so do the names: production has "Free" / "Basic", local has
 * "Free Trial Plan" / "Basic Plan". Anything whose first word is not one of the
 * four tiers (Enterprise, Wedding Special, Corporate, the QA plan) is left
 * alone, and a tier that matches nothing is reported rather than skipped.
 *
 *   node src/database/tools/apply-plan-config.js              (dry run, local)
 *   node src/database/tools/apply-plan-config.js --apply
 *   node src/database/tools/apply-plan-config.js --prod --apply
 */
require('dotenv').config();
const localEnv = { ...process.env };

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const PROD = process.argv.includes('--prod');
const BACKUP_DIR = 'D:\\Jamal\\prod-backups';

// storage is (limit, unit) — all four are MB.
const CONFIG = {
    Free: { max_events: 1, max_photos: 5, max_videos: 1, storage_limit: 15, storage_unit: 'MB', max_guests_per_event: 5 },
    Basic: { max_events: 2, max_photos: 7, max_videos: 2, storage_limit: 25, storage_unit: 'MB', max_guests_per_event: 10 },
    Standard: { max_events: 3, max_photos: 9, max_videos: 3, storage_limit: 50, storage_unit: 'MB', max_guests_per_event: 15 },
    Premium: { max_events: 5, max_photos: 15, max_videos: 5, storage_limit: 100, storage_unit: 'MB', max_guests_per_event: 25 },
};

const FIELDS = ['max_events', 'max_photos', 'max_videos', 'storage_limit', 'storage_unit', 'max_guests_per_event'];

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
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

    console.log(`${PROD ? 'PRODUCTION' : 'LOCAL'}  ${env.DB_HOST}  ${env.DB_NAME}\n`);

    const [plans] = await conn.query(
        `SELECT id, name, ${FIELDS.join(', ')} FROM subscription_plans WHERE deleted_at IS NULL ORDER BY id`
    );

    const tierOf = (name) => {
        const first = String(name).trim().split(/\s+/)[0];
        return Object.keys(CONFIG).find((k) => k.toLowerCase() === first.toLowerCase()) || null;
    };

    const touched = [];
    for (const plan of plans) {
        const tier = tierOf(plan.name);
        const want = tier ? CONFIG[tier] : null;
        if (!want) continue;
        const diff = FIELDS.filter((f) => String(plan[f] ?? '') !== String(want[f]));
        console.log(
            `#${String(plan.id).padEnd(3)} ${plan.name.padEnd(10)} ` +
            FIELDS.map((f) => `${f.replace('max_', '').replace('_per_event', '/ev').replace('storage_', 'stor_')}=${plan[f] ?? 'NULL'}->${want[f]}`).join(' ') +
            (diff.length ? '' : '   (already set)')
        );
        if (diff.length) touched.push({ plan, want });
    }

    const missing = Object.keys(CONFIG).filter((n) => !plans.some((p) => tierOf(p.name) === n));
    if (missing.length) console.log(`\nNOT FOUND (left alone): ${missing.join(', ')}`);

    if (!touched.length) {
        console.log('\nNothing to change.');
        await conn.end();
        return;
    }

    if (!APPLY) {
        console.log(`\n${touched.length} plan(s) would change. Dry run — re-run with --apply.`);
        await conn.end();
        return;
    }

    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backup = path.join(BACKUP_DIR, `${PROD ? 'prod' : 'local'}-plan-config-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(plans, null, 2));
    console.log(`\nBackup: ${backup}`);

    for (const { plan, want } of touched) {
        await conn.query(
            `UPDATE subscription_plans SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
            [...FIELDS.map((f) => want[f]), plan.id]
        );
        console.log(`updated #${plan.id} ${plan.name}`);
    }

    await conn.end();
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
