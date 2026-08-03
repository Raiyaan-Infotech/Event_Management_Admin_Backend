const { sequelize, Sequelize, ColorPalette } = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');
const { QueryTypes } = Sequelize;

const TABLE_S3_FOLDERS = {
  website: 'website-builder/website',
  basicInformation: 'website-builder/logos',
  socialLinks: 'website-builder/social-icons',
  pages: 'website-builder/pages',
  menuItems: 'website-builder/menu-items',
  uiBlocks: 'website-builder/ui-blocks',
  heroSection: 'website-builder/hero',
  sliders: 'website-builder/sliders',
  sliderItems: 'website-builder/sliders',
  galleryCategories: 'website-builder/gallery',
  galleryItems: 'website-builder/gallery',
  contactSettings: 'website-builder/contact',
  contactSocialLinks: 'website-builder/contact',
  testimonials: 'website-builder/testimonials',
  clients: 'website-builder/clients',
  sponsors: 'website-builder/sponsors',
  footer: 'website-builder/footer',
  seo: 'website-builder/seo',
  loginSettings: 'website-builder/login',
  features: 'website-builder/features',
  howItWorks: 'website-builder/how-it-works',
  templates: 'website-builder/templates',
  videoTutorials: 'website-builder/video-tutorials',
};

const convertBase64ToMedia = async (dataUrl, folder = 'website-builder') => {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }
  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9+\-+.]+);base64,(.+)$/);
    if (!matches) return dataUrl;
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const folderSub = folder.split('/').pop() || 'media';
    const filename = `${folderSub}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    const fileObj = {
      buffer,
      originalname: filename,
      mimetype: `image/${matches[1]}`,
      size: buffer.length,
    };
    const result = await mediaService.upload(fileObj, { folder });
    return result?.url || dataUrl;
  } catch (err) {
    console.error(`Failed to convert base64 image for folder ${folder}:`, err);
    return dataUrl;
  }
};

const processRecordBase64Images = async (payload, tableKey) => {
  if (!payload) return payload;
  const folder = TABLE_S3_FOLDERS[tableKey] || 'website-builder';

  if (Array.isArray(payload)) {
    return Promise.all(payload.map((item) => processRecordBase64Images(item, tableKey)));
  }

  if (typeof payload === 'object') {
    const result = { ...payload };
    for (const key of Object.keys(result)) {
      let val = result[key];
      if (typeof val === 'string' && val.startsWith('data:image/')) {
        result[key] = await convertBase64ToMedia(val, folder);
      } else if (val && typeof val === 'object') {
        result[key] = await processRecordBase64Images(val, tableKey);
      }
    }
    return result;
  }

  if (typeof payload === 'string' && payload.startsWith('data:image/')) {
    return await convertBase64ToMedia(payload, folder);
  }

  return payload;
};

const tableCache = new Map();

const TABLES = {
  website: 'company_websites',
  basicInformation: 'company_website_basic_information',
  socialLinks: 'company_website_social_links',
  pages: 'company_website_pages',
  menuItems: 'company_website_menu_items',
  uiBlocks: 'company_website_ui_blocks',
  heroSection: 'company_website_hero_sections',
  sliders: 'company_website_sliders',
  sliderItems: 'company_website_slider_items',
  galleryCategories: 'company_website_gallery_categories',
  galleryItems: 'company_website_gallery_items',
  contactSettings: 'company_website_contact_settings',
  contactSocialLinks: 'company_website_contact_social_links',
  contactCategories: 'company_website_contact_categories',
  contactMessages: 'company_website_contact_messages',
  testimonials: 'company_website_testimonials',
  clients: 'company_website_clients',
  sponsors: 'company_website_sponsors',
  footer: 'company_website_footer_settings',
  seo: 'company_website_seo_settings',
  loginSettings: 'company_website_login_settings',
  themeSettings: 'company_website_theme_settings',
  pricingSettings: 'company_website_pricing_settings',
  pricingPlans: 'company_website_pricing_plans',
  pricingMatrixFeatures: 'company_website_pricing_matrix_features',
  features: 'company_website_features',
};

const JSON_COLUMNS = new Set([
  'settings_json',
  'social_links_json',
  'button_1_json',
  'button_2_json',
  'mobile_settings_json',
  'mobile_json',
  'config_json',
  'design_json',
  'top_list_json',
  'quick_links_json',
  'add_pages_json',
  'locked_fields_json',
  'schema_json',
  'tracking_json',
  'payload_json',
  'metadata_json',
  'features_json',
  'plan_values_json',
  'bullet_points_json',
]);

const TABLE_COLUMNS = {
  website: ['slug', 'custom_domain', 'status', 'theme_id', 'palette_id', 'settings_json', 'is_active'],
  basicInformation: ['company_name', 'city', 'logo_url', 'header_color', 'contact_type', 'mobile_country_code', 'mobile', 'email', 'address', 'social_links_json', 'show_social_icons', 'show_login', 'show_signin', 'is_active'],
  socialLinks: ['icon_key', 'icon_color', 'label', 'url', 'sort_order', 'is_active'],
  pages: ['page_type', 'title', 'slug', 'content', 'excerpt', 'seo_title', 'seo_description', 'seo_keywords', 'og_image_url', 'status', 'sort_order', 'is_system', 'is_active'],
  menuItems: ['parent_id', 'label', 'item_type', 'page_id', 'url', 'target', 'sort_order', 'is_visible', 'is_active'],
  uiBlocks: ['block_key', 'label', 'variant_key', 'is_visible', 'sort_order', 'config_json', 'design_json', 'mobile_json', 'is_active'],
  heroSection: ['page_slug', 'image_url', 'badge_text', 'title', 'description', 'hero_height', 'overlay_enabled', 'overlay_color', 'overlay_opacity', 'button_1_json', 'button_2_json', 'button_layout', 'content_alignment', 'mobile_settings_json', 'design_json', 'is_active'],
  sliders: ['slider_type', 'title', 'slider_height', 'autoplay', 'autoplay_speed', 'status', 'config_json', 'is_active'],
  sliderItems: ['slider_id', 'title', 'description', 'image_url', 'button_label', 'button_page_id', 'button_url', 'button_color', 'button_text_color', 'sort_order', 'status', 'is_active'],
  galleryCategories: ['name', 'slug', 'description', 'sort_order', 'is_active'],
  galleryItems: ['category_id', 'event_name', 'event_type', 'city', 'image_url', 'alt_text', 'sort_order', 'is_active'],
  contactCategories: ['name', 'slug', 'description', 'sort_order', 'is_active'],
  contactSettings: ['mode', 'email', 'mobile', 'address', 'contact_form_enabled', 'social_links_enabled', 'google_map_enabled', 'latitude', 'longitude', 'is_active'],
  contactSocialLinks: ['contact_setting_id', 'social_link_id', 'sort_order', 'is_visible', 'is_active'],
  contactMessages: ['category_id', 'category_other', 'name', 'email', 'phone', 'subject', 'message', 'status', 'metadata_json', 'is_active'],
  testimonials: ['customer_name', 'photo_url', 'event_name', 'feedback', 'rating', 'show_rating', 'is_featured', 'sort_order', 'is_active'],
  clients: ['name', 'logo_url', 'website_url', 'sort_order', 'is_active'],
  sponsors: ['name', 'logo_url', 'website_url', 'sort_order', 'is_active'],
  footer: ['logo_url', 'company_name', 'description', 'contact_type', 'mobile', 'email', 'address', 'top_list_json', 'top_list_heading', 'quick_links_json', 'add_pages_json', 'show_newsletter', 'show_social_links', 'copyright_text', 'powered_by_text', 'locked_fields_json', 'design_json', 'is_active'],
  seo: ['default_title', 'default_description', 'default_keywords', 'author', 'language', 'site_name', 'og_title', 'og_description', 'og_image_url', 'twitter_card', 'canonical_url', 'robots_index', 'robots_follow', 'sitemap_enabled', 'structured_data_enabled', 'schema_json', 'tracking_json', 'is_active'],
  loginSettings: ['title', 'subtitle', 'logo_url', 'bg_image_url', 'show_social_login', 'allow_register', 'is_active'],
  themeSettings: ['primary_color', 'secondary_color', 'accent_color', 'background_color', 'text_color', 'font_family', 'border_radius', 'is_active'],
};

const LIST_SORT = {
  socialLinks: 'sort_order ASC, id ASC',
  pages: 'sort_order ASC, id ASC',
  menuItems: 'sort_order ASC, id ASC',
  uiBlocks: 'sort_order ASC, id ASC',
  sliders: 'id DESC',
  sliderItems: 'sort_order ASC, id ASC',
  galleryCategories: 'sort_order ASC, id ASC',
  galleryItems: 'sort_order ASC, id ASC',
  contactSocialLinks: 'sort_order ASC, id ASC',
  contactCategories: 'sort_order ASC, id ASC',
  contactMessages: 'id DESC',
  testimonials: 'sort_order ASC, id ASC',
  clients: 'sort_order ASC, id ASC',
  sponsors: 'sort_order ASC, id ASC',
};

const SINGLETONS = ['basicInformation', 'contactSettings', 'heroSection', 'footer', 'seo', 'loginSettings', 'themeSettings'];

const hasTable = async (tableName) => {
  if (tableCache.get(tableName)) return true;
  try {
    await sequelize.getQueryInterface().describeTable(tableName);
    tableCache.set(tableName, true);
    return true;
  } catch (error) {
    return false;
  }
};

const requireTable = async (key) => {
  const table = TABLES[key];
  if (!table || !(await hasTable(table))) {
    throw new ApiError(`Table '${table || key}' is missing in company website builder schema.`, 503);
  }
  return table;
};

const safeJsonParse = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
};

const safeJsonStringify = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
};

const normalizeRecord = (row) => {
  if (!row) return null;
  const result = { ...row };
  Object.keys(result).forEach((key) => {
    if (JSON_COLUMNS.has(key)) {
      result[key] = safeJsonParse(result[key]);
    }
  });
  return result;
};

const ensureWebsite = async (companyId) => {
  const table = await requireTable('website');
  const [existing] = await sequelize.query(
    `SELECT * FROM ${table} WHERE company_id = ? LIMIT 1`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  if (existing) return normalizeRecord(existing);

  const slug = `company-${companyId}`;
  await sequelize.query(
    `INSERT INTO ${table} (company_id, slug, status, is_active) VALUES (?, ?, 'published', 1)`,
    { replacements: [companyId, slug], type: QueryTypes.INSERT }
  );

  const [created] = await sequelize.query(
    `SELECT * FROM ${table} WHERE company_id = ? LIMIT 1`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  return normalizeRecord(created);
};

const getWebsite = async (companyId) => {
  const table = await requireTable('website');
  const [row] = await sequelize.query(
    `SELECT * FROM ${table} WHERE company_id = ? LIMIT 1`,
    { replacements: [companyId], type: QueryTypes.SELECT }
  );
  return normalizeRecord(row) || (await ensureWebsite(companyId));
};

const getSingleton = async (tableKey, companyId, pageSlug = null) => {
  const website = await getWebsite(companyId);
  const table = await requireTable(tableKey);
  let querySql = `SELECT * FROM ${table} WHERE company_id = :companyId AND website_id = :websiteId`;
  const replacements = { companyId, websiteId: website.id };

  if (pageSlug) {
    try {
      const [colRow] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE 'page_slug'`, { type: QueryTypes.SELECT });
      if (colRow) {
        querySql += ` AND (page_slug = :pageSlug OR page_slug IS NULL)`;
        querySql += ` ORDER BY CASE WHEN page_slug = :pageSlug THEN 0 ELSE 1 END`;
        replacements.pageSlug = pageSlug;
      }
    } catch {
      // fallback without page_slug filter
    }
  }
  querySql += ` LIMIT 1`;

  const [row] = await sequelize.query(querySql, { replacements, type: QueryTypes.SELECT });
  const rawRecord = normalizeRecord(row);
  if (!rawRecord) return rawRecord;

  // Auto-migrate legacy base64 images in DB to S3/Storage URLs with component S3 folder
  const record = await processRecordBase64Images(rawRecord, tableKey);
  if (JSON.stringify(record) !== JSON.stringify(rawRecord) && record.id) {
    try {
      const allowed = TABLE_COLUMNS[tableKey] || [];
      const updates = {};
      allowed.forEach((col) => {
        if (record[col] !== undefined) {
          updates[col] = JSON_COLUMNS.has(col) ? safeJsonStringify(record[col]) : record[col];
        }
      });
      const setClause = Object.keys(updates).map((k) => `${k} = :${k}`).join(', ');
      if (setClause) {
        await sequelize.query(
          `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = :id`,
          { replacements: { ...updates, id: record.id }, type: QueryTypes.UPDATE }
        );
      }
    } catch (err) {
      console.error(`Failed to update converted base64 images in DB for table ${table}:`, err);
    }
  }

  return record;
};

