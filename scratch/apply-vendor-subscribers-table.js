// One-off: create vendor_subscribers table on local + live (Aiven) DBs.
// Usage: node scratch/apply-vendor-subscribers-table.js
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const CREATE_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'database', 'migrations', 'sql', '20260623-vendor-subscribers.sql'),
  'utf8',
);

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function apply(label, env) {
  if (!env.DB_HOST) { console.log(`[${label}] no DB_HOST, skipping`); return; }
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: env.DB_HOST.includes('aivencloud.com') ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  });
  try {
    await conn.query(CREATE_SQL);
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [env.DB_NAME, 'vendor_subscribers'],
    );
    console.log(`[${label}] ${env.DB_NAME} → vendor_subscribers exists: ${rows[0].c === 1}`);
  } finally {
    await conn.end();
  }
}

(async () => {
  const root = path.join(__dirname, '..');
  await apply('LOCAL', parseEnv(path.join(root, '.env')));
  await apply('LIVE', parseEnv(path.join(root, '.env.production')));
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
