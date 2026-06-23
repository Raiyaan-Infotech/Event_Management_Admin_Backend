const { sequelize, Sequelize, Vendor, Subscription, District, City, ColorPalette } = require('../models');
const ApiError = require('../utils/apiError');

const { QueryTypes } = Sequelize;

// Active admin-created color palettes (4 semantic colors each). The builder shows
// these as a selectable list; the vendor picks one or defines a custom palette.
const getColorPalettes = async (companyId) => {
  try {
    const where = { is_active: 1 };
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;
    const rows = await ColorPalette.findAll({
      where,
      order: [['created_at', 'ASC']],
    });
    return rows.map((row) => {
      const p = row.toJSON();
      return {
        id: p.id,
        name: p.name,
        primary_bg_color: p.primary_bg_color,
        primary_text_color: p.primary_text_color,
        secondary_text_color: p.secondary_text_color,
        paragraph_color: p.paragraph_color,
      };
    });
  } catch {
    return [];
  }
};

const tableCache = new Map();

const TABLES = {
  website: 'vendor_websites',
  basicInformation: 'vendor_website_basic_information',
  socialLinks: 'vendor_website_social_links',
  pages: 'vendor_website_pages',
  menuItems: 'vendor_website_menu_items',
  uiBlocks: 'vendor_website_ui_blocks',
  heroSection: 'vendor_website_hero_sections',
  sliders: 'vendor_website_sliders',
  sliderItems: 'vendor_website_slider_items',
  galleryCategories: 'vendor_website_gallery_categories',
  galleryItems: 'vendor_website_gallery_items',
  contactSettings: 'vendor_website_contact_settings',
  contactSocialLinks: 'vendor_website_contact_social_links',
  contactCategories: 'vendor_website_contact_categories',
  contactMessages: 'vendor_website_contact_messages',
  testimonials: 'vendor_website_testimonials',
  clients: 'vendor_website_clients',
  sponsors: 'vendor_website_sponsors',
  footer: 'vendor_website_footer_settings',
  seo: 'vendor_website_seo_settings',
  publishSnapshots: 'vendor_website_publish_snapshots',
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
]);

const TABLE_COLUMNS = {
  website: [
    'slug',
    'custom_domain',
    'status',
    'theme_id',
    'palette_id',
    'publish_version',
    'published_at',
    'settings_json',
    'is_active',
  ],
  basicInformation: [
    'company_name',
    'city',
    'logo_url',
    'header_color',
    'contact_type',
    'mobile_country_code',
    'mobile',
    'email',
    'address',
    'social_links_json',
    'show_social_icons',
    'show_login',
    'show_signin',
    'is_active',
  ],
  socialLinks: [
    'icon_key',
    'icon_color',
    'label',
    'url',
    'sort_order',
    'is_active',
  ],
  pages: [
    'page_type',
    'title',
    'slug',
    'content',
    'excerpt',
    'seo_title',
    'seo_description',
    'seo_keywords',
    'og_image_url',
    'status',
    'sort_order',
    'is_system',
    'is_active',
  ],
  menuItems: [
    'parent_id',
    'label',
    'item_type',
    'page_id',
    'url',
    'target',
    'sort_order',
    'is_visible',
    'is_active',
  ],
  uiBlocks: [
    'block_key',
    'label',
    'variant_key',
    'is_visible',
    'sort_order',
    'config_json',
    'design_json',
    'mobile_json',
    'is_active',
  ],
  heroSection: [
    'image_url',
    'badge_text',
    'title',
    'description',
    'hero_height',
    'overlay_enabled',
    'overlay_color',
    'overlay_opacity',
    'button_1_json',
    'button_2_json',
    'button_layout',
    'content_alignment',
    'mobile_settings_json',
    'design_json',
    'is_active',
  ],
  sliders: [
    'slider_type',
    'title',
    'slider_height',
    'autoplay',
    'autoplay_speed',
    'status',
    'config_json',
    'is_active',
  ],
  sliderItems: [
    'slider_id',
    'title',
    'description',
    'image_url',
    'button_label',
    'button_page_id',
    'button_url',
    'button_color',
    'button_text_color',
    'sort_order',
    'status',
    'is_active',
  ],
  galleryCategories: [
    'name',
    'slug',
    'description',
    'sort_order',
    'is_active',
  ],
  galleryItems: [
    'category_id',
    'event_name',
    'event_type',
    'city',
    'image_url',
    'alt_text',
    'sort_order',
    'is_active',
  ],
  contactCategories: [
    'name',
    'slug',
    'description',
    'sort_order',
    'is_active',
  ],
  contactSettings: [
    'mode',
    'email',
    'mobile',
    'address',
    'contact_form_enabled',
    'social_links_enabled',
    'google_map_enabled',
    'latitude',
    'longitude',
    'is_active',
  ],
  contactSocialLinks: [
    'contact_setting_id',
    'social_link_id',
    'sort_order',
    'is_visible',
    'is_active',
  ],
  contactMessages: [
    'category_id',
    'category_other',
    'name',
    'email',
    'phone',
    'subject',
    'message',
    'status',
    'metadata_json',
    'is_active',
  ],
  testimonials: [
    'customer_name',
    'photo_url',
    'event_name',
    'feedback',
    'rating',
    'show_rating',
    'is_featured',
    'sort_order',
    'is_active',
  ],
  clients: [
    'name',
    'logo_url',
    'website_url',
    'sort_order',
    'is_active',
  ],
  sponsors: [
    'name',
    'logo_url',
    'website_url',
    'sort_order',
    'is_active',
  ],
  footer: [
    'logo_url',
    'company_name',
    'description',
    'contact_type',
    'mobile',
    'email',
    'address',
    'top_list_json',
    'top_list_heading',
    'quick_links_json',
    'add_pages_json',
    'show_newsletter',
    'show_social_links',
    'copyright_text',
    'powered_by_text',
    'locked_fields_json',
    'design_json',
    'is_active',
  ],
  seo: [
    'default_title',
    'default_description',
    'default_keywords',
    'author',
    'language',
    'site_name',
    'og_title',
    'og_description',
    'og_image_url',
    'twitter_card',
    'canonical_url',
    'robots_index',
    'robots_follow',
    'sitemap_enabled',
    'structured_data_enabled',
    'schema_json',
    'tracking_json',
    'is_active',
  ],
  publishSnapshots: [
    'version',
    'payload_json',
    'published_by',
    'published_at',
    'is_active',
  ],
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

const SINGLETONS = ['basicInformation', 'contactSettings', 'heroSection', 'footer', 'seo'];

const defaultPayload = () => ({
  website: null,
  basicInformation: null,
  socialLinks: [],
  pages: [],
  menuItems: [],
  uiBlocks: [],
  heroSection: null,
  sliders: [],
  sliderItems: [],
  galleryCategories: [],
  galleryItems: [],
  contactSettings: null,
  contactSocialLinks: [],
  contactCategories: [],
  contactMessages: [],
  testimonials: [],
  clients: [],
  sponsors: [],
  footer: null,
  seo: null,
  schemaReady: false,
  missingTables: [],
});

const toSlug = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const getActorId = (vendor) => vendor?.id || null;
const getCompanyId = (vendor) => vendor?.company_id || null;

const hasTable = async (tableName) => {
  // Only cache positive results. A negative result must NOT be cached forever:
  // once a migration creates the tables on a running server, the next call has
  // to re-check instead of reporting "missing" until the process restarts.
  if (tableCache.get(tableName)) return true;

  try {
    await sequelize.getQueryInterface().describeTable(tableName);
    tableCache.set(tableName, true);
    return true;
  } catch (error) {
    return false;
  }
};

const getMissingTables = async () => {
  const entries = await Promise.all(
    Object.values(TABLES).map(async (table) => [table, await hasTable(table)]),
  );
  return entries.filter(([, exists]) => !exists).map(([table]) => table);
};

const requireTable = async (key) => {
  const table = TABLES[key];
  if (!table || !(await hasTable(table))) {
    throw ApiError.internal(`Website builder table is not installed: ${table || key}`);
  }
  return table;
};

const parseJsonValue = (value) => {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
};

const normalizeRow = (row) => {
  if (!row) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      JSON_COLUMNS.has(key) ? parseJsonValue(value) : value,
    ]),
  );
};