const upsertSingleton = async (tableKey, companyId, rawPayload = {}, pageSlug = null) => {
  const website = await getWebsite(companyId);
  const table = await requireTable(tableKey);
  const allowed = TABLE_COLUMNS[tableKey] || [];
  
  const payload = await processRecordBase64Images(rawPayload, tableKey);
  const targetPageSlug = pageSlug || payload.page_slug || payload.page || 'home';
  const existing = await getSingleton(tableKey, companyId, targetPageSlug);
  const updates = {};

  let hasPageSlugCol = false;
  try {
    const [colRow] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE 'page_slug'`, { type: QueryTypes.SELECT });
    hasPageSlugCol = Boolean(colRow);
  } catch {}

  for (const col of allowed) {
    if (payload[col] !== undefined && (col !== 'page_slug' || hasPageSlugCol)) {
      const val = payload[col];
      updates[col] = JSON_COLUMNS.has(col) ? safeJsonStringify(val) : val;
    }
  }

  if (hasPageSlugCol && targetPageSlug) {
    updates.page_slug = targetPageSlug;
  }

  if (existing && (!hasPageSlugCol || existing.page_slug === targetPageSlug || !existing.page_slug)) {
    const setClause = Object.keys(updates).map((k) => `${k} = :${k}`).join(', ');
    if (setClause) {
      await sequelize.query(
        `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = :id AND company_id = :companyId`,
        { replacements: { ...updates, id: existing.id, companyId }, type: QueryTypes.UPDATE }
      );
    }
  } else {
    const fields = ['company_id', 'website_id', ...Object.keys(updates)];
    const placeholders = [':companyId', ':websiteId', ...Object.keys(updates).map((k) => `:${k}`)];
    await sequelize.query(
      `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
      { replacements: { ...updates, companyId, websiteId: website.id }, type: QueryTypes.INSERT }
    );
  }

  return getSingleton(tableKey, companyId, targetPageSlug);
};

