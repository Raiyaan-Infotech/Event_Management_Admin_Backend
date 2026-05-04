const { Subscription, Vendor, Theme, VendorThemeColor, ColorPalette } = require('../models');
const themeService     = require('../services/theme.service');
const { Op }           = require('sequelize');
const ApiResponse      = require('../utils/apiResponse');
const ApiError         = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { safeParseArray } = require('../utils/json');

const COLOR_KEYS = ['primary_color', 'secondary_color', 'header_color', 'footer_color', 'text_color', 'hover_color'];

// GET /vendors/subscription
const getMyPlan = asyncHandler(async (req, res) => {
    const vendorId = req.vendor.id;
    const vendor = await Vendor.findByPk(vendorId, {
        attributes: ['id', 'membership'],
    });

    if (!vendor) throw ApiError.notFound('Vendor not found');

    const customPlan = await Subscription.findOne({
        where: { is_custom: 1, vendor_id: vendorId, is_active: 1 },
    });

    if (customPlan) {
        return ApiResponse.success(res, { type: 'custom', plans: [customPlan] }, 'Subscription retrieved');
    }

    const commonPlans = await Subscription.findAll({
        where: { is_custom: 0, is_active: 1 },
        order: [['sort_order', 'ASC'], ['price', 'ASC']],
    });

    const normalizedMembership = (vendor.membership || '').trim().toLowerCase();
    const matchedPlan = commonPlans.find((plan) =>
        typeof plan.name === 'string' && plan.name.trim().toLowerCase() === normalizedMembership
    );

    if (matchedPlan) {
        return ApiResponse.success(res, { type: 'common', plans: [matchedPlan] }, 'Subscription retrieved');
    }

    ApiResponse.success(res, { type: 'common', plans: commonPlans }, 'Subscription plans retrieved');
});

// GET /vendors/subscription/themes/:planId
const getThemesByPlan = asyncHandler(async (req, res) => {
    const { planId } = req.params;
    const themes = await themeService.getThemesByPlan(planId);
    return ApiResponse.success(res, { themes }, 'Themes retrieved for plan');
});

// PUT /vendors/subscription/theme
const selectTheme = asyncHandler(async (req, res) => {
    const vendorId = req.vendor.id;
    const { theme_id } = req.body;

    if (!theme_id) throw ApiError.badRequest('theme_id is required');

    const theme = await Theme.findByPk(theme_id);
    if (!theme || !theme.is_active) throw ApiError.notFound('Theme not found or inactive');

    await Vendor.update({ theme_id }, { where: { id: vendorId } });

    ApiResponse.success(res, { theme_id }, 'Theme saved successfully');
});

// GET /vendors/color-palettes
// Returns all active admin-created color palettes for the vendor to pick from
const getAllPalettes = asyncHandler(async (req, res) => {
    const palettes = await ColorPalette.findAll({
        where: { is_active: 1 },
        attributes: ['id', 'name', ...COLOR_KEYS],
        order: [['id', 'ASC']],
    });
    ApiResponse.success(res, palettes, 'Color palettes retrieved');
});

// PUT /vendors/subscription/palette
// Vendor selects an admin palette → saves palette_id + deactivates custom
const selectPalette = asyncHandler(async (req, res) => {
    const { palette_id } = req.body;
    if (!palette_id) throw ApiError.badRequest('palette_id is required');

    const palette = await ColorPalette.findOne({ where: { id: palette_id, is_active: 1 } });
    if (!palette) throw ApiError.notFound('Palette not found or inactive');

    await Vendor.update({ palette_id }, { where: { id: req.vendor.id } });

    // Deactivate custom override so palette takes effect
    await VendorThemeColor.update(
        { is_active: 0 },
        { where: { vendor_id: req.vendor.id } }
    );

    ApiResponse.success(res, { palette_id }, 'Palette selected successfully');
});

