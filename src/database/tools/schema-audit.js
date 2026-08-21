/**
 * Compares LOCAL and PRODUCTION schema and reports exactly what is missing.
 *
 * WHY: §219 found production at 0/5 for the whole client portal, and
 * `migrate_website_client_plan.js` had been DELETED after being recorded as
 * "prod dry-run ready" while the column it adds was still missing. The lesson
 * is that "I ran it" is not evidence; the database is. This asks the database.
 *
 * Reports three things, per table:
 *   MISSING TABLE   present locally, absent on production
 *   MISSING COLUMNS present locally, absent on production
 *   EXTRA           present on production, absent locally (usually harmless,
 *                   but worth seeing before anyone concludes the two match)
 *
 * Read-only. It writes nothing to either database.
 *
 *   node src/database/tools/schema-audit.js
 */
require('dotenv').config();
const localEnv = { ...process.env };

// Loading a second .env over the first does not overwrite already-set keys, so
// the production values are read from the file directly rather than via
// process.env — otherwise this would compare production against itself.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const parseEnv = (file) => {
    const out = {};
    // Four levels up: src/database/tools -> src/database -> src -> project root.
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

const connect = (env) =>
    mysql.createConnection({
        host: env.DB_HOST,
        port: env.DB_PORT || 3306,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_NAME,
        charset: 'utf8mb4',
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });

const schemaOf = async (conn, dbName) => {
    const [rows] = await conn.execute(
        `SELECT TABLE_NAME, COLUMN_NAME
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [dbName]
    );
    const map = new Map();
    for (const r of rows) {
        if (!map.has(r.TABLE_NAME)) map.set(r.TABLE_NAME, new Set());
        map.get(r.TABLE_NAME).add(r.COLUMN_NAME);
    }
    return map;
};

(async () => {
    const prodEnv = parseEnv('.env.production');

    const local = await connect(localEnv);
    const prod = await connect(prodEnv);

    console.log(`\nLOCAL       ${localEnv.DB_HOST}  ${localEnv.DB_NAME}`);
    console.log(`PRODUCTION  ${prodEnv.DB_HOST}  ${prodEnv.DB_NAME}\n`);

    const l = await schemaOf(local, localEnv.DB_NAME);
    const p = await schemaOf(prod, prodEnv.DB_NAME);

    const missingTables = [];
    const missingColumns = [];

    for (const [table, cols] of [...l.entries()].sort()) {
        if (!p.has(table)) {
            missingTables.push({ table, columns: cols.size });
            continue;
        }
        const pcols = p.get(table);
        const gap = [...cols].filter((c) => !pcols.has(c));
        if (gap.length) missingColumns.push({ table, missing: gap.join(', ') });
    }

    const extraTables = [...p.keys()].filter((t) => !l.has(t)).sort();

    console.log(`local ${l.size} tables · production ${p.size} tables\n`);

    if (missingTables.length) {
        console.log('MISSING TABLES on production:');
        console.table(missingTables);
    } else {
        console.log('MISSING TABLES on production: none\n');
    }

    if (missingColumns.length) {
        console.log('MISSING COLUMNS on production:');
        console.table(missingColumns);
    } else {
        console.log('MISSING COLUMNS on production: none\n');
    }

    if (extraTables.length) {
        console.log(`Tables on PRODUCTION but not local (${extraTables.length}): ${extraTables.join(', ')}\n`);
    }

    // Row counts for the tables that DO exist on both, so an empty-but-present
    // table is not mistaken for a migrated one that carried its data across.
    const interesting = [
        'events', 'event_guests', 'event_guest_groups', 'event_messages',
        'event_message_campaigns', 'event_templates', 'website_clients',
    ];
    const counts = [];
    for (const t of interesting) {
        const row = { table: t, local: '—', production: '—' };
        if (l.has(t)) {
            const [r] = await local.query(`SELECT COUNT(*) c FROM \`${t}\``);
            row.local = r[0].c;
        }
        if (p.has(t)) {
            const [r] = await prod.query(`SELECT COUNT(*) c FROM \`${t}\``);
            row.production = r[0].c;
        }
        counts.push(row);
    }
    console.log('Row counts:');
    console.table(counts);

    await local.end();
    await prod.end();
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
