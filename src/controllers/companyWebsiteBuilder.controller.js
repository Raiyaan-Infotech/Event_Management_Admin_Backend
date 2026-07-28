const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { sequelize, Sequelize } = require('../models');

const { QueryTypes } = Sequelize;

/**
 * Admin-side Website Builder API for company-scoped data.
 * Uses admin JWT auth (req.companyId from company middleware).
 * Tables: company_website_pricing_*, company_website_features, vendor_website_ui_blocks
 */

const getCompanyId = (req) => req.companyId || req.user?.company_id || 1;

const JSON_COLS = new Set(['features_json', 'plan_values_json', 'bullet_points_json']);

const parseRow = (row) => {
    if (!row) return row;
    return Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
            k,
            JSON_COLS.has(k)
                ? (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v)
                : v,
        ])
    );
};

// ─── UI BLOCKS ───────────────────────────────────────────────────────────────

const getUiBlocks = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM vendor_website_ui_blocks WHERE vendor_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows.map(parseRow), 'UI blocks retrieved');
});

const saveUiBlocks = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);

    await sequelize.query(
        'DELETE FROM vendor_website_ui_blocks WHERE vendor_id = ?',
        { replacements: [companyId], type: QueryTypes.DELETE }
    );

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await sequelize.query(
            'INSERT INTO vendor_website_ui_blocks (vendor_id, website_id, block_key, is_visible, sort_order) VALUES (?, ?, ?, ?, ?)',
            {
                replacements: [companyId, 1, item.id || item.block_key || `block_${i}`, item.visible ? 1 : 0, item.sort_order || i + 1],
                type: QueryTypes.INSERT,
            }
        );
    }

    return ApiResponse.success(res, items, 'UI blocks saved');
});

// ─── PRICING SETTINGS ─────────────────────────────────────────────────────────

const getPricingSettings = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM company_website_pricing_settings WHERE company_id = ? LIMIT 1',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows[0] || null, 'Pricing settings retrieved');
});

const savePricingSettings = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const body = req.body || {};
    const existing = await sequelize.query(
        'SELECT id FROM company_website_pricing_settings WHERE company_id = ? LIMIT 1',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    if (existing.length > 0) {
        await sequelize.query(
            `UPDATE company_website_pricing_settings SET section_title=?, section_subtitle=?, badge_text=?,
             individual_heading=?, individual_subheading=?, company_heading=?, company_subheading=?, yearly_discount_badge=?
             WHERE company_id=?`,
            {
                replacements: [body.section_title, body.section_subtitle, body.badge_text,
                    body.individual_heading, body.individual_subheading, body.company_heading,
                    body.company_subheading, body.yearly_discount_badge, companyId],
                type: QueryTypes.UPDATE,
            }
        );
    } else {
        await sequelize.query(
            `INSERT INTO company_website_pricing_settings (company_id, section_title, section_subtitle, badge_text,
             individual_heading, individual_subheading, company_heading, company_subheading, yearly_discount_badge)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            {
                replacements: [companyId, body.section_title, body.section_subtitle, body.badge_text,
                    body.individual_heading, body.individual_subheading, body.company_heading,
                    body.company_subheading, body.yearly_discount_badge],
                type: QueryTypes.INSERT,
            }
        );
    }
    return ApiResponse.success(res, body, 'Pricing settings saved');
});

// ─── PRICING PLANS ────────────────────────────────────────────────────────────

const getPricingPlans = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM company_website_pricing_plans WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows.map(parseRow), 'Pricing plans retrieved');
});

const savePricingPlans = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);

    await sequelize.query(
        'DELETE FROM company_website_pricing_plans WHERE company_id = ?',
        { replacements: [companyId], type: QueryTypes.DELETE }
    );

    for (let i = 0; i < items.length; i++) {
        const p = items[i];
        await sequelize.query(
            `INSERT INTO company_website_pricing_plans
             (company_id, plan_name, subtitle, target_type, currency, price_monthly, price_yearly,
              period_label, badge_text, badge_style, is_popular, features_json, is_active, sort_order)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            {
                replacements: [
                    companyId, p.plan_name, p.subtitle || '', p.target_type || 'individuals',
                    p.currency || '₹', p.price_monthly || 0, p.price_yearly || 0,
                    p.period_label || '/Month', p.badge_text || '', p.badge_style || 'filled',
                    p.is_popular ? 1 : 0, JSON.stringify(p.features_json || []),
                    p.is_active !== false ? 1 : 0, i,
                ],
                type: QueryTypes.INSERT,
            }
        );
    }
    return ApiResponse.success(res, items, 'Pricing plans saved');
});

