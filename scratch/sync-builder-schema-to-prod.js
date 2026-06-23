const fs = require('fs');
const mysql = require('mysql2/promise');

const BUILDER_TABLES = [
  'vendor_websites',
  'vendor_website_basic_information',
  'vendor_website_social_links',
  'vendor_website_pages',
  'vendor_website_menu_items',
  'vendor_website_ui_blocks',
  'vendor_website_hero_sections',
  'vendor_website_sliders',
  'vendor_website_slider_items',
  'vendor_website_gallery_categories',
  'vendor_website_gallery_items',
  'vendor_website_contact_settings',
  'vendor_website_contact_social_links',
  'vendor_website_contact_categories',
  'vendor_website_contact_messages',
  'vendor_website_testimonials',
  'vendor_website_clients',
  'vendor_website_sponsors',
  'vendor_website_footer_settings',
  'vendor_website_seo_settings',
  'vendor_website_publish_snapshots',
];

const HEADER_COLUMNS = [
  ['header_color', "VARCHAR(20) NULL DEFAULT '#FFFFFF'"],
  ['show_social_icons', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ['show_login', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ['show_signin', 'TINYINT(1) NOT NULL DEFAULT 1'],
];

function loadEnv(file) {
  const env = {};
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function connect(env, useSsl = false) {
  return mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME,
    multipleStatements: false,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

async function tableExists(connection, database, tableName) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?`,
    [database, tableName],
  );
  return rows.length > 0;
}

async function ensureHeaderColumns(connection, database) {
  const tableName = 'vendor_website_basic_information';
  const added = [];
  const present = [];

  if (!(await tableExists(connection, database, tableName))) {
    return { added, present };
  }

  for (const [name, definition] of HEADER_COLUMNS) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?`,
      [database, tableName, name],
    );

    if (rows.length) {
      present.push(name);
      continue;
    }

    await connection.query(
      `ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`,
    );
    added.push(name);
  }

  return { added, present };
}

async function main() {
  const localEnvFile = process.argv[2] || '.env';
  const prodEnvFile = process.argv[3] || '.env.production';
  const localEnv = loadEnv(localEnvFile);
  const prodEnv = loadEnv(prodEnvFile);

  const local = await connect(localEnv, false);
  const prod = await connect(prodEnv, true);

  const created = [];
  const existing = [];

  await prod.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const tableName of BUILDER_TABLES) {
      if (await tableExists(prod, prodEnv.DB_NAME, tableName)) {
        existing.push(tableName);
        continue;
      }

      const [rows] = await local.query(`SHOW CREATE TABLE ${tableName}`);
      if (!rows.length || !rows[0]['Create Table']) {
        throw new Error(`Local table ${tableName} does not exist`);
      }

      const createSql = rows[0]['Create Table'].replace(
        /^CREATE TABLE/i,
        'CREATE TABLE IF NOT EXISTS',
      );

      await prod.query(createSql);
      created.push(tableName);
    }

    const headerColumns = await ensureHeaderColumns(prod, prodEnv.DB_NAME);
    console.log(`created=[${created.join(',')}]`);
    console.log(`existing=[${existing.join(',')}]`);
    console.log(
      `headerColumns added=[${headerColumns.added.join(',')}] present=[${headerColumns.present.join(',')}]`,
    );
  } finally {
    await prod.query('SET FOREIGN_KEY_CHECKS = 1');
    await local.end();
    await prod.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