const getList = async (tableKey, companyId, extraWhere = '', replacements = {}) => {
  const website = await getWebsite(companyId);
  const table = await requireTable(tableKey);
  const sort = LIST_SORT[tableKey] || 'id ASC';
  const rows = await sequelize.query(
    `SELECT * FROM ${table} WHERE company_id = :companyId AND website_id = :websiteId ${extraWhere} ORDER BY ${sort}`,
    { replacements: { companyId, websiteId: website.id, ...replacements }, type: QueryTypes.SELECT }
  );
  const records = rows.map(normalizeRecord);
  return Promise.all(records.map((rec) => processRecordBase64Images(rec, tableKey)));
};

const createListItem = async (tableKey, companyId, rawPayload = {}, extraObj = {}) => {
  const website = await getWebsite(companyId);
  const table = await requireTable(tableKey);
  const allowed = TABLE_COLUMNS[tableKey] || [];
  const payload = await processRecordBase64Images(rawPayload, tableKey);

  const data = {};
  allowed.forEach((col) => {
    if (payload[col] !== undefined) {
      data[col] = JSON_COLUMNS.has(col) ? safeJsonStringify(payload[col]) : payload[col];
    }
  });
  Object.assign(data, extraObj);

  const fields = ['company_id', 'website_id', ...Object.keys(data)];
  const placeholders = [':companyId', ':websiteId', ...Object.keys(data).map((k) => `:${k}`)];

  const [insertId] = await sequelize.query(
    `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`,
    { replacements: { ...data, companyId, websiteId: website.id }, type: QueryTypes.INSERT }
  );

  const [created] = await sequelize.query(
    `SELECT * FROM ${table} WHERE id = ? AND company_id = ? LIMIT 1`,
    { replacements: [insertId, companyId], type: QueryTypes.SELECT }
  );
  return normalizeRecord(created);
};