// ─── PRICING MATRIX FEATURES ──────────────────────────────────────────────────

const getPricingMatrixFeatures = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM company_website_pricing_matrix_features WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows.map(parseRow), 'Pricing matrix features retrieved');
});

const savePricingMatrixFeatures = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);

    await sequelize.query(
        'DELETE FROM company_website_pricing_matrix_features WHERE company_id = ?',
        { replacements: [companyId], type: QueryTypes.DELETE }
    );

    for (let i = 0; i < items.length; i++) {
        const f = items[i];
        await sequelize.query(
            `INSERT INTO company_website_pricing_matrix_features
             (company_id, feature_name, category, plan_values_json, sort_order, is_active)
             VALUES (?,?,?,?,?,?)`,
            {
                replacements: [companyId, f.feature_name, f.category || 'General', JSON.stringify(f.plan_values_json || {}), i, 1],
                type: QueryTypes.INSERT,
            }
        );
    }
    return ApiResponse.success(res, items, 'Pricing matrix features saved');
});

// ─── FEATURES ─────────────────────────────────────────────────────────────────

const getFeatures = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM company_website_features WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows.map(parseRow), 'Features retrieved');
});

const createFeature = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const f = req.body || {};
    const [, meta] = await sequelize.query(
        `INSERT INTO company_website_features
         (company_id, title, short_description, detailed_description, icon, custom_icon_url,
          feature_image_url, bullet_points_json, show_in_menu, menu_order, status, sort_order, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        {
            replacements: [
                companyId, f.title, f.short_description, f.detailed_description || null,
                f.icon || 'calendar', f.custom_icon_url || null, f.feature_image_url || null,
                JSON.stringify(f.bullet_points_json || []), f.show_in_menu ? 1 : 0,
                f.menu_order || 1, f.status || 'Active', f.sort_order || 0, 1,
            ],
            type: QueryTypes.INSERT,
        }
    );
    return ApiResponse.success(res, { id: meta, ...f }, 'Feature created');
});

const updateFeature = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const f = req.body || {};
    await sequelize.query(
        `UPDATE company_website_features SET
         title=?, short_description=?, detailed_description=?, icon=?, custom_icon_url=?,
         feature_image_url=?, bullet_points_json=?, show_in_menu=?, menu_order=?, status=?, sort_order=?
         WHERE id=? AND company_id=?`,
        {
            replacements: [
                f.title, f.short_description, f.detailed_description || null,
                f.icon || 'calendar', f.custom_icon_url || null, f.feature_image_url || null,
                JSON.stringify(f.bullet_points_json || []), f.show_in_menu ? 1 : 0,
                f.menu_order || 1, f.status || 'Active', f.sort_order || 0, id, companyId,
            ],
            type: QueryTypes.UPDATE,
        }
    );
    return ApiResponse.success(res, { id, ...f }, 'Feature updated');
});

const deleteFeature = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    await sequelize.query(
        'DELETE FROM company_website_features WHERE id=? AND company_id=?',
        { replacements: [id, companyId], type: QueryTypes.DELETE }
    );
    return ApiResponse.success(res, null, 'Feature deleted');
});

const replaceFeatures = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);

    await sequelize.query(
        'DELETE FROM company_website_features WHERE company_id = ?',
        { replacements: [companyId], type: QueryTypes.DELETE }
    );

    for (let i = 0; i < items.length; i++) {
        const f = items[i];
        await sequelize.query(
            `INSERT INTO company_website_features
             (company_id, title, short_description, detailed_description, icon, custom_icon_url,
              feature_image_url, bullet_points_json, show_in_menu, menu_order, status, sort_order, is_active)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            {
                replacements: [
                    companyId, f.title, f.short_description, f.detailed_description || null,
                    f.icon || 'calendar', f.custom_icon_url || null, f.feature_image_url || null,
                    JSON.stringify(f.bullet_points_json || []), f.show_in_menu ? 1 : 0,
                    f.menu_order || 1, f.status || 'Active', i, 1,
                ],
                type: QueryTypes.INSERT,
            }
        );
    }
    return ApiResponse.success(res, items, 'Features saved');
});

// ─── TEMPLATE CATEGORIES ──────────────────────────────────────────────────────