const normalizeRows = (rows) => rows.map(normalizeRow);

const prepareValue = (key, value) => {
  if (JSON_COLUMNS.has(key)) {
    return value == null || typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
};

const normalizeInput = (tableKey, data = {}) => {
  if (tableKey === 'basicInformation') {
    return {
      ...data,
      logo_url: data.logo_url ?? data.logoUrl,
      header_color: data.header_color ?? data.headerColor,
      mobile_country_code: data.mobile_country_code ?? data.mobileCountryCode,
      social_links_json: data.social_links_json ?? data.socialLinksJson,
      show_social_icons: data.show_social_icons ?? data.showSocialIcons,
      show_login: data.show_login ?? data.showLogin,
      show_signin: data.show_signin ?? data.showSignin ?? data.showSignIn,
    };
  }

  if (tableKey === 'socialLinks') {
    return {
      ...data,
      icon_key: data.icon_key ?? data.icon,
      icon_color: data.icon_color ?? data.color,
    };
  }

  if (tableKey === 'sliderItems') {
    const rawStatus = String(data.status || '').toLowerCase();
    const normalizedStatus = rawStatus === 'active'
      ? 'published'
      : rawStatus === 'inactive'
        ? 'draft'
        : rawStatus || undefined;

    return {
      ...data,
      button_label: data.button_label ?? data.buttonLabel,
      button_page_id: data.button_page_id ?? data.buttonPageId ?? data.buttonPage,
      button_url: data.button_url ?? data.buttonUrl,
      button_color: data.button_color ?? data.buttonColor,
      button_text_color: data.button_text_color ?? data.buttonTextColor,
      image_url: data.image_url ?? data.imageUrl,
      sort_order: data.sort_order ?? data.sortOrder,
      status: normalizedStatus,
    };
  }

  if (tableKey === 'galleryItems') {
    return {
      ...data,
      event_name: data.event_name ?? data.eventName,
      event_type: data.event_type ?? data.eventType,
      image_url: data.image_url ?? data.imageUrl,
      alt_text: data.alt_text ?? data.altText,
    };
  }

  if (tableKey === 'galleryCategories') {
    return {
      ...data,
      sort_order: data.sort_order ?? data.order,
    };
  }

  if (tableKey === 'contactCategories') {
    return {
      ...data,
      sort_order: data.sort_order ?? data.order,
    };
  }

  if (tableKey === 'contactSettings') {
    return {
      ...data,
      contact_form_enabled: data.contact_form_enabled ?? data.contactFormEnabled,
      social_links_enabled: data.social_links_enabled ?? data.socialLinksEnabled,
      google_map_enabled: data.google_map_enabled ?? data.googleMapEnabled,
    };
  }

  if (tableKey === 'contactSocialLinks') {
    return {
      ...data,
      contact_setting_id: data.contact_setting_id ?? data.contactSettingId,
      social_link_id: data.social_link_id ?? data.socialLinkId,
      is_visible: data.is_visible ?? data.isVisible,
    };
  }

  if (tableKey === 'contactMessages') {
    return {
      ...data,
      category_id: data.category_id ?? data.categoryId,
      category_other: data.category_other ?? data.categoryOther,
      metadata_json: data.metadata_json ?? data.metadata,
    };
  }

  if (tableKey === 'testimonials') {
    return {
      ...data,
      customer_name: data.customer_name ?? data.customerName,
      photo_url: data.photo_url ?? data.photoUrl,
      event_name: data.event_name ?? data.eventName,
      show_rating: data.show_rating ?? data.showRating,
      is_featured: data.is_featured ?? data.isFeatured,
    };
  }

  if (tableKey === 'clients' || tableKey === 'sponsors') {
    return {
      ...data,
      logo_url: data.logo_url ?? data.logoUrl,
      website_url: data.website_url ?? data.websiteUrl,
    };
  }

  if (tableKey === 'footer') {
    // NOTE: bodyTransform middleware snake_cases the request body before it
    // reaches here, so the camelCase fallbacks below are dead. We must read the
    // snake_case forms the middleware actually produces (e.g. selected_pages),
    // otherwise these fields silently drop.
    return {
      ...data,
      company_name: data.company_name ?? data.companyName,
      description: data.description ?? data.short_description ?? data.shortDescription,
      show_newsletter: data.show_newsletter ?? data.newsletter_enabled ?? data.newsletterEnabled,
      show_social_links: data.show_social_links ?? data.showSocialLinks,
      top_list_heading: data.top_list_heading ?? data.topListHeading,
      add_pages_json: data.add_pages_json ?? data.selected_pages ?? data.selectedPages,
      copyright_text: data.copyright_text ?? data.copyright,
      powered_by_text: data.powered_by_text ?? data.powered_by ?? data.poweredBy,
    };
  }

  if (tableKey === 'seo') {
    const robotsMeta = data.robots_meta ?? data.robotsMeta;
    return {
      ...data,
      // bodyTransform already snake_cased these (metaTitle -> meta_title, etc.),
      // so read the snake_case forms or the values silently drop.
      default_title: data.default_title ?? data.meta_title ?? data.metaTitle,
      default_description: data.default_description ?? data.meta_description ?? data.metaDescription,
      default_keywords: data.default_keywords ?? data.keywords,
      og_image_url: data.og_image_url ?? data.og_image ?? data.ogImage,
      canonical_url: data.canonical_url ?? data.canonicalUrl,
      site_name: data.site_name ?? data.siteName,
      sitemap_enabled: data.sitemap_enabled ?? data.sitemapEnabled,
      structured_data_enabled: data.structured_data_enabled ?? data.structured_data ?? data.structuredData,
      robots_index: data.robots_index ?? (robotsMeta === 'noindex-nofollow' ? 0 : 1),
      robots_follow: data.robots_follow ?? (robotsMeta === 'noindex-nofollow' || robotsMeta === 'index-nofollow' ? 0 : 1),
    };
  }

  if (tableKey === 'heroSection') {
    return {
      ...data,
      badge_text: data.badge_text ?? data.badgeText,
      hero_height: data.hero_height ?? data.heroHeight,
      overlay_enabled: data.overlay_enabled ?? data.overlayEnabled,
      overlay_color: data.overlay_color ?? data.overlayColor,
      overlay_opacity: data.overlay_opacity ?? data.overlayOpacity,
      button_1_json: data.button_1_json ?? data.btn1 ?? data.button1,
      button_2_json: data.button_2_json ?? data.btn2 ?? data.button2,
      button_layout: data.button_layout ?? data.buttonLayout,
      // bodyTransform produced content_align / hide_btn2_mobile / etc. The JSON
      // is stored with camelCase keys because the hero page reads them back as
      // mobileSettings.hideBtn2Mobile / .centerMobile / .mobileHeroHeight.
      content_alignment: data.content_alignment ?? data.content_align ?? data.contentAlign,
      mobile_settings_json: data.mobile_settings_json ?? {
        hideBtn2Mobile: data.hide_btn2_mobile ?? data.hideBtn2Mobile,
        centerMobile: data.center_mobile ?? data.centerMobile,
        mobileHeroHeight: data.mobile_hero_height ?? data.mobileHeroHeight,
      },
    };
  }

  return data;
};

// Allowed values for every ENUM column, per table. Any value outside the set
// (e.g. frontend sends item_type "static" or target "_self") would otherwise
// raise "Data truncated for column ..." in strict mode. We coerce instead.
const ENUM_VALUES = {
  website: { status: ['draft', 'published', 'maintenance'] },
  basicInformation: { contact_type: ['default', 'alternative'] },
  pages: { page_type: ['system', 'custom', 'legal'], status: ['draft', 'published'] },
  menuItems: {
    item_type: ['home', 'page', 'service', 'events', 'gallery', 'contact', 'custom'],
    target: ['self', 'blank'],
  },
  sliders: { slider_type: ['simple', 'advanced'], status: ['draft', 'published'] },
  sliderItems: { status: ['draft', 'published'] },
  contactSettings: { mode: ['static', 'dynamic'] },
  footer: { contact_type: ['default', 'alternative'] },
};

// Returns a valid ENUM value, or undefined if it can't be coerced (caller then
// drops the column so the DB default applies instead of truncating/erroring).
const coerceEnum = (allowed, value) => {
  if (value == null) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (allowed.includes(normalized)) return normalized;
  const stripped = normalized.replace(/^[_-]+/, ''); // "_self" -> "self"
  if (allowed.includes(stripped)) return stripped;
  return undefined;
};

// Nullable INT (FK) columns. The frontend often sends a page slug (e.g.
// "about-us") for page_id, but the column is INT → "Incorrect integer value".
// Coerce non-numeric values to null (navigation falls back to `url`).
const NULLABLE_INT_COLUMNS = {
  menuItems: new Set(['parent_id', 'page_id']),
  galleryItems: new Set(['category_id']),
  contactMessages: new Set(['category_id']),
};

const coerceNullableInt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : null;
};

