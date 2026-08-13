/**
 * Public (unauthenticated) read model for a company's rendered website.
 *
 * Everything else in the website-builder API is addressed by `x-company-id`
 * (see optionalCompanyAuth in companyWebsiteBuilder.routes.js), which is fine
 * for the admin preview but useless for a real site: a visitor on acme.com
 * cannot be expected to send a company id. This module resolves the tenant
 * from the HTTP Host instead, and returns the whole site in ONE payload.
 *
 * One payload is not a nicety. Production MySQL is ~374ms per round trip from
 * the app (see session.md §103); the admin preview fires ~22 separate requests
 * per page. Server-rendering a public page that way costs seconds. Here every
 * query is issued in parallel and the result is cacheable as a unit.
 */
const { sequelize, Sequelize } = require('../models');
const { QueryTypes } = Sequelize;
const websiteService = require('./companyWebsiteBuilder.service');
const translationService = require('./websiteBuilderTranslation.service');

/** Strip port, case and a leading `www.` so DNS variants resolve to one tenant. */
const normalizeHost = (host) => String(host || '')
  .trim()
  .toLowerCase()
  .split(',')[0]
  .split(':')[0]
  .replace(/^www\./, '');

/**
 * Root domain that subdomains hang off, e.g. `eventinvit.app` makes
 * `acme.eventinvit.app` resolve to the site with slug `acme`. Configurable so
 * staging (`*.vercel.app`) and production can differ.
 */
const getRootDomains = () => String(process.env.PUBLIC_SITE_ROOT_DOMAINS || '')
  .split(',')
  .map((d) => normalizeHost(d))
  .filter(Boolean);

/**
 * Host → { kind, value }. A host under a configured root domain is a slug
 * lookup; anything else is treated as a custom domain the customer pointed at
 * us. Returns null for the bare root domain itself (that is the marketing
 * site, not a tenant).
 */
const parseHost = (rawHost) => {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  for (const root of getRootDomains()) {
    if (host === root) return null;
    if (host.endsWith(`.${root}`)) {
      const label = host.slice(0, -1 * (root.length + 1));
      // Only a single label is a tenant slug; deeper nesting is not ours.
      if (!label || label.includes('.')) return null;
      return { kind: 'slug', value: label };
    }
  }

  return { kind: 'custom_domain', value: host };
};

/**
 * Resolve a Host header to a published site row.
 *
 * `slug` and `custom_domain` have lived on company_websites since the table was
 * created but nothing has ever read them for companies — the vendor builder
 * does the equivalent lookup in vendorWebsiteBuilder.service.js.
 */
const resolveSite = async ({ host, slug, companyId }) => {
  let where = null;
  let replacements = {};

  if (companyId) {
    where = 'company_id = :companyId';
    replacements = { companyId: Number(companyId) };
  } else if (slug) {
    where = 'slug = :slug';
    replacements = { slug: normalizeHost(slug) };
  } else {
    const parsed = parseHost(host);
    if (!parsed) return null;
    where = parsed.kind === 'slug' ? 'slug = :value' : 'custom_domain = :value';
    replacements = { value: parsed.value };
  }

  const [row] = await sequelize.query(
    `SELECT id, company_id, slug, custom_domain, status, theme_id, palette_id, settings_json, is_active
       FROM company_websites
      WHERE ${where}
      ORDER BY id ASC
      LIMIT 1`,
    { replacements, type: QueryTypes.SELECT }
  );

  return row || null;
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
};

/**
 * Tables the builder service cannot fetch for us.
 *
 * `getList`/`getSingleton` always scope by `company_id AND website_id`, and
 * these tables have no `website_id` column — the query errors out. The admin
 * controller reaches for raw SQL on exactly these for the same reason. Getting
 * this wrong is invisible: the section simply comes back empty.
 */
const RAW_LISTS = {
  faqs: 'SELECT * FROM company_website_faqs WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  faq_categories: 'SELECT * FROM company_website_faq_categories WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  how_it_works: 'SELECT * FROM company_website_how_it_works WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  templates: 'SELECT * FROM company_templates WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  template_categories: 'SELECT * FROM company_template_categories WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  video_tutorials: 'SELECT * FROM company_website_video_tutorials WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  video_tutorial_categories: 'SELECT * FROM company_website_video_tutorial_categories WHERE company_id = :companyId AND is_active = 1 ORDER BY sort_order ASC, id ASC',
  // No website_id on any of these three.
  features: 'SELECT * FROM company_website_features WHERE company_id = :companyId ORDER BY sort_order ASC, id ASC',
  pricing_plans: 'SELECT * FROM company_website_pricing_plans WHERE company_id = :companyId ORDER BY sort_order ASC, id ASC',
  pricing_matrix_features: 'SELECT * FROM company_website_pricing_matrix_features WHERE company_id = :companyId ORDER BY sort_order ASC, id ASC',
};

/** Singletons with no website_id either. */
const RAW_SINGLETONS = {
  pricing_settings: 'SELECT * FROM company_website_pricing_settings WHERE company_id = :companyId ORDER BY id ASC LIMIT 1',
};