const DEFAULT_MASTER_CATEGORIES = [
    { name: 'Wedding', slug: 'wedding', description: 'Royal wedding & marriage invitation templates.', color: '#6A38F5', sort_order: 1 },
    { name: 'Engagement', slug: 'engagement', description: 'Roka & engagement party invitations.', color: '#EC4899', sort_order: 2 },
    { name: 'Birthday', slug: 'birthday', description: 'Birthday party & milestone celebration templates.', color: '#3B82F6', sort_order: 3 },
    { name: 'Anniversary', slug: 'anniversary', description: 'Wedding anniversary & vow renewal templates.', color: '#10B981', sort_order: 4 },
    { name: 'Baby Shower', slug: 'baby-shower', description: 'Welcome baby & gender reveal invitations.', color: '#F59E0B', sort_order: 5 },
    { name: 'Corporate', slug: 'corporate', description: 'Business conference, gala & summit invites.', color: '#6366F1', sort_order: 6 },
    { name: 'Festival', slug: 'festival', description: 'Diwali, Eid, Christmas & seasonal greetings.', color: '#EF4444', sort_order: 7 },
];

const getTemplateCategories = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    let rows = await sequelize.query(
        'SELECT * FROM company_template_categories WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );

    // Auto-seed default master categories if database table is empty for this company
    if (rows.length === 0) {
        for (const cat of DEFAULT_MASTER_CATEGORIES) {
            await sequelize.query(
                `INSERT INTO company_template_categories
                 (company_id, name, slug, description, color, sort_order, is_active)
                 VALUES (?,?,?,?,?,?,?)`,
                {
                    replacements: [companyId, cat.name, cat.slug, cat.description, cat.color, cat.sort_order, 1],
                    type: QueryTypes.INSERT,
                }
            );
        }
        rows = await sequelize.query(
            'SELECT * FROM company_template_categories WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
            { replacements: [companyId], type: QueryTypes.SELECT }
        );
    }

    return ApiResponse.success(res, rows.map(parseRow), 'Template categories retrieved');
});

const createTemplateCategory = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const c = req.body || {};
    const slug = c.slug || String(c.name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const [, meta] = await sequelize.query(
        `INSERT INTO company_template_categories
         (company_id, name, slug, description, icon, color, sort_order, is_active)
         VALUES (?,?,?,?,?,?,?,?)`,
        {
            replacements: [
                companyId, c.name, slug, c.description || null,
                c.icon || 'tag', c.color || '#6A38F5', c.sort_order || 0, c.is_active !== false ? 1 : 0,
            ],
            type: QueryTypes.INSERT,
        }
    );
    return ApiResponse.success(res, { id: meta, ...c, slug }, 'Template category created');
});

const updateTemplateCategory = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const c = req.body || {};
    const slug = c.slug || String(c.name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await sequelize.query(
        `UPDATE company_template_categories SET
         name=?, slug=?, description=?, icon=?, color=?, sort_order=?, is_active=?
         WHERE id=? AND company_id=?`,
        {
            replacements: [
                c.name, slug, c.description || null, c.icon || 'tag',
                c.color || '#6A38F5', c.sort_order || 0, c.is_active !== false ? 1 : 0, id, companyId,
            ],
            type: QueryTypes.UPDATE,
        }
    );
    return ApiResponse.success(res, { id, ...c, slug }, 'Template category updated');
});

const deleteTemplateCategory = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    await sequelize.query(
        'DELETE FROM company_template_categories WHERE id=? AND company_id=?',
        { replacements: [id, companyId], type: QueryTypes.DELETE }
    );
    return ApiResponse.success(res, null, 'Template category deleted');
});

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

const getTemplates = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { category_id, template_type, search } = req.query;

    let sql = 'SELECT t.*, c.name as category_name FROM company_templates t LEFT JOIN company_template_categories c ON t.category_id = c.id WHERE t.company_id = ?';
    const replacements = [companyId];

    if (category_id) {
        sql += ' AND t.category_id = ?';
        replacements.push(category_id);
    }
    if (template_type && template_type !== 'all') {
        sql += ' AND t.template_type = ?';
        replacements.push(template_type);
    }
    if (search) {
        sql += ' AND (t.template_name LIKE ? OR t.description LIKE ?)';
        replacements.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY t.sort_order ASC, t.id DESC';

    const rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
    return ApiResponse.success(res, rows.map(parseRow), 'Templates retrieved');
});