const pickAllowed = (tableKey, data) => {
  const allowed = TABLE_COLUMNS[tableKey] || [];
  const normalized = normalizeInput(tableKey, data);
  const enums = ENUM_VALUES[tableKey] || {};
  const ints = NULLABLE_INT_COLUMNS[tableKey];
  return allowed.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(normalized || {}, key)) {
      let value = normalized[key];
      if (enums[key]) {
        value = coerceEnum(enums[key], value);
        if (value === undefined) return acc; // invalid ENUM → drop, use DB default
      } else if (ints && ints.has(key)) {
        value = coerceNullableInt(value); // non-numeric FK (e.g. slug) → null
      }
      acc[key] = prepareValue(key, value);
    }
    return acc;
  }, {});
};

const insertRow = async (tableKey, data, vendor, extra = {}) => {
  const table = await requireTable(tableKey);
  const actorId = getActorId(vendor);
  const row = {
    ...pickAllowed(tableKey, data),
    ...extra,
    vendor_id: getActorId(vendor),
    company_id: getCompanyId(vendor),
    created_by: actorId,
    updated_by: actorId,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const keys = Object.keys(row).filter((key) => row[key] !== undefined);
  const columns = keys.map((key) => `\`${key}\``).join(', ');
  const values = keys.map((key) => `:${key}`).join(', ');

  // Use the INSERT's own insertId to fetch the new row. The previous approach
  // (SELECT ... ORDER BY id DESC LIMIT 1 by vendor_id) had a race: two
  // concurrent inserts for the same vendor could return the wrong row.
  // QueryTypes.INSERT reliably returns [insertId, affectedRows].
  const [insertId] = await sequelize.query(
    `INSERT INTO \`${table}\` (${columns}) VALUES (${values})`,
    { replacements: row, type: QueryTypes.INSERT },
  );

  const [created] = await sequelize.query(
    `SELECT * FROM \`${table}\` WHERE id = :insertId LIMIT 1`,
    {
      replacements: { insertId },
      type: QueryTypes.SELECT,
    },
  );

  return normalizeRow(created);
};

const updateRow = async (tableKey, id, data, vendor, whereExtra = '', extraReplacements = {}) => {
  const table = await requireTable(tableKey);
  const actorId = getActorId(vendor);
  const row = {
    ...pickAllowed(tableKey, data),
    updated_by: actorId,
    updated_at: new Date(),
  };

  const keys = Object.keys(row).filter((key) => row[key] !== undefined);
  if (!keys.length) return getRowById(tableKey, id, vendor, whereExtra);

  const setSql = keys.map((key) => `\`${key}\` = :${key}`).join(', ');
  await sequelize.query(
    `UPDATE \`${table}\`
     SET ${setSql}
     WHERE id = :id AND vendor_id = :vendorId AND deleted_at IS NULL ${whereExtra}`,
    {
      replacements: { ...row, id, vendorId: getActorId(vendor), ...extraReplacements },
    },
  );

  return getRowById(tableKey, id, vendor, whereExtra, extraReplacements);
};

const getRowById = async (tableKey, id, vendor, whereExtra = '', extraReplacements = {}) => {
  const table = await requireTable(tableKey);
  const [row] = await sequelize.query(
    `SELECT * FROM \`${table}\`
     WHERE id = :id AND vendor_id = :vendorId AND deleted_at IS NULL ${whereExtra}
     LIMIT 1`,
    {
      replacements: { id, vendorId: getActorId(vendor), ...extraReplacements },
      type: QueryTypes.SELECT,
    },
  );
  if (!row) throw ApiError.notFound('Record not found');
  return normalizeRow(row);
};

const softDeleteRow = async (tableKey, id, vendor, whereExtra = '') => {
  const table = await requireTable(tableKey);
  const [row] = await sequelize.query(
    `SELECT id FROM \`${table}\`
     WHERE id = :id AND vendor_id = :vendorId AND deleted_at IS NULL ${whereExtra}
     LIMIT 1`,
    {
      replacements: { id, vendorId: getActorId(vendor) },
      type: QueryTypes.SELECT,
    },
  );
  if (!row) throw ApiError.notFound('Record not found');

  await sequelize.query(
    `UPDATE \`${table}\`
     SET is_active = 0, deleted_by = :actorId, deleted_at = :deletedAt, updated_by = :actorId, updated_at = :deletedAt
     WHERE id = :id AND vendor_id = :vendorId`,
    {
      replacements: {
        id,
        vendorId: getActorId(vendor),
        actorId: getActorId(vendor),
        deletedAt: new Date(),
      },
    },
  );

  return { id: Number(id) };
};

const getWebsite = async (vendor) => {
  const table = TABLES.website;
  if (!(await hasTable(table))) return null;

  const [website] = await sequelize.query(
    `SELECT * FROM \`${table}\`
     WHERE vendor_id = :vendorId AND deleted_at IS NULL
     LIMIT 1`,
    {
      replacements: { vendorId: getActorId(vendor) },
      type: QueryTypes.SELECT,
    },
  );

  return normalizeRow(website || null);
};

const ensureWebsite = async (vendor, payload = {}) => {
  const existing = await getWebsite(vendor);
  if (existing) return existing;

  // `vendor_websites` has UNIQUE(vendor_id), but rows are soft-deleted (the row
  // survives with deleted_at set). A plain INSERT would then hit a duplicate-key
  // error, so revive a previously soft-deleted website instead of re-inserting.
  if (await hasTable(TABLES.website)) {
    const [softDeleted] = await sequelize.query(
      `SELECT id FROM \`${TABLES.website}\`
       WHERE vendor_id = :vendorId AND deleted_at IS NOT NULL
       ORDER BY id DESC
       LIMIT 1`,
      { replacements: { vendorId: getActorId(vendor) }, type: QueryTypes.SELECT },
    );

    if (softDeleted) {
      await sequelize.query(
        `UPDATE \`${TABLES.website}\`
         SET deleted_at = NULL, deleted_by = NULL, is_active = 1, updated_by = :actorId, updated_at = :now
         WHERE id = :id`,
        { replacements: { id: softDeleted.id, actorId: getActorId(vendor), now: new Date() } },
      );
      return getRowById('website', softDeleted.id, vendor);
    }
  }

  const baseSlug = toSlug(vendor.company_name || vendor.name || vendor.email || `vendor-${vendor.id}`);
  return insertRow('website', {
    slug: `${baseSlug || 'vendor'}-${vendor.id}`,
    status: 'draft',
    publish_version: 0,
    is_active: 1,
    ...payload,
  }, vendor);
};

const updateWebsite = async (vendor, data) => {
  const website = await ensureWebsite(vendor);
  return updateRow('website', website.id, data, vendor);
};

const getSingleton = async (tableKey, vendor, websiteId) => {
  const table = TABLES[tableKey];
  if (!(await hasTable(table))) return null;

  const [row] = await sequelize.query(
    `SELECT * FROM \`${table}\`
     WHERE vendor_id = :vendorId AND website_id = :websiteId AND deleted_at IS NULL
     LIMIT 1`,
    {
      replacements: { vendorId: getActorId(vendor), websiteId },
      type: QueryTypes.SELECT,
    },
  );

  return normalizeRow(row || null);
};

const upsertSingleton = async (tableKey, vendor, data) => {
  if (!SINGLETONS.includes(tableKey)) throw ApiError.badRequest('Invalid singleton table');
  const website = await ensureWebsite(vendor);
  const existing = await getSingleton(tableKey, vendor, website.id);

  if (existing) {
    return updateRow(tableKey, existing.id, data, vendor, 'AND website_id = :websiteId', {
      websiteId: website.id,
    });
  }

  return insertRow(tableKey, data, vendor, { website_id: website.id });
};

const getList = async (tableKey, vendor, websiteId, extraWhere = '', replacements = {}) => {
  const table = TABLES[tableKey];
  if (!(await hasTable(table))) return [];

  const rows = await sequelize.query(
    `SELECT * FROM \`${table}\`
     WHERE vendor_id = :vendorId AND website_id = :websiteId AND deleted_at IS NULL ${extraWhere}
     ORDER BY ${LIST_SORT[tableKey] || 'id DESC'}`,
    {
      replacements: { vendorId: getActorId(vendor), websiteId, ...replacements },
      type: QueryTypes.SELECT,
    },
  );

  return normalizeRows(rows);
};

const replaceUiBlocks = async (vendor, items = []) => {
  const website = await ensureWebsite(vendor);
  const table = await requireTable('uiBlocks');
  const actorId = getActorId(vendor);
  const vendorId = getActorId(vendor);
  const companyId = getCompanyId(vendor);
  const now = new Date();
  const uniqueItems = Array.from(
    (items || []).reduce((map, item) => {
      const blockKey = String(item?.block_key || item?.id || '').trim();
      if (!blockKey) return map;
      map.set(blockKey, { ...item, block_key: blockKey });
      return map;
    }, new Map()).values(),
  );

  await sequelize.transaction(async (transaction) => {
    if (uniqueItems.length) {
      await sequelize.query(
        `UPDATE \`${table}\`
         SET is_active = 0, deleted_by = :actorId, deleted_at = :deletedAt, updated_by = :actorId, updated_at = :deletedAt
         WHERE vendor_id = :vendorId
           AND website_id = :websiteId
           AND deleted_at IS NULL
           AND block_key NOT IN (:blockKeys)`,
        {
          replacements: {
            actorId,
            deletedAt: now,
            vendorId,
            websiteId: website.id,
            blockKeys: uniqueItems.map((item) => item.block_key),
          },
          transaction,
        },
      );
    } else {
      await sequelize.query(
        `UPDATE \`${table}\`
         SET is_active = 0, deleted_by = :actorId, deleted_at = :deletedAt, updated_by = :actorId, updated_at = :deletedAt
         WHERE vendor_id = :vendorId AND website_id = :websiteId AND deleted_at IS NULL`,
        {
          replacements: {
            actorId,
            deletedAt: now,
            vendorId,
            websiteId: website.id,
          },
          transaction,
        },
      );
    }

    for (const [index, item] of uniqueItems.entries()) {
      const row = {
        ...pickAllowed('uiBlocks', item),
        sort_order: item.sort_order ?? index + 1,
        website_id: website.id,
        vendor_id: vendorId,
        company_id: companyId,
        is_active: item.is_active ?? 1,
        created_by: actorId,
        updated_by: actorId,
        deleted_by: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      const keys = Object.keys(row).filter((key) => row[key] !== undefined);
      const updateKeys = keys.filter(
        (key) =>
          ![
            'id',
            'website_id',
            'vendor_id',
            'company_id',
            'block_key',
            'created_by',
            'created_at',
          ].includes(key),
      );

      await sequelize.query(
        `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(', ')})
         VALUES (${keys.map((key) => `:${key}`).join(', ')})
         ON DUPLICATE KEY UPDATE ${updateKeys
           .map((key) => `\`${key}\` = VALUES(\`${key}\`)`)
           .join(', ')}`,
        { replacements: row, transaction },
      );
    }
  });

  return getList('uiBlocks', vendor, website.id);
};

const replaceList = async (tableKey, vendor, items, options = {}) => {
  if (tableKey === 'uiBlocks') {
    return replaceUiBlocks(vendor, items);
  }

  const website = await ensureWebsite(vendor);
  const table = await requireTable(tableKey);
  const actorId = getActorId(vendor);
  const deleteWhereExtra = options.deleteWhereExtra || '';
  const deleteReplacements = options.deleteReplacements || {};
  const returnWhereExtra = options.returnWhereExtra || '';
  const returnReplacements = options.returnReplacements || {};

  await sequelize.transaction(async (transaction) => {
    await sequelize.query(
      `UPDATE \`${table}\`
       SET is_active = 0, deleted_by = :actorId, deleted_at = :deletedAt, updated_by = :actorId, updated_at = :deletedAt
       WHERE vendor_id = :vendorId AND website_id = :websiteId AND deleted_at IS NULL ${deleteWhereExtra}`,
      {
        replacements: {
          actorId,
          deletedAt: new Date(),
          vendorId: getActorId(vendor),
          websiteId: website.id,
          ...deleteReplacements,
        },
        transaction,
      },
    );

    const menuClientIdMap = new Map();

    const insertListRow = async (item, index, extra = {}) => {
      const row = {
        ...pickAllowed(tableKey, item),
        ...extra,
        sort_order: item.sort_order ?? index + 1,
        website_id: website.id,
        vendor_id: getActorId(vendor),
        company_id: getCompanyId(vendor),
        created_by: actorId,
        updated_by: actorId,
        created_at: new Date(),
        updated_at: new Date(),
      };
      const keys = Object.keys(row).filter((key) => row[key] !== undefined);
      const [insertId] = await sequelize.query(
        `INSERT INTO \`${table}\` (${keys.map((key) => `\`${key}\``).join(', ')})
         VALUES (${keys.map((key) => `:${key}`).join(', ')})`,
        { replacements: row, transaction, type: QueryTypes.INSERT },
      );
      return insertId || null;
    };

    if (tableKey === 'menuItems') {
      const topLevelItems = (items || []).filter((item) => !item.parent_client_id);
      const childItems = (items || []).filter((item) => item.parent_client_id);

      for (const [index, item] of topLevelItems.entries()) {
        const insertedId = await insertListRow(item, index);
        if (item.client_id && insertedId) {
          menuClientIdMap.set(String(item.client_id), insertedId);
        }
      }

      for (const [index, item] of childItems.entries()) {
        const parentId = menuClientIdMap.get(String(item.parent_client_id));
        await insertListRow(item, index, { parent_id: parentId || item.parent_id || null });
      }

      return;
    }

    for (const [index, item] of (items || []).entries()) {
      await insertListRow(item, index);
    }

  });

  return getList(tableKey, vendor, website.id, returnWhereExtra, returnReplacements);
};

const createListItem = async (tableKey, vendor, data, extra = {}) => {
  const website = await ensureWebsite(vendor);
  return insertRow(tableKey, data, vendor, { website_id: website.id, ...extra });
};

const updateListItem = async (tableKey, id, vendor, data, whereExtra = '') =>
  updateRow(tableKey, id, data, vendor, whereExtra);

const deleteListItem = async (tableKey, id, vendor, whereExtra = '') => {
  // The "Other" contact category is a permanent fallback used by the contact
  // form ("Other" reveals a free-text field), so it must never be deleted —
  // from the builder list OR any admin/super-admin surface that hits this API.
  if (tableKey === 'contactCategories') {
    const table = await requireTable(tableKey);
    const [row] = await sequelize.query(
      `SELECT name FROM \`${table}\`
       WHERE id = :id AND vendor_id = :vendorId AND deleted_at IS NULL
       LIMIT 1`,
      {
        replacements: { id, vendorId: getActorId(vendor) },
        type: QueryTypes.SELECT,
      },
    );
    if (row && ['other', 'others'].includes(String(row.name || '').trim().toLowerCase())) {
      throw ApiError.badRequest('The "Other" category cannot be deleted.');
    }
  }
  return softDeleteRow(tableKey, id, vendor, whereExtra);
};

