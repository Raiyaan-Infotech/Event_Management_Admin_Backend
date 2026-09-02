const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const parseEnv = (file) => {
    const out = {};
    const raw = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
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

(async () => {
    const local = await connect(process.env);
    const prodEnv = parseEnv('.env.production');
    const prod = await connect(prodEnv);

    console.log('--- LOCAL DB CHECK FOR "integrat" ---');
    const [localTables] = await local.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE '%integrat%'",
        [process.env.DB_NAME]
    );
    console.log('Local tables with integrat:', localTables);

    const [localCols] = await local.query(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME LIKE '%integrat%'",
        [process.env.DB_NAME]
    );
    console.log('Local columns with integrat:', localCols);

    console.log('\n--- PROD DB CHECK FOR "integrat" ---');
    const [prodTables] = await prod.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE '%integrat%'",
        [prodEnv.DB_NAME]
    );
    console.log('Prod tables with integrat:', prodTables);

    const [prodCols] = await prod.query(
        "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME LIKE '%integrat%'",
        [prodEnv.DB_NAME]
    );
    console.log('Prod columns with integrat:', prodCols);

    await local.end();
    await prod.end();
})().catch(console.error);
