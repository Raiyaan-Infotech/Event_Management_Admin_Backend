const { sequelize, Sequelize } = require('../models');
const autoTranslateService = require('./autoTranslate.service');
const { QueryTypes } = Sequelize;

const LANG_TABLE = 'company_website_builder_languages';
const TRANSLATIONS_TABLE = 'company_website_content_translations';
const KEYS_TABLE = 'company_website_translation_keys';

// Catalog of user-facing text that lives in the Website Builder content tables.
// The registry is built by scanning these directly, so content already saved in
// the DB is translatable without having to re-save each section from the UI.
// `nameCol` (optional) identifies a row in multi-row sections.
const FIELD_CATALOG = {
  'basic-information': {
    table: 'company_website_basic_information',
    singleton: true,
    nameCol: 'company_name',
    fields: [
      { col: 'company_name', label: 'Company Name' },
      { col: 'address', label: 'Address', type: 'textarea' },
    ],
  },
  // Hero is structurally special: per-page content lives inside `design_json`
  // (keyed by page slug) and the CTA labels live inside button_1_json /
  // button_2_json, so it needs a custom extractor rather than plain columns.
  'hero-section': {
    table: 'company_website_hero_sections',
    singleton: true,
    nameCol: 'title',
    fields: [
      { col: 'badge_text', label: 'Badge Text' },
      { col: 'title', label: 'Title' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
    extract: (row) => {
      const parse = (v) => {
        if (!v) return null;
        if (typeof v === 'object') return v;
        try { return JSON.parse(v); } catch { return null; }
      };

      const pageMap = parse(row.design_json) || {};
      const pages = Object.keys(pageMap).length > 0 ? Object.keys(pageMap) : ['home'];

      return pages.map((pageSlug) => {
        const pageData = pageMap[pageSlug] || {};
        // design_json holds the per-page override; top-level columns are the
        // fallback for whichever page was saved most recently.
        const pick = (key) => pageData[key] ?? row[key] ?? '';
        const btn1 = parse(pageData.button_1_json) || parse(row.button_1_json) || {};
        const btn2 = parse(pageData.button_2_json) || parse(row.button_2_json) || {};

        return {
          page_slug: pageSlug,
          record_id: row.id,
          fields: [
            { key: 'badge_text', label: 'Badge Text', type: 'input', value: pick('badge_text') },
            { key: 'title', label: 'Title', type: 'input', value: pick('title') },
            { key: 'description', label: 'Description', type: 'textarea', value: pick('description') },
            { key: 'button_1_label', label: 'Button 1 Label', type: 'input', value: btn1.label || '' },
            { key: 'button_2_label', label: 'Button 2 Label', type: 'input', value: btn2.label || '' },
          ],
        };
      });
    },
  },
  footer: {
    table: 'company_website_footer_settings',
    singleton: true,
    nameCol: 'company_name',
    fields: [
      { col: 'company_name', label: 'Company Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
      { col: 'top_list_heading', label: 'Links Heading 1' },
      { col: 'top_list_heading_2', label: 'Links Heading 2' },
      { col: 'copyright_text', label: 'Copyright Text' },
      { col: 'powered_by_text', label: 'Powered By Text' },
    ],
  },
  seo: {
    table: 'company_website_seo_settings',
    singleton: true,
    nameCol: 'default_title',
    fields: [
      { col: 'site_name', label: 'Site Name' },
      { col: 'default_title', label: 'Default Title' },
      { col: 'default_description', label: 'Default Description', type: 'textarea' },
      { col: 'og_title', label: 'OG Title' },
      { col: 'og_description', label: 'OG Description', type: 'textarea' },
    ],
  },
  'login-page': {
    table: 'company_website_login_settings',
    singleton: true,
    fields: [
      { col: 'title', label: 'Title' },
      { col: 'subtitle', label: 'Subtitle' },
    ],
  },
  testimonials: {
    table: 'company_website_testimonials',
    nameCol: 'customer_name',
    fields: [
      { col: 'customer_name', label: 'Customer Name' },
      { col: 'event_name', label: 'Event Name' },
      { col: 'feedback', label: 'Feedback', type: 'textarea' },
    ],
  },
  features: {
    table: 'company_website_features',
    nameCol: 'title',
    fields: [
      { col: 'title', label: 'Title' },
      { col: 'short_description', label: 'Short Description', type: 'textarea' },
      { col: 'detailed_description', label: 'Detailed Description', type: 'textarea' },
    ],
  },
  'how-it-works': {
    table: 'company_website_how_it_works',
    nameCol: 'title',
    fields: [
      { col: 'title', label: 'Title' },
      { col: 'description', label: 'Description', type: 'textarea' },
      { col: 'highlight_title', label: 'Highlight Title' },
      { col: 'highlight_subtext', label: 'Highlight Subtext' },
    ],
  },
  'pricing-plans': {
    table: 'company_website_pricing_plans',
    nameCol: 'plan_name',
    fields: [
      { col: 'plan_name', label: 'Plan Name' },
      { col: 'subtitle', label: 'Subtitle' },
      { col: 'period_label', label: 'Period Label' },
      { col: 'badge_text', label: 'Badge Text' },
    ],
  },
  faqs: {
    table: 'company_website_faqs',
    nameCol: 'question',
    fields: [
      { col: 'question', label: 'Question', type: 'textarea' },
      { col: 'answer', label: 'Answer', type: 'textarea' },
    ],
  },
  templates: {
    table: 'company_templates',
    nameCol: 'template_name',
    fields: [
      { col: 'template_name', label: 'Template Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'nav-menu': {
    table: 'company_website_menu_items',
    nameCol: 'label',
    fields: [{ col: 'label', label: 'Menu Label' }],
  },
  sliders: {
    table: 'company_website_slider_items',
    nameCol: 'title',
    fields: [
      { col: 'title', label: 'Title' },
      { col: 'description', label: 'Description', type: 'textarea' },
      { col: 'button_label', label: 'Button Label' },
    ],
  },
  gallery: {
    table: 'company_website_gallery_items',
    nameCol: 'event_name',
    fields: [
      { col: 'event_name', label: 'Event Name' },
      { col: 'alt_text', label: 'Alt Text' },
    ],
  },
  clients: {
    table: 'company_website_clients',
    nameCol: 'name',
    fields: [{ col: 'name', label: 'Client Name' }],
  },
  sponsors: {
    table: 'company_website_sponsors',
    nameCol: 'name',
    fields: [{ col: 'name', label: 'Sponsor Name' }],
  },
  'video-tutorials': {
    table: 'company_website_video_tutorials',
    nameCol: 'title',
    fields: [
      { col: 'title', label: 'Title' },
      { col: 'short_description', label: 'Short Description', type: 'textarea' },
      { col: 'key_takeaways', label: 'Key Takeaways', type: 'textarea' },
    ],
  },
  pages: {
    table: 'company_website_pages',
    nameCol: 'title',
    fields: [
      { col: 'title', label: 'Title' },
      { col: 'excerpt', label: 'Excerpt', type: 'textarea' },
      { col: 'seo_title', label: 'SEO Title' },
      { col: 'seo_description', label: 'SEO Description', type: 'textarea' },
    ],
  },

  // Highlights is per (page_slug, instance) and stores everything inside
  // `settings_json`, so like hero it needs a custom extractor. Each highlight
  // card contributes two keys, addressed by its position in the items array —
  // reordering cards in the admin re-points the translations, which is the same
  // trade-off the rest of the JSON-backed sections make.
  highlights: {
    table: 'company_website_highlights',
    fields: [],
    extract: (row) => {
      let settings = row.settings_json;
      if (typeof settings === 'string') {
        try { settings = JSON.parse(settings); } catch { settings = null; }
      }
      const items = Array.isArray(settings?.items) ? settings.items : [];
      if (items.length === 0) return [];

      const fields = [];
      items.forEach((item, index) => {
        const position = index + 1;
        fields.push({
          key: `item_${position}_title`,
          label: `Card ${position} Title`,
          type: 'input',
          value: item?.title || '',
        });
        fields.push({
          key: `item_${position}_description`,
          label: `Card ${position} Description`,
          type: 'input',
          value: item?.description || '',
        });
      });

      // instance 1 and 2 of the same page are separate rows, so the row id
      // keeps their slots distinct even though page_slug matches.
      return [{ page_slug: row.page_slug || '', record_id: row.id, fields }];
    },
  },

  'pricing-settings': {
    table: 'company_website_pricing_settings',
    singleton: true,
    nameCol: 'section_title',
    fields: [
      { col: 'section_title', label: 'Section Title' },
      { col: 'section_subtitle', label: 'Section Subtitle', type: 'textarea' },
      { col: 'badge_text', label: 'Badge Text' },
      { col: 'individual_heading', label: 'Individual Heading' },
      { col: 'individual_subheading', label: 'Individual Subheading', type: 'textarea' },
      { col: 'company_heading', label: 'Company Heading' },
      { col: 'company_subheading', label: 'Company Subheading', type: 'textarea' },
    ],
  },
  'pricing-features': {
    table: 'company_website_pricing_matrix_features',
    nameCol: 'feature_name',
    fields: [
      { col: 'feature_name', label: 'Feature Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'social-links': {
    table: 'company_website_social_links',
    nameCol: 'label',
    fields: [{ col: 'label', label: 'Link Label' }],
  },
  'slider-settings': {
    table: 'company_website_sliders',
    singleton: true,
    nameCol: 'title',
    fields: [{ col: 'title', label: 'Slider Title' }],
  },

  // ── Category / taxonomy tables ────────────────────────────────────────────
  // These render as user-facing filter pills and labels on the public site, so
  // their names need translating just as much as the content they group.
  'template-categories': {
    table: 'company_template_categories',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Category Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'faq-categories': {
    table: 'company_website_faq_categories',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Category Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'gallery-categories': {
    table: 'company_website_gallery_categories',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Category Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'contact-categories': {
    table: 'company_website_contact_categories',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Category Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'video-tutorial-categories': {
    table: 'company_website_video_tutorial_categories',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Category Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'video-tutorial-subcategories': {
    table: 'company_website_video_tutorial_subcategories',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Sub Category Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'video-tutorial-difficulty-levels': {
    table: 'company_website_video_tutorial_difficulty_levels',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Level Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  'video-tutorial-types': {
    table: 'company_website_video_tutorial_types',
    nameCol: 'name',
    fields: [
      { col: 'name', label: 'Type Name' },
      { col: 'description', label: 'Description', type: 'textarea' },
    ],
  },
};

// Static UI chrome — section headings, button labels, form placeholders — that
// isn't admin-entered content, so there is no DB row for FIELD_CATALOG to scan.
// Registered as a fixed list instead, all under the single slot
// `ui-chrome|''|0`. The rendered site's `t()` reads this slot; unmatched keys
// still fall back to the static src/locales/website-builder/*.json bundle, so
// nothing breaks for a language that hasn't been given DB overrides yet.
//
// Keys and English defaults must stay in sync with the `t('key', 'default')`
// call sites in components/company-website-preview/sections/*.tsx.
const UI_CHROME_SECTION = 'ui-chrome';
const UI_CHROME_KEYS = [
  ['header.contact', 'Contact Us'],
  ['header.login', 'Login'],
  ['header.more', 'More'],
  ['hero.get_started', 'Get Started'],
  ['features.title', 'Features'],
  ['features.subtitle', 'All the Features You Need'],
  ['features.view_details', 'View Feature'],
  ['how_it_works.badge', 'WORKING PROCESS'],
  ['how_it_works.title', 'How It Works'],
  ['how_it_works.subtitle', 'Get your event website ready in 4 simple steps'],
  ['templates.title', 'Stunning Templates for Every Occasion'],
  ['templates.subtitle', 'Choose From Beautiful Templates'],
  ['templates.all_categories', 'All Templates'],
  ['templates.popular', 'Popular'],
  ['templates.preview', 'Preview'],
  ['pricing.yearly', 'Yearly Billing'],
  ['pricing.save_discount', 'Save up to 20%'],
  ['pricing.most_popular', 'Most Popular'],
  ['pricing.get_started', 'Get Started Free'],
  ['pricing.choose_plan', 'Choose {planName}'],
  ['pricing.all_plans_include', 'All Plans Include'],
  ['pricing.view_all_features', 'View All Features'],
  ['pricing.matrix_title', 'Powerful Features in Every Plan'],
  ['pricing.matrix_subtitle', 'Everything you need to create, manage and share amazing events.'],
  ['testimonials.title', 'Testimonials'],
  ['testimonials.subtitle', 'What Our Clients Say'],
  ['faqs.title', 'Frequently Asked Questions'],
  ['faqs.subtitle', 'Got questions? We have got answers.'],
  ['gallery.title', 'Our Gallery'],
  ['gallery.all', 'All'],
  ['gallery.no_images', 'No images in this category yet.'],
  ['contact.title', 'Get In Touch'],
  ['contact.subtitle', 'Send Us a Message'],
  ['contact.form_hint', "Fill out the form and our team will get back to you shortly."],
  ['contact.info_title', 'Contact Information'],
  ['contact.full_name', 'Full Name'],
  ['contact.full_name_placeholder', 'Enter your full name'],
  ['contact.email_address', 'Email Address'],
  ['contact.email_placeholder', 'Enter your email address'],
  ['contact.phone_number', 'Phone Number'],
  ['contact.phone_placeholder', 'Enter your phone number'],
  ['contact.subject', 'Subject'],
  ['contact.select_subject', 'Select a subject'],
  ['contact.message', 'Message'],
  ['contact.message_placeholder', 'Type your message here...'],
  ['contact.send_message', 'Send Message'],
  ['contact.email_us', 'Email Us'],
  ['contact.call_us', 'Call Us'],
  ['contact.head_office', 'Head Office'],
  ['login_demo.ready_title', 'Ready to Create Your Event App?'],
  ['login_demo.ready_subtitle', 'Join thousands of happy customers who trust {companyName} for their special moments.'],
  ['login_demo.get_started_free', 'Get Started Free'],
  ['login_demo.view_demo_app', 'View Demo App'],
  ['footer.newsletter', 'Newsletter'],
  ['footer.newsletter_subtitle', 'Subscribe to get updates and offers'],
  ['footer.email_placeholder', 'Enter your email'],
  ['footer.quick_links', 'Quick Links'],
  ['footer.company', 'Company'],
  ['footer.made_with', 'Made with'],
  ['footer.for_moments', 'for your special moments'],
  ['footer.all_rights_reserved', 'All Rights Reserved.'],
].map(([key, defaultValue]) => ({
  key,
  // "how_it_works.badge" -> "How It Works · Badge" — readable in the admin
  // Translations table without hand-writing 61 individual labels.
  label: key
    .split('.')
    .map((part) => part.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' · '),
  type: 'input',
  value: defaultValue,
}));

const registerUiChromeKeys = (companyId) =>
  registerKeys(companyId, {
    section: UI_CHROME_SECTION,
    page_slug: '',
    record_id: 0,
    fields: UI_CHROME_KEYS,
  });

const columnCache = new Map();
const getTableColumns = async (table) => {
  if (columnCache.has(table)) return columnCache.get(table);
  try {
    const cols = await sequelize.query(`SHOW COLUMNS FROM ${table}`, { type: QueryTypes.SELECT });
    const set = new Set(cols.map((c) => c.Field));
    columnCache.set(table, set);
    return set;
  } catch {
    columnCache.set(table, null);
    return null;
  }
};

const truncate = (value, max = 40) => {
  const s = String(value || '').replace(/<[^>]*>/g, '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

// Resolves the company's active website row — content tables are scoped by
// website_id as well as company_id, so scanning without it surfaces stale rows
// belonging to other/older websites.
const getActiveWebsiteId = async (companyId) => {
  try {
    const [row] = await sequelize.query(
      `SELECT id FROM company_websites WHERE company_id = ? ORDER BY id ASC LIMIT 1`,
      { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return row ? row.id : null;
  } catch {
    return null;
  }
};

// Scans the content tables and upserts a key row for every non-empty
// translatable value found. Existing translations are untouched — only the
// English source text is refreshed. Keys whose source content has since been
// deleted are pruned so the table doesn't accumulate ghosts.
const syncKeysFromContent = async (companyId) => {
  let discovered = 0;
  const seen = new Set();
  const websiteId = await getActiveWebsiteId(companyId);

  // Static UI chrome has no backing table to scan, so it's registered
  // directly rather than discovered from a SELECT. Excluded from FIELD_CATALOG
  // itself so the loop below (and the prune step after it) never touch it —
  // section is not in FIELD_CATALOG, so pruning already treats it as
  // manually-registered and leaves it alone.
  await registerUiChromeKeys(companyId);

  for (const [section, config] of Object.entries(FIELD_CATALOG)) {
    const cols = await getTableColumns(config.table);
    if (!cols) continue; // table doesn't exist in this DB

    const usableFields = (config.fields || []).filter((f) => cols.has(f.col));
    // Sections with a custom extractor read JSON columns rather than the plain
    // `fields` list, so an empty list is expected there and must not skip them.
    if (usableFields.length === 0 && !config.extract) continue;

    const hasPageSlug = cols.has('page_slug');
    // Custom extractors need the whole row (they read JSON columns too)
    const selectCols = config.extract ? ['*'] : ['id', ...usableFields.map((f) => f.col)];
    if (!config.extract) {
      if (hasPageSlug) selectCols.push('page_slug');
      if (config.nameCol && cols.has(config.nameCol) && !selectCols.includes(config.nameCol)) {
        selectCols.push(config.nameCol);
      }
    }

    let sql = `SELECT ${selectCols.join(', ')} FROM ${config.table} WHERE company_id = ?`;
    const replacements = [companyId];
    if (websiteId && cols.has('website_id')) {
      sql += ` AND (website_id = ? OR website_id IS NULL)`;
      replacements.push(websiteId);
    }
    sql += ` ORDER BY id ASC`;
    // Singleton sections are read by the app with LIMIT 1 — mirror that so
    // duplicate rows the UI never displays don't show up as translation keys.
    if (config.singleton) sql += ` LIMIT 1`;

    let rows;
    try {
      rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
    } catch {
      continue;
    }

    const multiRow = rows.length > 1;
    for (const row of rows) {
      // A section can yield several slots from one row (e.g. hero, one per page)
      const entries = config.extract
        ? config.extract(row)
        : [
            {
              page_slug: hasPageSlug ? row.page_slug || '' : '',
              record_id: row.id,
              fields: usableFields.map((f) => ({
                key: f.col,
                label: f.label,
                type: f.type || 'input',
                value: row[f.col],
              })),
            },
          ];

      const rowName = config.nameCol ? truncate(row[config.nameCol], 30) : '';

      for (const entry of entries) {
        const pageSlug = entry.page_slug || '';
        const recordId = entry.record_id ?? row.id;

        const fields = entry.fields
          .filter((f) => String(f.value || '').trim() !== '')
          .map((f) => ({
            ...f,
            label: multiRow && rowName ? `${f.label} — ${rowName}` : f.label,
          }));

        if (fields.length === 0) continue;

        await registerKeys(companyId, { section, page_slug: pageSlug, record_id: recordId, fields });
        fields.forEach((f) => seen.add(`${section}|${pageSlug}|${recordId}|${f.key}`));
        discovered += fields.length;
      }
    }
  }

  // Prune keys whose backing content no longer exists.
  // NOTE: only the key row is removed — saved translations are deliberately
  // left in place. A key can disappear because its slot address changed rather
  // than because the content was deleted, and destroying a translator's work on
  // that assumption is not recoverable. Orphaned translation rows are tiny and
  // are re-adopted automatically if the same slot reappears.
  let pruned = 0;
  const existing = await sequelize.query(
    `SELECT id, section, page_slug, record_id, field_key FROM ${KEYS_TABLE} WHERE company_id = ?`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  for (const key of existing) {
    if (!FIELD_CATALOG[key.section]) continue; // leave manually-registered sections alone
    const slot = `${key.section}|${key.page_slug || ''}|${key.record_id}|${key.field_key}`;
    if (!seen.has(slot)) {
      await sequelize.query(`DELETE FROM ${KEYS_TABLE} WHERE id = ? AND company_id = ?`, {
        replacements: [key.id, companyId],
        type: QueryTypes.DELETE,
      });
      pruned += 1;
    }
  }

  return { discovered, pruned };
};

const getLanguages = async (companyId) => {
  return sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE company_id = ? ORDER BY sort_order ASC, id ASC`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
};

const createLanguage = async (companyId, data = {}) => {
  const { code, name, native_name = null, direction = 'ltr', sort_order = 0 } = data;
  const [insertId] = await sequelize.query(
    `INSERT INTO ${LANG_TABLE} (company_id, code, name, native_name, direction, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
    { replacements: [companyId, code, name, native_name, direction, sort_order], type: QueryTypes.INSERT }
  );
  const [row] = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE id = ?`,
    { replacements: [insertId], type: QueryTypes.SELECT }
  );
  return row;
};

const updateLanguage = async (companyId, id, data = {}) => {
  const allowed = ['code', 'name', 'native_name', 'direction', 'sort_order', 'is_active'];
  const updates = {};
  allowed.forEach((key) => {
    if (data[key] !== undefined) updates[key] = data[key];
  });
  const setClause = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  if (setClause) {
    await sequelize.query(
      `UPDATE ${LANG_TABLE} SET ${setClause}, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      { replacements: [...Object.values(updates), id, companyId], type: QueryTypes.UPDATE }
    );
  }
  const [row] = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.SELECT }
  );
  return row;
};

const setDefaultLanguage = async (companyId, id) => {
  await sequelize.query(
    `UPDATE ${LANG_TABLE} SET is_default = 0 WHERE company_id = ?`,
    { replacements: [companyId], type: QueryTypes.UPDATE }
  );
  await sequelize.query(
    `UPDATE ${LANG_TABLE} SET is_default = 1, is_active = 1, updated_at = NOW() WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.UPDATE }
  );
  const [row] = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.SELECT }
  );
  return row;
};

const deleteLanguage = async (companyId, id) => {
  await sequelize.query(
    `DELETE FROM ${TRANSLATIONS_TABLE} WHERE language_id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.DELETE }
  );
  await sequelize.query(
    `DELETE FROM ${LANG_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.DELETE }
  );
  return { id, deleted: true };
};

// Returns { [languageId]: { [fieldKey]: value } } for a given content slot
const getContentTranslations = async (companyId, section, pageSlug = '', recordId = 0) => {
  const rows = await sequelize.query(
    `SELECT language_id, field_key, value FROM ${TRANSLATIONS_TABLE}
     WHERE company_id = ? AND section = ? AND page_slug = ? AND record_id = ?`,
    { replacements: [companyId, section, pageSlug || '', recordId || 0], type: QueryTypes.SELECT }
  );
  const byLanguage = {};
  rows.forEach((row) => {
    if (!byLanguage[row.language_id]) byLanguage[row.language_id] = {};
    byLanguage[row.language_id][row.field_key] = row.value;
  });
  return byLanguage;
};

// Upserts every field in `values` for one language in one content slot.
// `status` mirrors the admin module: 'reviewed' for human edits, 'auto' for
// machine translations.
// The translation API sometimes returns trailing newlines/padding
// (e.g. "seemantha\n\n\n") — normalise before persisting.
const cleanValue = (raw) =>
  String(raw ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const saveContentTranslations = async (
  companyId,
  { section, page_slug = '', record_id = 0, language_id, values = {}, status = 'reviewed' }
) => {
  const fieldKeys = Object.keys(values);
  for (const fieldKey of fieldKeys) {
    const value = cleanValue(values[fieldKey]);
    const [existing] = await sequelize.query(
      `SELECT id FROM ${TRANSLATIONS_TABLE}
       WHERE company_id = ? AND section = ? AND page_slug = ? AND record_id = ? AND field_key = ? AND language_id = ?`,
      { replacements: [companyId, section, page_slug || '', record_id || 0, fieldKey, language_id], type: QueryTypes.SELECT }
    );
    if (existing) {
      await sequelize.query(
        `UPDATE ${TRANSLATIONS_TABLE} SET value = ?, status = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [value, status, existing.id], type: QueryTypes.UPDATE }
      );
    } else {
      await sequelize.query(
        `INSERT INTO ${TRANSLATIONS_TABLE} (company_id, section, page_slug, record_id, field_key, language_id, value, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [companyId, section, page_slug || '', record_id || 0, fieldKey, language_id, value, status], type: QueryTypes.INSERT }
      );
    }
  }
  return getContentTranslations(companyId, section, page_slug, record_id);
};

// Returns every translation for one language in a single payload, keyed by the
// slot address `section|page_slug|record_id`:
//
//   { language: {...}, translations: { "faqs||3": { question: "...", answer: "..." } } }
//
// The rendered site needs the whole set at once — a per-slot fetch would mean
// one request per FAQ, testimonial and plan on the page. `language` is resolved
// from either an id or a code so the public URL can carry `?lang=ta`.
// Returns `null` for an unknown/inactive language and for the default language
// (whose content is already the base English text — no overlay needed).
const getTranslationBundle = async (companyId, { language_id, code } = {}) => {
  const languageId = Number(language_id);
  const lookupById = !!languageId && !Number.isNaN(languageId);

  const [language] = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE}
      WHERE company_id = ? AND is_active = 1 AND ${lookupById ? 'id = ?' : 'code = ?'}
      LIMIT 1`,
    {
      replacements: [companyId, lookupById ? languageId : String(code || '').toLowerCase()],
      type: QueryTypes.SELECT,
    }
  );
  if (!language) return null;
  if (Number(language.is_default) === 1) {
    return { language, translations: {} };
  }

  const rows = await sequelize.query(
    `SELECT section, page_slug, record_id, field_key, value
       FROM ${TRANSLATIONS_TABLE}
      WHERE company_id = ? AND language_id = ? AND value <> ''`,
    { replacements: [companyId, language.id], type: QueryTypes.SELECT }
  );

  const translations = {};
  rows.forEach((row) => {
    const slot = `${row.section}|${row.page_slug || ''}|${row.record_id || 0}`;
    if (!translations[slot]) translations[slot] = {};
    translations[slot][row.field_key] = row.value;
  });

  return { language, translations };
};

// Languages offered by the public language switcher — active only, default
// first, and stripped of the bookkeeping columns the rendered site has no use for.
const getPublicLanguages = async (companyId) => {
  const rows = await sequelize.query(
    `SELECT id, code, name, native_name, direction, is_default
       FROM ${LANG_TABLE}
      WHERE company_id = ? AND is_active = 1
      ORDER BY is_default DESC, sort_order ASC, id ASC`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  return rows.map((row) => ({ ...row, is_default: Number(row.is_default) === 1 }));
};

// Registers/refreshes the catalog of translatable fields for one content slot.
// Called whenever a section is saved in its base (English) language, so the
// central Translations module always knows what exists without inspecting
// each section's own content table.
const registerKeys = async (companyId, { section, page_slug = '', record_id = 0, fields = [] }) => {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const [existing] = await sequelize.query(
      `SELECT id FROM ${KEYS_TABLE} WHERE company_id = ? AND section = ? AND page_slug = ? AND record_id = ? AND field_key = ?`,
      { replacements: [companyId, section, page_slug || '', record_id || 0, field.key], type: QueryTypes.SELECT }
    );
    if (existing) {
      await sequelize.query(
        `UPDATE ${KEYS_TABLE} SET field_label = ?, field_type = ?, default_value = ?, sort_order = ?, updated_at = NOW() WHERE id = ?`,
        { replacements: [field.label || field.key, field.type || 'input', field.value ?? '', i, existing.id], type: QueryTypes.UPDATE }
      );
    } else {
      await sequelize.query(
        `INSERT INTO ${KEYS_TABLE} (company_id, section, page_slug, record_id, field_key, field_label, field_type, default_value, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: [companyId, section, page_slug || '', record_id || 0, field.key, field.label || field.key, field.type || 'input', field.value ?? '', i], type: QueryTypes.INSERT }
      );
    }
  }
  return listKeys(companyId, { section, page_slug });
};

// Lists registered keys with every language's saved value attached as a
// `translations: [{ language_id, value, status }]` array — the same shape the
// admin translation module returns, so the UI can render one column per language.
const listKeys = async (companyId, { section, page_slug, record_id, search, sync = false } = {}) => {
  if (sync) await syncKeysFromContent(companyId);

  let sql = `SELECT * FROM ${KEYS_TABLE} WHERE company_id = ?`;
  const replacements = [companyId];

  if (section) {
    sql += ` AND section = ?`;
    replacements.push(section);
  }
  if (page_slug) {
    sql += ` AND page_slug = ?`;
    replacements.push(page_slug);
  }
  // Multi-row sections (testimonials, FAQs, plans...) register one key set per
  // row. Callers that target a single row MUST filter on it — otherwise every
  // row's keys come back, and since results are collapsed by field_key the last
  // row silently wins. 0 is a valid record_id, so check for undefined/null.
  if (record_id !== undefined && record_id !== null && record_id !== '') {
    sql += ` AND record_id = ?`;
    replacements.push(Number(record_id));
  }
  if (search) {
    const like = `%${search}%`;
    sql += ` AND (field_label LIKE ? OR default_value LIKE ? OR field_key LIKE ?)`;
    replacements.push(like, like, like);
  }
  sql += ` ORDER BY section ASC, page_slug ASC, sort_order ASC, id ASC`;

  const keys = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  if (keys.length === 0) return [];

  const rows = await sequelize.query(
    `SELECT section, page_slug, record_id, field_key, language_id, value, status
     FROM ${TRANSLATIONS_TABLE} WHERE company_id = ?`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );

  const slot = (r) => `${r.section}|${r.page_slug}|${r.record_id}|${r.field_key}`;
  const bySlot = new Map();
  rows.forEach((row) => {
    const k = slot(row);
    if (!bySlot.has(k)) bySlot.set(k, []);
    bySlot.get(k).push({
      language_id: row.language_id,
      value: row.value,
      status: row.status || 'reviewed',
    });
  });

  return keys.map((key) => ({ ...key, translations: bySlot.get(slot(key)) || [] }));
};

const deleteKey = async (companyId, id) => {
  const [key] = await sequelize.query(
    `SELECT * FROM ${KEYS_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.SELECT }
  );
  if (!key) return null;

  await sequelize.query(
    `DELETE FROM ${TRANSLATIONS_TABLE}
     WHERE company_id = ? AND section = ? AND page_slug = ? AND record_id = ? AND field_key = ?`,
    {
      replacements: [companyId, key.section, key.page_slug, key.record_id, key.field_key],
      type: QueryTypes.DELETE,
    }
  );
  await sequelize.query(`DELETE FROM ${KEYS_TABLE} WHERE id = ? AND company_id = ?`, {
    replacements: [id, companyId],
    type: QueryTypes.DELETE,
  });
  return { id, deleted: true };
};

// Completion statistics per language — mirrors the admin module's stat cards.
const getStats = async (companyId) => {
  await syncKeysFromContent(companyId);

  const [{ total_keys }] = await sequelize.query(
    `SELECT COUNT(*) AS total_keys FROM ${KEYS_TABLE} WHERE company_id = ?`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );

  const languages = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE company_id = ? AND is_default = 0 ORDER BY sort_order ASC, id ASC`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );

  const counts = await sequelize.query(
    `SELECT language_id,
            SUM(CASE WHEN status = 'reviewed' AND value <> '' THEN 1 ELSE 0 END) AS reviewed,
            SUM(CASE WHEN status = 'auto' AND value <> '' THEN 1 ELSE 0 END) AS auto,
            SUM(CASE WHEN value <> '' THEN 1 ELSE 0 END) AS total
     FROM ${TRANSLATIONS_TABLE} WHERE company_id = ? GROUP BY language_id`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  const byLanguage = new Map(counts.map((c) => [c.language_id, c]));

  return {
    total_keys: Number(total_keys) || 0,
    languages: languages.map((lang) => {
      const c = byLanguage.get(lang.id) || {};
      const total = Number(c.total) || 0;
      return {
        id: lang.id,
        name: lang.name,
        native_name: lang.native_name,
        total,
        reviewed: Number(c.reviewed) || 0,
        auto: Number(c.auto) || 0,
        missing: Math.max((Number(total_keys) || 0) - total, 0),
        completion: total_keys > 0 ? Math.round((total / Number(total_keys)) * 100) : 0,
      };
    }),
  };
};

const listSections = async (companyId) => {
  const rows = await sequelize.query(
    `SELECT DISTINCT section FROM ${KEYS_TABLE} WHERE company_id = ? ORDER BY section ASC`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.section);
};

// Machine-translates every registered key's English default_value into the
// target language (same MyMemory-backed service the admin Languages module
// uses for its own "Translate All" button), then persists the results.
// `onProgress` is called per key so the caller can stream real progress to the
// UI (see the SSE route). It defaults to a no-op for the plain POST path.
const autoTranslateContent = async (
  companyId,
  { section, page_slug = '', record_id = 0, language_id: rawLanguageId },
  onProgress = () => {}
) => {
  const language_id = Number(rawLanguageId);
  if (!language_id || Number.isNaN(language_id)) return null;

  const [language] = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [language_id, companyId], type: QueryTypes.SELECT }
  );
  if (!language) return null;

  // Scoped to this row: without the record_id filter every row's keys come back
  // and, being collapsed by field_key, the last row's text would be saved here.
  const keys = await listKeys(companyId, { section, page_slug, record_id });
  const values = {};

  const total = keys.length;
  let done = 0;
  onProgress({ phase: 'start', done, total });

  for (const key of keys) {
    const source = (key.default_value || '').trim();
    if (!source) {
      values[key.field_key] = '';
    } else {
      try {
        values[key.field_key] = await autoTranslateService.translateText(source, 'en', language.code, false);
      } catch {
        // Keep whatever was already translated rather than wiping it out
        const existing = key.translations.find((t) => t.language_id === language_id);
        values[key.field_key] = existing?.value || '';
      }
    }
    done += 1;
    onProgress({ phase: 'progress', done, total, field: key.field_label || key.field_key });
  }

  const saved = await saveContentTranslations(companyId, {
    section,
    page_slug,
    record_id,
    language_id,
    values,
    status: 'auto',
  });

  onProgress({ phase: 'done', done, total });
  return saved;
};

// Saves one key's value across many languages at once — backs the
// "Edit Translations" dialog, which edits every language on a single row.
const saveKeyTranslations = async (companyId, id, translations = []) => {
  const [key] = await sequelize.query(
    `SELECT * FROM ${KEYS_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.SELECT }
  );
  if (!key) return null;

  for (const entry of translations) {
    const languageId = Number(entry?.language_id);
    if (!languageId || Number.isNaN(languageId)) continue;
    await saveContentTranslations(companyId, {
      section: key.section,
      page_slug: key.page_slug,
      record_id: key.record_id,
      language_id: languageId,
      values: { [key.field_key]: entry.value ?? '' },
      status: 'reviewed',
    });
  }

  const [updated] = await listKeys(companyId, { section: key.section, page_slug: key.page_slug });
  return updated || { id };
};

// Translates EVERY registered key into one language — backs the "Translate"
// button on each row of the Website Builder Languages page, mirroring the admin
// module's translate-all-keys-to-this-language action.
// Returns { created, failed, quotaExceeded } like the admin equivalent so the UI
// can report partial success when the free API's daily quota runs out.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// MyMemory rate-limits rapid bursts (HTTP 429) well before the daily quota is
// spent, so requests are paced and a 429 is retried once after a longer pause
// before giving up on the rest of the run.
const REQUEST_DELAY_MS = 350;
const RATE_LIMIT_BACKOFF_MS = 5000;

const translateOne = async (text, targetCode) => {
  try {
    return { value: await autoTranslateService.translateText(text, 'en', targetCode, true) };
  } catch (err) {
    if (err?.statusCode !== 429) return { error: err };
    await sleep(RATE_LIMIT_BACKOFF_MS);
    try {
      return { value: await autoTranslateService.translateText(text, 'en', targetCode, true) };
    } catch (retryErr) {
      return { error: retryErr, rateLimited: retryErr?.statusCode === 429 };
    }
  }
};

const translateAllToLanguage = async (companyId, rawLanguageId, { skipExisting = true } = {}) => {
  // Route params arrive as strings; language_id from the DB is numeric. Coerce
  // up front so the "already translated" comparison below actually matches.
  const languageId = Number(rawLanguageId);
  if (!languageId || Number.isNaN(languageId)) return null;

  const [language] = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [languageId, companyId], type: QueryTypes.SELECT }
  );
  if (!language) return null;
  if (Number(language.is_default) === 1) {
    return { created: 0, failed: 0, skipped: 0, quotaExceeded: false, isDefault: true };
  }

  const keys = await listKeys(companyId, { sync: true });
  let created = 0;
  let failed = 0;
  let skipped = 0;
  let quotaExceeded = false;

  for (const key of keys) {
    const source = (key.default_value || '').trim();
    if (!source) {
      skipped += 1;
      continue;
    }

    // Resume-friendly: don't burn API quota re-translating what's already done,
    // and never silently overwrite a human-reviewed translation.
    const existing = key.translations.find((t) => t.language_id === languageId);
    if (existing && (existing.value || '').trim() && (skipExisting || existing.status === 'reviewed')) {
      skipped += 1;
      continue;
    }

    if (quotaExceeded) {
      failed += 1;
      continue;
    }

    const result = await translateOne(source, language.code);
    if (result.error) {
      if (result.rateLimited) quotaExceeded = true;
      failed += 1;
      continue;
    }

    await saveContentTranslations(companyId, {
      section: key.section,
      page_slug: key.page_slug,
      record_id: key.record_id,
      language_id: languageId,
      values: { [key.field_key]: result.value },
      status: 'auto',
    });
    created += 1;
    await sleep(REQUEST_DELAY_MS);
  }

  return { created, failed, skipped, quotaExceeded };
};

// Re-translates ONE key into every non-default language (row-level "Re-translate
// all" action in the translations table).
const retranslateKey = async (companyId, id) => {
  const [key] = await sequelize.query(
    `SELECT * FROM ${KEYS_TABLE} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.SELECT }
  );
  if (!key) return null;

  const source = (key.default_value || '').trim();
  const languages = await sequelize.query(
    `SELECT * FROM ${LANG_TABLE} WHERE company_id = ? AND is_default = 0 AND is_active = 1`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );

  for (const language of languages) {
    if (!source) continue;
    let translated;
    try {
      translated = await autoTranslateService.translateText(source, 'en', language.code, false);
    } catch {
      continue;
    }
    await saveContentTranslations(companyId, {
      section: key.section,
      page_slug: key.page_slug,
      record_id: key.record_id,
      language_id: language.id,
      values: { [key.field_key]: translated },
      status: 'auto',
    });
  }

  return { id, retranslated: true };
};

module.exports = {
  getLanguages,
  createLanguage,
  updateLanguage,
  setDefaultLanguage,
  deleteLanguage,
  getContentTranslations,
  getTranslationBundle,
  getPublicLanguages,
  saveContentTranslations,
  registerKeys,
  listKeys,
  listSections,
  syncKeysFromContent,
  deleteKey,
  getStats,
  saveKeyTranslations,
  autoTranslateContent,
  retranslateKey,
  translateAllToLanguage,
};