const getBuilderPayload = async (vendor) => {
  const payload = defaultPayload();
  const missingTables = await getMissingTables();
  payload.missingTables = missingTables;
  payload.schemaReady = missingTables.length === 0;

  payload.colorPalettes = await getColorPalettes(vendor.company_id);

  const website = await getWebsite(vendor);
  payload.website = website;
  if (!website) return payload;

  const [
    basicInformation,
    socialLinks,
    pages,
    menuItems,
    uiBlocks,
    heroSection,
    sliders,
    sliderItems,
    galleryCategories,
    galleryItems,
    contactSettings,
    contactSocialLinks,
    contactCategories,
    contactMessages,
    testimonials,
    clients,
    sponsors,
    footer,
    seo,
  ] = await Promise.all([
    getSingleton('basicInformation', vendor, website.id),
    getList('socialLinks', vendor, website.id),
    getList('pages', vendor, website.id),
    getList('menuItems', vendor, website.id),
    getList('uiBlocks', vendor, website.id),
    getSingleton('heroSection', vendor, website.id),
    getList('sliders', vendor, website.id),
    getList('sliderItems', vendor, website.id),
    getList('galleryCategories', vendor, website.id),
    getList('galleryItems', vendor, website.id),
    getSingleton('contactSettings', vendor, website.id),
    getList('contactSocialLinks', vendor, website.id),
    getList('contactCategories', vendor, website.id),
    getList('contactMessages', vendor, website.id),
    getList('testimonials', vendor, website.id),
    getList('clients', vendor, website.id),
    getList('sponsors', vendor, website.id),
    getSingleton('footer', vendor, website.id),
    getSingleton('seo', vendor, website.id),
  ]);

  return {
    ...payload,
    basicInformation,
    socialLinks,
    pages,
    menuItems,
    uiBlocks,
    heroSection,
    sliders,
    sliderItems,
    galleryCategories,
    galleryItems,
    contactSettings,
    contactSocialLinks,
    contactCategories,
    contactMessages,
    testimonials,
    clients,
    sponsors,
    footer,
    seo,
  };
};

