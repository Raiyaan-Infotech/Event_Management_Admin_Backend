/**
 * Indexes for the public-site read path.
 *
 * Audited against production: the two columns the tenant lookup runs on have
 * no index at all (EXPLAIN: type=ALL, key=NONE), and the translation bundle —
 * the single heaviest query in the path at ~789ms — full-scans its table.
 *
 *   node -r dotenv/config scratch/add_public_site_indexes.js dotenv_config_path=.env.production
 *   node -r dotenv/config scratch/add_public_site_indexes.js dotenv_config_path=.env.production --apply
 *
 * Dry-run by default. Idempotent: an index that already exists is skipped, so
 * this is safe to re-run against either database.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

const INDEXES = [
  {
    table: 'company_websites',
    name: 'uniq_custom_domain',
    ddl: 'ADD UNIQUE INDEX uniq_custom_domain (custom_domain)',
    why: 'Every public request resolves the Host here. Unindexed today = full scan on the hottest path. UNIQUE also stops two sites claiming one domain, which would make resolution order-dependent.',
  },
  {
    table: 'company_websites',
    name: 'uniq_slug',
    ddl: 'ADD UNIQUE INDEX uniq_slug (slug)',
    why: 'Same for subdomain resolution. The existing uk_company_slug starts with company_id, so a lookup by slug alone cannot use it. Global uniqueness is required: <slug>.<root> must address exactly one tenant, and ensureWebsite generates company-<id>, so it already is unique.',
  },
  {
    table: 'company_website_content_translations',
    name: 'idx_company_language',
    ddl: 'ADD INDEX idx_company_language (company_id, language_id)',
    why: 'The bundle selects by (company_id, language_id). Neither existing index has language_id early enough to help, so it full-scans every translation row.',
  },
  // These five have no index starting at company_id at all — every bundle build
  // full-scans them. Small today; the fix is free.
  { table: 'company_website_theme_settings', name: 'idx_company_website', ddl: 'ADD INDEX idx_company_website (company_id, website_id)', why: 'No company_id index' },
  { table: 'company_website_pages', name: 'idx_company_website', ddl: 'ADD INDEX idx_company_website (company_id, website_id)', why: 'No company_id index' },
  { table: 'company_website_ui_blocks', name: 'idx_company_website', ddl: 'ADD INDEX idx_company_website (company_id, website_id)', why: 'No company_id index' },
  { table: 'company_website_contact_categories', name: 'idx_company_website', ddl: 'ADD INDEX idx_company_website (company_id, website_id)', why: 'No company_id index' },
  { table: 'company_website_how_it_works', name: 'idx_company', ddl: 'ADD INDEX idx_company (company_id)', why: 'No company_id index (table has no website_id column)' },
];

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    ssl: { rejectUnauthorized: false },
  });

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} against ${process.env.DB_NAME}@${process.env.DB_HOST}\n`);

  for (const idx of INDEXES) {
    const [existing] = await conn.query(
      `SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
      [process.env.DB_NAME, idx.table, idx.name]
    );

    if (existing.length) {
      console.log(`  SKIP   ${idx.table}.${idx.name} — already exists`);
      continue;
    }

    // A UNIQUE index fails loudly on existing duplicates. Check first so the
    // report says which rows are in the way rather than just an error code.
    const uniqueCol = idx.ddl.match(/ADD UNIQUE INDEX \w+ \((\w+)\)/);
    if (uniqueCol) {
      const col = uniqueCol[1];
      const [dupes] = await conn.query(
        `SELECT ${col} v, COUNT(*) c FROM ${idx.table}
          WHERE ${col} IS NOT NULL GROUP BY ${col} HAVING c > 1`
      );
      if (dupes.length) {
        console.log(`  BLOCKED ${idx.table}.${idx.name} — duplicate ${col}: ${dupes.map((d) => `${d.v} x${d.c}`).join(', ')}`);
        continue;
      }
    }

    if (!APPLY) {
      console.log(`  WOULD ADD ${idx.table}.${idx.name}\n            ${idx.why}`);
      continue;
    }

    const started = Date.now();
    await conn.query(`ALTER TABLE \`${idx.table}\` ${idx.ddl}`);
    console.log(`  ADDED  ${idx.table}.${idx.name}  (${Date.now() - started}ms)`);
  }

  if (!APPLY) console.log('\nRe-run with --apply to write.\n');

  await conn.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
