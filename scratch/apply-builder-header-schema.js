const fs = require('fs');
const mysql = require('mysql2/promise');

function loadEnv(file) {
  const env = {};
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function main() {
  const envFile = process.argv[2] || '.env';
  const env = loadEnv(envFile);
  const database = env.DB_NAME;

  if (!env.DB_HOST || !database || !env.DB_USER) {
    throw new Error(`${envFile} is missing DB_HOST, DB_NAME, or DB_USER`);
  }

  const connection = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    database,
    ssl: envFile.includes('production') ? { rejectUnauthorized: false } : undefined,
  });

  const columns = [
    ['header_color', "VARCHAR(20) NULL DEFAULT '#FFFFFF'"],
    ['show_social_icons', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['show_login', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ['show_signin', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ];

  const added = [];
  const present = [];

  for (const [name, definition] of columns) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [database, 'vendor_website_basic_information', name],
    );

    if (rows.length) {
      present.push(name);
      continue;
    }

    await connection.query(
      `ALTER TABLE vendor_website_basic_information ADD COLUMN ${name} ${definition}`,
    );
    added.push(name);
  }

  await connection.end();

  console.log(
    `${envFile}: added=[${added.join(',')}] present=[${present.join(',')}]`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