const isEnabledRecord = (record) => {
  if (!record) return false;
  const value = record.is_active;
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
};

const isVisibleRecord = (record) => {
  if (!isEnabledRecord(record)) return false;
  const value = record.is_visible;
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
};

const getPreviewPayload = async (vendor) => {
  const payload = await getBuilderPayload(vendor);
  const allBlocks = (payload.uiBlocks || []).filter(isEnabledRecord);
  const blockMap = new Map(allBlocks.map((block) => [String(block.block_key), block]));

  const blockIsVisible = (key, fallback = true) => {
    const block = blockMap.get(key);
    if (!block) return fallback;
    const config = block.config_json && typeof block.config_json === 'object'
      ? block.config_json
      : {};
    return Boolean(config.required_block) || isVisibleRecord(block);
  };

  const activeSliders = (payload.sliders || []).filter((slider) => {
    if (!isEnabledRecord(slider)) return false;
    const type = String(slider.slider_type || '').toLowerCase();
    if (type === 'advanced' || type === 'advance') {
      return blockIsVisible('advance-slider', false);
    }
    return blockIsVisible('basic-slider', blockIsVisible('simple-slider', false));
  });
  const activeSliderIds = new Set(activeSliders.map((slider) => Number(slider.id)));

  const visiblePages = (payload.pages || []).filter((page) => {
    if (!isEnabledRecord(page) || !blockIsVisible('pages', true)) return false;
    const slug = String(page.slug || '').replace(/^\/+/, '');
    return blockIsVisible(`page:${slug}`, true);
  });

  return {
    colorPalettes: payload.colorPalettes || [],
    website: isEnabledRecord(payload.website) ? payload.website : null,
    basicInformation:
      blockIsVisible('basic-information', true) && isEnabledRecord(payload.basicInformation)
        ? payload.basicInformation
        : null,
    socialLinks: (payload.socialLinks || []).filter(isEnabledRecord),
    pages: visiblePages,
    menuItems: blockIsVisible('nav-menu', true)
      ? (payload.menuItems || []).filter(isVisibleRecord)
      : [],
    uiBlocks: allBlocks.filter((block) => blockIsVisible(String(block.block_key), true)),
    heroSection:
      blockIsVisible('hero-section', true) && isEnabledRecord(payload.heroSection)
        ? payload.heroSection
        : null,
    sliders: activeSliders,
    sliderItems: (payload.sliderItems || []).filter(
      (item) => isEnabledRecord(item) && activeSliderIds.has(Number(item.slider_id)),
    ),
    galleryCategories: blockIsVisible('gallery-categories', false)
      ? (payload.galleryCategories || []).filter(isEnabledRecord)
      : [],
    galleryItems: blockIsVisible('gallery-images', false)
      ? (payload.galleryItems || []).filter(isEnabledRecord)
      : [],
    contactSettings:
      blockIsVisible('contact_us', true) && isEnabledRecord(payload.contactSettings)
        ? payload.contactSettings
        : null,
    contactSocialLinks: blockIsVisible('contact_us', true)
      ? (payload.contactSocialLinks || []).filter(isEnabledRecord)
      : [],
    contactCategories: blockIsVisible('contact_us', true)
      ? (payload.contactCategories || []).filter(isEnabledRecord)
      : [],
    testimonials: blockIsVisible('testimonials', false)
      ? (payload.testimonials || []).filter(isEnabledRecord)
      : [],
    clients: blockIsVisible('basic-clients', false)
      ? (payload.clients || []).filter(isEnabledRecord)
      : [],
    sponsors: blockIsVisible('basic-sponsors', false)
      ? (payload.sponsors || []).filter(isEnabledRecord)
      : [],
    footer:
      blockIsVisible('footer', true) && isEnabledRecord(payload.footer)
        ? payload.footer
        : null,
    seo:
      blockIsVisible('seo', true) && isEnabledRecord(payload.seo)
        ? payload.seo
        : null,
    schemaReady: payload.schemaReady,
    missingTables: payload.missingTables,
  };
};