/** Sections the builder service already models, fetched through it. */
const SERVICE_LISTS = {
  social_links: 'socialLinks',
  pages: 'pages',
  menu_items: 'menuItems',
  ui_blocks: 'uiBlocks',
  sliders: 'sliders',
  slider_items: 'sliderItems',
  gallery_categories: 'galleryCategories',
  gallery_items: 'galleryItems',
  contact_categories: 'contactCategories',
  testimonials: 'testimonials',
  clients: 'clients',
  sponsors: 'sponsors',
};

const SERVICE_SINGLETONS = {
  basic_information: 'basicInformation',
  theme_settings: 'themeSettings',
  footer: 'footer',
  seo: 'seo',
  contact_settings: 'contactSettings',
  login_settings: 'loginSettings',
};

/**
 * Hero content is stored oddly: one row per company holds every page's copy
 * inside `design_json`, keyed by page slug — the table has no `page_slug`
 * column at all. The merge is done here rather than shipped to the client
 * because getting it wrong drops the row id, which is what addresses the
 * section's translations (session.md §33.2, §46).
 */
const buildHeroByPage = (heroRow) => {
  if (!heroRow) return {};
  const { design_json, ...base } = heroRow;
  const stored = parseJson(design_json, {}) || {};
  const merged = {};

  for (const [pageSlug, override] of Object.entries(stored)) {
    if (!override || typeof override !== 'object') continue;
    merged[pageSlug] = { ...base, ...override, id: base.id, page_slug: pageSlug };
  }

  // The base row itself is the fallback for any page with no override.
  if (!merged.home) merged.home = { ...base, page_slug: 'home' };
  return merged;
};

const getHighlights = async (companyId) => {
  const rows = await sequelize.query(
    'SELECT * FROM company_website_highlights WHERE company_id = :companyId ORDER BY id ASC',
    { replacements: { companyId }, type: QueryTypes.SELECT }
  );
  // settings_json holds the editor's own state; the top-level columns must be
  // layered back on or the block loses the id its translations hang off (§46).
  return rows.map((row) => ({
    ...parseJson(row.settings_json, {}),
    id: row.id,
    page_slug: row.page_slug,
    instance: row.instance,
  }));
};

/**
 * The whole site in one object. `languageCode` selects which translation
 * overlay ships; omit it for the default language and none is sent.
 */
const getSiteBundle = async ({ host, slug, companyId, languageCode }) => {
  const site = await resolveSite({ host, slug, companyId });
  if (!site) return null;

  const cid = site.company_id;

  // A single failing section must not take the whole page down, but it must
  // not vanish silently either — an empty section looks exactly like "the
  // admin hasn't added any", which is how the missing website_id column above
  // went unnoticed until the counts were read back.
  const guard = (name, promise, fallback) => promise.catch((err) => {
    console.error(`[public-site] section "${name}" failed for company ${cid}:`, err.message);
    return fallback;
  });

  const singletonEntries = Object.entries(SERVICE_SINGLETONS);
  const listEntries = Object.entries(SERVICE_LISTS);
  const rawEntries = Object.entries(RAW_LISTS);
  const rawSingletonEntries = Object.entries(RAW_SINGLETONS);

  const runRaw = (sql) => sequelize.query(sql, { replacements: { companyId: cid }, type: QueryTypes.SELECT });

  const [
    singletonResults,
    listResults,
    rawResults,
    rawSingletonResults,
    heroRow,
    highlights,
    languages,
    translations,
  ] = await Promise.all([
    Promise.all(singletonEntries.map(([name, key]) => guard(name, websiteService.getSingleton(key, cid), null))),
    Promise.all(listEntries.map(([name, key]) => guard(name, websiteService.getList(key, cid), []))),
    Promise.all(rawEntries.map(([name, sql]) => guard(name, runRaw(sql), []))),
    Promise.all(rawSingletonEntries.map(([name, sql]) => guard(name, runRaw(sql), []))),
    guard('hero_sections', websiteService.getSingleton('heroSection', cid), null),
    guard('highlights', getHighlights(cid), []),
    guard('languages', translationService.getPublicLanguages(cid), []),
    languageCode
      ? guard('translations', translationService.getTranslationBundle(cid, { code: languageCode }), { language: null, translations: {} })
      : Promise.resolve({ language: null, translations: {} }),
  ]);

  const bundle = {
    site: {
      id: site.id,
      company_id: site.company_id,
      slug: site.slug,
      custom_domain: site.custom_domain,
      status: site.status,
      theme_id: site.theme_id,
      palette_id: site.palette_id,
      settings: parseJson(site.settings_json, {}),
    },
    hero_sections: buildHeroByPage(heroRow),
    highlights,
    languages,
    translations,
  };

  singletonEntries.forEach(([name], i) => { bundle[name] = singletonResults[i] || {}; });
  listEntries.forEach(([name], i) => { bundle[name] = listResults[i] || []; });
  rawEntries.forEach(([name], i) => { bundle[name] = rawResults[i] || []; });
  rawSingletonEntries.forEach(([name], i) => { bundle[name] = (rawSingletonResults[i] || [])[0] || {}; });

  return bundle;
};

module.exports = {
  normalizeHost,
  parseHost,
  resolveSite,
  getSiteBundle,
};