// GET /vendors/subscription/colors
// Priority: custom (is_active=1) > vendor.palette_id > theme defaults
const getColors = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findByPk(req.vendor.id, {
        attributes: ['id', 'theme_id', 'palette_id'],
    });

    if (!vendor?.theme_id) throw ApiError.badRequest('No active theme set');

    // 1. Selected palette colors (vendor.palette_id → color_palettes)
    let selected_palette = null;
    if (vendor.palette_id) {
        const p = await ColorPalette.findByPk(vendor.palette_id, {
            attributes: ['id', 'name', ...COLOR_KEYS],
        });
        if (p) selected_palette = p.toJSON();
    }

    // 2. Theme fallback colors
    const theme = await Theme.findByPk(vendor.theme_id, { attributes: COLOR_KEYS });

    // 3. theme_defaults = palette colors first, then theme colors as fallback
    const theme_defaults = {};
    for (const k of COLOR_KEYS) {
        theme_defaults[k] = (selected_palette?.[k]) || (theme?.[k]) || null;
    }

    // 4. Vendor custom colors (only if is_active = 1)
    const override = await VendorThemeColor.findOne({
        where: { vendor_id: vendor.id, theme_id: vendor.theme_id },
    });

    const has_custom = !!(override && override.is_active === 1);

    const custom_colors = has_custom ? {} : null;
    if (has_custom) {
        for (const k of COLOR_KEYS) custom_colors[k] = override[k] ?? null;
    }

    // 5. Merged = custom wins if active, else palette/theme defaults
    const merged = {};
    for (const k of COLOR_KEYS) {
        merged[k] = (has_custom && custom_colors[k]) ? custom_colors[k] : theme_defaults[k];
    }

    ApiResponse.success(res, {
        selected_palette,
        palette_id: vendor.palette_id ?? null,
        theme_defaults,
        custom_colors,
        merged,
        has_custom,
    }, 'Colors retrieved');
});

// PUT /vendors/subscription/colors
// Save custom 6 colors + set is_active = 1
const saveColors = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findByPk(req.vendor.id, { attributes: ['id', 'theme_id'] });
    if (!vendor?.theme_id) throw ApiError.badRequest('No active theme set');

    const patch = {};
    for (const k of COLOR_KEYS) {
        if (req.body[k] !== undefined) patch[k] = req.body[k];
    }

    const [row, created] = await VendorThemeColor.findOrCreate({
        where:    { vendor_id: vendor.id, theme_id: vendor.theme_id },
        defaults: { vendor_id: vendor.id, theme_id: vendor.theme_id, ...patch, is_active: 1 },
    });
    if (!created) await row.update({ ...patch, is_active: 1 });

    ApiResponse.success(res, { colors: row }, 'Custom colors saved and activated');
});

// PUT /vendors/subscription/colors/reset
// Deactivate custom colors → vendor falls back to selected palette
const resetCustomColors = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findByPk(req.vendor.id, { attributes: ['id', 'theme_id'] });
    if (!vendor?.theme_id) throw ApiError.badRequest('No active theme set');

    await VendorThemeColor.update(
        { is_active: 0 },
        { where: { vendor_id: vendor.id, theme_id: vendor.theme_id } }
    );

    ApiResponse.success(res, null, 'Custom colors deactivated');
});

// GET /vendors/home-blocks
const getHomeBlocks = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findByPk(req.vendor.id, { attributes: ['theme_id'] });
    if (!vendor?.theme_id) return ApiResponse.success(res, [], 'No active theme set');

    const theme = await Theme.findByPk(vendor.theme_id, { attributes: ['home_blocks'] });
    if (!theme) return ApiResponse.success(res, [], 'Theme not found');

    const raw = safeParseArray(theme.home_blocks);

    const blocks = raw.map(b => ({
        block_type: b.block_type,
        is_visible: b.is_visible !== false ? 1 : 0,
    }));

    ApiResponse.success(res, blocks, 'Home blocks retrieved');
});

module.exports = {
    getMyPlan,
    getThemesByPlan,
    selectTheme,
    getAllPalettes,
    selectPalette,
    getColors,
    saveColors,
    resetCustomColors,
    getHomeBlocks,
};