const publishWebsite = async (vendor) => {
  const website = await ensureWebsite(vendor);
  const payload = await getBuilderPayload(vendor);
  const version = Number(website.publish_version || 0) + 1;

  if (await hasTable(TABLES.publishSnapshots)) {
    await insertRow('publishSnapshots', {
      version,
      payload_json: payload,
      is_active: 1,
    }, vendor, { website_id: website.id, published_by: getActorId(vendor), published_at: new Date() });
  }

  const updated = await updateRow('website', website.id, {
    status: 'published',
    publish_version: version,
    published_at: new Date(),
  }, vendor);

  return { website: updated, payload };
};

const findActiveVendorBySlug = async (slug, options = {}) => {
  const vendors = await Vendor.findAll({
    where: { status: 'active' },
    attributes: [
      'id',
      'company_id',
      'company_name',
      'company_logo',
      'short_description',
      'website',
      'latitude',
      'longitude',
      'about_us',
      'company_information',
      'company_contact',
      'company_email',
      'company_address',
      'contact_mode',
      'contact',
      'alt_contact',
      'alt_email',
      'address',
      'alt_address',
      'copywrite',
      'poweredby',
      'city_id',
      'state_id',
      'country_id',
      'pincode_id',
    ],
    raw: !options.include,
    include: options.include,
  });

  return vendors.find((vendor) => toSlug(vendor.company_name || '') === slug);
};