const getTemplateById = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const rows = await sequelize.query(
        'SELECT t.*, c.name as category_name FROM company_templates t LEFT JOIN company_template_categories c ON t.category_id = c.id WHERE t.id = ? AND t.company_id = ? LIMIT 1',
        { replacements: [id, companyId], type: QueryTypes.SELECT }
    );
    if (!rows.length) {
        return ApiResponse.error(res, 'Template not found', 404);
    }
    return ApiResponse.success(res, parseRow(rows[0]), 'Template details retrieved');
});

const createTemplate = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const t = req.body || {};
    const slug = t.slug || String(t.template_name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    
    const [, meta] = await sequelize.query(
        `INSERT INTO company_templates
         (company_id, category_id, template_name, slug, description, template_type, design_style,
          primary_color, thumbnail_url, template_file_url, preview_url, is_active, allow_customize,
          is_draft, is_popular, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        {
            replacements: [
                companyId, t.category_id || null, t.template_name, slug, t.description || null,
                t.template_type || 'wedding', t.design_style || 'classic', t.primary_color || '#6A38F5',
                t.thumbnail_url || null, t.template_file_url || null, t.preview_url || null,
                t.is_active !== false ? 1 : 0, t.allow_customize !== false ? 1 : 0,
                t.is_draft ? 1 : 0, t.is_popular ? 1 : 0, t.sort_order || 0,
            ],
            type: QueryTypes.INSERT,
        }
    );
    return ApiResponse.success(res, { id: meta, ...t, slug }, 'Template created');
});

const updateTemplate = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const t = req.body || {};
    const slug = t.slug || String(t.template_name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    await sequelize.query(
        `UPDATE company_templates SET
         category_id=?, template_name=?, slug=?, description=?, template_type=?, design_style=?,
         primary_color=?, thumbnail_url=?, template_file_url=?, preview_url=?, is_active=?, allow_customize=?,
         is_draft=?, is_popular=?, sort_order=?
         WHERE id=? AND company_id=?`,
        {
            replacements: [
                t.category_id || null, t.template_name, slug, t.description || null,
                t.template_type || 'wedding', t.design_style || 'classic', t.primary_color || '#6A38F5',
                t.thumbnail_url || null, t.template_file_url || null, t.preview_url || null,
                t.is_active !== false ? 1 : 0, t.allow_customize !== false ? 1 : 0,
                t.is_draft ? 1 : 0, t.is_popular ? 1 : 0, t.sort_order || 0, id, companyId,
            ],
            type: QueryTypes.UPDATE,
        }
    );
    return ApiResponse.success(res, { id, ...t, slug }, 'Template updated');
});

const deleteTemplate = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    await sequelize.query(
        'DELETE FROM company_templates WHERE id=? AND company_id=?',
        { replacements: [id, companyId], type: QueryTypes.DELETE }
    );
    return ApiResponse.success(res, null, 'Template deleted');
});

// ─── HOW IT WORKS ─────────────────────────────────────────────────────────────

const getHowItWorksSteps = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM company_website_how_it_works WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows.map(parseRow), 'How It Works steps retrieved');
});

const createHowItWorksStep = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const s = req.body || {};

    const [existingCount] = await sequelize.query(
        'SELECT COUNT(*) as cnt FROM company_website_how_it_works WHERE company_id = ?',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );

    const stepNum = s.step_number || (existingCount[0].cnt + 1);
    const sortOrder = s.sort_order || (existingCount[0].cnt + 1);

    const [insertId] = await sequelize.query(
        `INSERT INTO company_website_how_it_works 
         (company_id, step_number, title, description, highlight_title, highlight_subtext, icon, illustration_url, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        {
            replacements: [
                companyId,
                stepNum,
                s.title || 'New Step',
                s.description || '',
                s.highlight_title || '',
                s.highlight_subtext || '',
                s.icon || 'gift',
                s.illustration_url || null,
                s.is_active !== false ? 1 : 0,
                sortOrder,
            ],
            type: QueryTypes.INSERT,
        }
    );

    return ApiResponse.success(res, { id: insertId, ...s, company_id: companyId }, 'Step created successfully');
});

const updateHowItWorksStep = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const s = req.body || {};

    await sequelize.query(
        `UPDATE company_website_how_it_works SET
         step_number=?, title=?, description=?, highlight_title=?, highlight_subtext=?,
         icon=?, illustration_url=?, is_active=?, sort_order=?
         WHERE id=? AND company_id=?`,
        {
            replacements: [
                s.step_number || 1,
                s.title,
                s.description,
                s.highlight_title || null,
                s.highlight_subtext || null,
                s.icon || 'gift',
                s.illustration_url || null,
                s.is_active !== false ? 1 : 0,
                s.sort_order || 0,
                id,
                companyId,
            ],
            type: QueryTypes.UPDATE,
        }
    );

    return ApiResponse.success(res, { id, ...s }, 'Step updated successfully');
});

