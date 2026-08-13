/**
 * Point a company's public website at a host.
 *
 * `company_websites.slug` and `.custom_domain` decide which site a request to
 * the public app resolves to, but nothing in the admin UI or the API can set
 * them — this is the only way to do it today.
 *
 *   node scratch/set_site_domain.js --company=1 --domain=my-app.vercel.app
 *   node scratch/set_site_domain.js --company=1 --domain=my-app.vercel.app --apply
 *   node scratch/set_site_domain.js --company=1 --slug=acme --apply
 *   node scratch/set_site_domain.js --company=1 --clear-domain --apply
 *
 * Dry-run by default; nothing is written without --apply.
 *
 * Against production, pass the connection explicitly — this file reads the
 * local .env otherwise:
 *   node scratch/set_site_domain.js --url="mysql://user:pass@host:port/db" --company=1 --domain=... --apply
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.length ? rest.join('=') : true];
  })
);

const APPLY = Boolean(args.apply);
const companyId = Number(args.company || 1);

/** Same normalisation the backend applies to an incoming Host, so what is
 *  stored is what will actually be compared against. */
const normalizeHost = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .split('/')[0]
  .split(':')[0]
  .replace(/^www\./, '');

(async () => {
  if (!args.domain && !args.slug && !args['clear-domain']) {
    console.error('Nothing to do. Pass --domain=, --slug= or --clear-domain.');
    process.exit(1);
  }

  const conn = args.url
    ? await mysql.createConnection({ uri: String(args.url), charset: 'utf8mb4' })
    : await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
    });

  const [rows] = await conn.execute(
    'SELECT id, company_id, slug, custom_domain, status, is_active FROM company_websites WHERE company_id = ? ORDER BY id ASC',
    [companyId]
  );

  if (!rows.length) {
    console.error(`No company_websites row for company_id=${companyId}.`);
    await conn.end();
    process.exit(1);
  }

  const site = rows[0];
  const updates = {};

  if (args.slug) updates.slug = normalizeHost(args.slug);
  if (args['clear-domain']) updates.custom_domain = null;
  else if (args.domain) updates.custom_domain = normalizeHost(args.domain);

  console.log(`\ncompany_websites id=${site.id} (company ${site.company_id})`);
  console.log(`  status         ${site.status}${site.status === 'published' ? '' : '   <-- NOT published: the public app will 404 on every host'}`);
  for (const [col, next] of Object.entries(updates)) {
    console.log(`  ${col.padEnd(14)} ${JSON.stringify(site[col])}  ->  ${JSON.stringify(next)}`);
  }

  // A host can only belong to one site; two rows sharing one would make
  // resolution order-dependent.
  if (updates.custom_domain) {
    const [clash] = await conn.execute(
      'SELECT id, company_id FROM company_websites WHERE custom_domain = ? AND id <> ?',
      [updates.custom_domain, site.id]
    );
    if (clash.length) {
      console.error(`\n  ABORT: ${updates.custom_domain} is already on site id=${clash[0].id} (company ${clash[0].company_id}).`);
      await conn.end();
      process.exit(1);
    }
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.\n');
    await conn.end();
    return;
  }

  const setClause = Object.keys(updates).map((col) => `${col} = ?`).join(', ');
  await conn.execute(
    `UPDATE company_websites SET ${setClause}, updated_at = NOW() WHERE id = ?`,
    [...Object.values(updates), site.id]
  );

  const [after] = await conn.execute(
    'SELECT slug, custom_domain FROM company_websites WHERE id = ?',
    [site.id]
  );
  console.log('\nWritten:', JSON.stringify(after[0]), '\n');

  await conn.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