const getPublicWebsitePayloadBySlug = async (slug) => {
  let vendor = null;

  if (await hasTable(TABLES.website)) {
    const [websiteRow] = await sequelize.query(
      `SELECT vendor_id FROM \`${TABLES.website}\`
       WHERE (slug = :slug OR custom_domain = :slug)
         AND status IN ('published', 'draft')
         AND is_active = 1
         AND deleted_at IS NULL
       LIMIT 1`,
      {
        replacements: { slug },
        type: QueryTypes.SELECT,
      },
    );

    if (websiteRow) {
      vendor = await Vendor.findByPk(websiteRow.vendor_id, {
        include: [
          { model: District, as: 'district', attributes: ['id', 'name'] },
          { model: City, as: 'locality', attributes: ['id', 'name', 'pincode'] },
        ],
      });
    }
  }

  if (!vendor) {
    vendor = await findActiveVendorBySlug(slug, {
      include: [
        { model: District, as: 'district', attributes: ['id', 'name'] },
        { model: City, as: 'locality', attributes: ['id', 'name', 'pincode'] },
      ],
    });
  }

  if (!vendor) return null;

  const vendorJson = vendor.toJSON ? vendor.toJSON() : vendor;
  const payload = await getBuilderPayload(vendorJson);
  const subscriptionPlans = await Subscription.findAll({
    where: { is_active: 1, is_custom: 0 },
    order: [['sort_order', 'ASC']],
    attributes: ['id', 'name', 'price', 'discounted_price', 'features', 'label_color'],
  });

  return {
    vendor: vendorJson,
    colors: payload.website?.settings_json?.colors || null,
    sliders: payload.sliders,
    sliderItems: payload.sliderItems,
    heroSection: payload.heroSection,
    portfolio: { clients: payload.clients, sponsors: payload.sponsors, events: [] },
    gallery: payload.galleryItems,
    galleryCategories: payload.galleryCategories,
    contactSettings: payload.contactSettings,
    contactSocialLinks: payload.contactSocialLinks,
    contactCategories: payload.contactCategories,
    testimonials: payload.testimonials,
    plans: subscriptionPlans,
    socialLinks: payload.socialLinks,
    pages: payload.pages,
    menuItems: payload.menuItems,
    uiBlocks: payload.uiBlocks,
    footer: payload.footer,
    seo: payload.seo,
    basicInformation: payload.basicInformation,
    terms_content: payload.pages.find((page) => page.slug === 'terms-conditions')?.content || '',
    privacy_content: payload.pages.find((page) => page.slug === 'privacy-policy')?.content || '',
    schemaReady: payload.schemaReady,
    missingTables: payload.missingTables,
  };
};