const deleteHowItWorksStep = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;

    await sequelize.query(
        'DELETE FROM company_website_how_it_works WHERE id=? AND company_id=?',
        { replacements: [id, companyId], type: QueryTypes.DELETE }
    );

    return ApiResponse.success(res, null, 'Step deleted successfully');
});

const replaceHowItWorksSteps = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);

    await sequelize.query(
        'DELETE FROM company_website_how_it_works WHERE company_id=?',
        { replacements: [companyId], type: QueryTypes.DELETE }
    );

    for (let i = 0; i < items.length; i++) {
        const s = items[i];
        await sequelize.query(
            `INSERT INTO company_website_how_it_works 
             (company_id, step_number, title, description, highlight_title, highlight_subtext, icon, illustration_url, is_active, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            {
                replacements: [
                    companyId,
                    s.step_number || i + 1,
                    s.title || `Step ${i + 1}`,
                    s.description || '',
                    s.highlight_title || null,
                    s.highlight_subtext || null,
                    s.icon || 'gift',
                    s.illustration_url || null,
                    s.is_active !== false ? 1 : 0,
                    s.sort_order || i + 1,
                ],
                type: QueryTypes.INSERT,
            }
        );
    }

    return ApiResponse.success(res, items, 'Steps list saved successfully');
});

// ─── WEBSITE BUILDER FAQ CATEGORIES ──────────────────────────────────────────

const getWebsiteFaqCategories = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const rows = await sequelize.query(
        'SELECT * FROM company_website_faq_categories WHERE company_id = ? ORDER BY sort_order ASC, id ASC',
        { replacements: [companyId], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, rows, 'FAQ Categories retrieved');
});

const createWebsiteFaqCategory = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { name, description, icon, color, sort_order, is_active } = req.body || {};
    const [id] = await sequelize.query(
        'INSERT INTO company_website_faq_categories (company_id, name, description, icon, color, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        {
            replacements: [
                companyId,
                name || 'New Category',
                description || null,
                icon || 'HelpCircle',
                color || '#7C3AED',
                sort_order || 0,
                is_active !== false ? 1 : 0
            ],
            type: QueryTypes.INSERT,
        }
    );
    const [created] = await sequelize.query(
        'SELECT * FROM company_website_faq_categories WHERE id = ?',
        { replacements: [id], type: QueryTypes.SELECT }
    );
    return ApiResponse.created(res, created, 'FAQ Category created successfully');
});

const updateWebsiteFaqCategory = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const { name, description, icon, color, sort_order, is_active } = req.body || {};

    await sequelize.query(
        'UPDATE company_website_faq_categories SET name = COALESCE(?, name), description = ?, icon = COALESCE(?, icon), color = COALESCE(?, color), sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ? AND company_id = ?',
        {
            replacements: [
                name ?? null,
                description ?? null,
                icon ?? null,
                color ?? null,
                sort_order ?? null,
                is_active !== undefined ? (is_active ? 1 : 0) : null,
                id,
                companyId
            ],
            type: QueryTypes.UPDATE,
        }
    );

    const [updated] = await sequelize.query(
        'SELECT * FROM company_website_faq_categories WHERE id = ?',
        { replacements: [id], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, updated, 'FAQ Category updated successfully');
});

const deleteWebsiteFaqCategory = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    await sequelize.query(
        'DELETE FROM company_website_faq_categories WHERE id = ? AND company_id = ?',
        { replacements: [id, companyId], type: QueryTypes.DELETE }
    );
    return ApiResponse.success(res, null, 'FAQ Category deleted successfully');
});

// ─── WEBSITE BUILDER FAQS ───────────────────────────────────────────────────

const getWebsiteFaqs = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { search, category_id, is_active } = req.query;

    let query = `
        SELECT f.*, c.name as category_name, c.icon as category_icon, c.color as category_color 
        FROM company_website_faqs f 
        LEFT JOIN company_website_faq_categories c ON f.faq_category_id = c.id 
        WHERE f.company_id = ?
    `;
    const replacements = [companyId];

    if (search) {
        query += ' AND (f.question LIKE ? OR f.answer LIKE ? OR f.tags LIKE ?)';
        replacements.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category_id && category_id !== 'all') {
        query += ' AND f.faq_category_id = ?';
        replacements.push(category_id);
    }
    if (is_active !== undefined && is_active !== '' && is_active !== 'all') {
        query += ' AND f.is_active = ?';
        replacements.push(is_active === 'true' || is_active === '1' ? 1 : 0);
    }

    query += ' ORDER BY f.sort_order ASC, f.id DESC';

    const rows = await sequelize.query(query, { replacements, type: QueryTypes.SELECT });

    const faqs = rows.map(r => ({
        ...r,
        category: r.category_name ? {
            id: r.faq_category_id,
            name: r.category_name,
            icon: r.category_icon,
            color: r.category_color
        } : null
    }));

    return ApiResponse.success(res, faqs, 'FAQs retrieved');
});

const getWebsiteFaqById = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const rows = await sequelize.query(
        'SELECT * FROM company_website_faqs WHERE id = ? AND company_id = ? LIMIT 1',
        { replacements: [id, companyId], type: QueryTypes.SELECT }
    );
    if (!rows[0]) return ApiResponse.error(res, 'FAQ not found', 404);
    return ApiResponse.success(res, rows[0], 'FAQ details retrieved');
});

const createWebsiteFaq = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { faq_category_id, question, answer, tags, is_featured, sort_order, is_active } = req.body || {};

    const [id] = await sequelize.query(
        'INSERT INTO company_website_faqs (company_id, faq_category_id, question, answer, tags, is_featured, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        {
            replacements: [
                companyId,
                faq_category_id || 1,
                question || '',
                answer || '',
                tags || null,
                is_featured ? 1 : 0,
                sort_order || 0,
                is_active !== false ? 1 : 0
            ],
            type: QueryTypes.INSERT,
        }
    );

    const [created] = await sequelize.query(
        'SELECT * FROM company_website_faqs WHERE id = ?',
        { replacements: [id], type: QueryTypes.SELECT }
    );
    return ApiResponse.created(res, created, 'FAQ created successfully');
});

const updateWebsiteFaq = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    const { faq_category_id, question, answer, tags, is_featured, sort_order, is_active } = req.body || {};

    await sequelize.query(
        `UPDATE company_website_faqs SET 
            faq_category_id = COALESCE(?, faq_category_id),
            question = COALESCE(?, question),
            answer = COALESCE(?, answer),
            tags = ?,
            is_featured = COALESCE(?, is_featured),
            sort_order = COALESCE(?, sort_order),
            is_active = COALESCE(?, is_active)
        WHERE id = ? AND company_id = ?`,
        {
            replacements: [
                faq_category_id ?? null,
                question ?? null,
                answer ?? null,
                tags ?? null,
                is_featured !== undefined ? (is_featured ? 1 : 0) : null,
                sort_order ?? null,
                is_active !== undefined ? (is_active ? 1 : 0) : null,
                id,
                companyId
            ],
            type: QueryTypes.UPDATE,
        }
    );

    const [updated] = await sequelize.query(
        'SELECT * FROM company_website_faqs WHERE id = ?',
        { replacements: [id], type: QueryTypes.SELECT }
    );
    return ApiResponse.success(res, updated, 'FAQ updated successfully');
});

const deleteWebsiteFaq = asyncHandler(async (req, res) => {
    const companyId = getCompanyId(req);
    const { id } = req.params;
    await sequelize.query(
        'DELETE FROM company_website_faqs WHERE id = ? AND company_id = ?',
        { replacements: [id, companyId], type: QueryTypes.DELETE }
    );
    return ApiResponse.success(res, null, 'FAQ deleted successfully');
});

module.exports = {
    getUiBlocks,
    saveUiBlocks,
    getPricingSettings,
    savePricingSettings,
    getPricingPlans,
    savePricingPlans,
    getPricingMatrixFeatures,
    savePricingMatrixFeatures,
    getFeatures,
    createFeature,
    updateFeature,
    deleteFeature,
    replaceFeatures,
    getTemplateCategories,
    createTemplateCategory,
    updateTemplateCategory,
    deleteTemplateCategory,
    getTemplates,
    getTemplateById,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getHowItWorksSteps,
    createHowItWorksStep,
    updateHowItWorksStep,
    deleteHowItWorksStep,
    replaceHowItWorksSteps,
    getWebsiteFaqCategories,
    createWebsiteFaqCategory,
    updateWebsiteFaqCategory,
    deleteWebsiteFaqCategory,
    getWebsiteFaqs,
    getWebsiteFaqById,
    createWebsiteFaq,
    updateWebsiteFaq,
    deleteWebsiteFaq,
};