const updateListItem = async (tableKey, id, companyId, rawPayload = {}) => {
  const table = await requireTable(tableKey);
  const allowed = TABLE_COLUMNS[tableKey] || [];
  const payload = await processRecordBase64Images(rawPayload, tableKey);

  const updates = {};
  allowed.forEach((col) => {
    if (payload[col] !== undefined) {
      updates[col] = JSON_COLUMNS.has(col) ? safeJsonStringify(payload[col]) : payload[col];
    }
  });

  const setClause = Object.keys(updates).map((k) => `${k} = :${k}`).join(', ');
  if (setClause) {
    await sequelize.query(
      `UPDATE ${table} SET ${setClause}, updated_at = NOW() WHERE id = :id AND company_id = :companyId`,
      { replacements: { ...updates, id, companyId }, type: QueryTypes.UPDATE }
    );
  }

  const [updated] = await sequelize.query(
    `SELECT * FROM ${table} WHERE id = ? AND company_id = ? LIMIT 1`,
    { replacements: [id, companyId], type: QueryTypes.SELECT }
  );
  return normalizeRecord(updated);
};

const deleteListItem = async (tableKey, id, companyId) => {
  const table = await requireTable(tableKey);
  await sequelize.query(
    `DELETE FROM ${table} WHERE id = ? AND company_id = ?`,
    { replacements: [id, companyId], type: QueryTypes.DELETE }
  );
  return { id, deleted: true };
};

const replaceList = async (tableKey, companyId, rawItems = []) => {
  const website = await getWebsite(companyId);
  const table = await requireTable(tableKey);
  const items = await processRecordBase64Images(rawItems, tableKey);

  await sequelize.query(
    `DELETE FROM ${table} WHERE company_id = ? AND website_id = ?`,
    { replacements: [companyId, website.id], type: QueryTypes.DELETE }
  );

  for (let i = 0; i < items.length; i++) {
    await createListItem(tableKey, companyId, { ...items[i], sort_order: items[i].sort_order || i + 1 });
  }

  return getList(tableKey, companyId);
};

module.exports = {
  TABLES,
  hasTable,
  ensureWebsite,
  getWebsite,
  getSingleton,
  upsertSingleton,
  getList,
  createListItem,
  updateListItem,
  deleteListItem,
  replaceList,
};