const findVendorForPublicSlug = async (slug) => {
  if (await hasTable(TABLES.website)) {
    const [websiteRow] = await sequelize.query(
      `SELECT vendor_id FROM \`${TABLES.website}\`
       WHERE (slug = :slug OR custom_domain = :slug)
         AND status IN ('published', 'draft')
         AND is_active = 1
         AND deleted_at IS NULL
       LIMIT 1`,
      {
        replacements: { slug },
        type: QueryTypes.SELECT,
      },
    );

    if (websiteRow) {
      return Vendor.findByPk(websiteRow.vendor_id);
    }
  }

  return findActiveVendorBySlug(slug);
};

const createPublicContactMessage = async (slug, data = {}) => {
  const vendorRecord = await findVendorForPublicSlug(slug);
  if (!vendorRecord) return null;
  const vendor = vendorRecord.toJSON ? vendorRecord.toJSON() : vendorRecord;

  const name = String(data.name || '').trim();
  const email = String(data.email || '').trim();
  const message = String(data.message || '').trim();
  if (!name || !email || !message) {
    throw ApiError.badRequest('Name, email, and message are required');
  }

  return createListItem('contactMessages', vendor, {
    category_id: data.category_id || data.categoryId || null,
    category_other: String(data.category_other || data.categoryOther || '').trim() || null,
    name,
    email,
    phone: String(data.phone || '').trim() || null,
    subject: String(data.subject || '').trim() || null,
    message,
    status: 'new',
    metadata_json: data.metadata || null,
    is_active: 1,
  });
};

module.exports = {
  TABLES,
  getMissingTables,
  getWebsite,
  ensureWebsite,
  updateWebsite,
  getBuilderPayload,
  getPreviewPayload,
  getSingleton,
  upsertSingleton,
  getList,
  replaceList,
  createListItem,
  updateListItem,
  deleteListItem,
  publishWebsite,
  getPublicWebsitePayloadBySlug,
  createPublicContactMessage,
};
