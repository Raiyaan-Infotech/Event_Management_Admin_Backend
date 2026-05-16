const { Subscription, Vendor, Theme, VendorThemeColor, ColorPalette } = require('../models');
const themeService     = require('../services/theme.service');
const { Op }           = require('sequelize');
const ApiResponse      = require('../utils/apiResponse');
const ApiError         = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { safeParseArray } = require('../utils/json');

const COLOR_KEYS = ['primary_color', 'secondary_color', 'header_color', 'footer_color', 'text_color', 'hover_color'];

const normalizePlanName = (value) => String(value || '').trim().toLowerCase();

const themeIncludesPlan = (theme, planId) =>
    safeParseArray(theme?.plans).map(Number).includes(Number(planId));

const findPlanByMembership = async (membership) => {
    const planName = normalizePlanName(membership);
    if (!planName) return null;

    const plans = await Subscription.findAll({
        where: { is_active: 1, is_custom: 0 },
        attributes: ['id', 'name'],
    });

    return plans.find((plan) => normalizePlanName(plan.name) === planName) || null;
};

// In-memory cache for home-blocks (per vendor, 15s TTL)
const homeBlocksCache = new Map();
const HOME_BLOCKS_TTL = 15 * 1000;
const getHomeBlocksCache = (vendorId) => {
    const entry = homeBlocksCache.get(vendorId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { homeBlocksCache.delete(vendorId); return null; }
    return entry.data;
};
const setHomeBlocksCache = (vendorId, data) => homeBlocksCache.set(vendorId, { data, expiresAt: Date.now() + HOME_BLOCKS_TTL });
const clearHomeBlocksCache = (vendorId) => homeBlocksCache.delete(vendorId);

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
        const commonPlans = await Subscription.findAll({
            where: { is_custom: 0, is_active: 1 },
            order: [['sort_order', 'ASC'], ['price', 'ASC']],
        });
        return ApiResponse.success(res, { type: 'custom', plans: [customPlan], all_plans: [customPlan, ...commonPlans] }, 'Subscription retrieved');
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
        return ApiResponse.success(res, { type: 'common', plans: [matchedPlan], all_plans: commonPlans }, 'Subscription retrieved');
    }

    ApiResponse.success(res, { type: 'common', plans: commonPlans, all_plans: commonPlans }, 'Subscription plans retrieved');
});

// GET /vendors/client/subscription/plans
// Client portal sees global common plans plus custom plans for the client's vendor.
const getClientPlans = asyncHandler(async (req, res) => {
    const vendorId = req.client.vendor_id;

    const [commonPlans, customPlans] = await Promise.all([
        Subscription.findAll({
            where: { is_custom: 0, is_active: 1 },
            order: [['sort_order', 'ASC'], ['price', 'ASC']],
        }),
        Subscription.findAll({
            where: { is_custom: 1, vendor_id: vendorId, is_active: 1 },
            order: [['sort_order', 'ASC'], ['price', 'ASC']],
        }),
    ]);

    ApiResponse.success(res, {
        type: customPlans.length > 0 ? 'custom_plus_common' : 'common',
        vendor_id: vendorId,
        custom_plans: customPlans,
        common_plans: commonPlans,
        plans: [...customPlans, ...commonPlans],
    }, 'Client subscription plans retrieved');
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

    const [vendor, theme] = await Promise.all([
        Vendor.findByPk(vendorId, { attributes: ['id', 'membership'] }),
        Theme.findByPk(theme_id),
    ]);
    if (!vendor) throw ApiError.notFound('Vendor not found');
    if (!theme || !theme.is_active) throw ApiError.notFound('Theme not found or inactive');

    const plan = await findPlanByMembership(vendor.membership);
    if (!plan || !themeIncludesPlan(theme, plan.id)) {
        throw ApiError.badRequest('Selected theme is not available for the current subscription plan');
    }

    // Clear vendor's custom block order when switching themes so they get the new theme's defaults
    await Vendor.update({ theme_id, home_blocks: null }, { where: { id: vendorId } });

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
    const cached = getHomeBlocksCache(req.vendor.id);
    if (cached) return ApiResponse.success(res, cached, 'Home blocks retrieved');

    const vendor = await Vendor.findByPk(req.vendor.id, { attributes: ['theme_id', 'home_blocks'] });
    if (!vendor?.theme_id) return ApiResponse.success(res, [], 'No active theme set');

    let blocks;
    if (vendor.home_blocks) {
        const raw = safeParseArray(vendor.home_blocks);
        if (raw.length > 0) {
            blocks = raw.map(b => ({
                block_type: b.block_type,
                variant:    b.variant || 'variant_1',
                is_visible: b.is_visible !== false ? 1 : 0,
            }));
            setHomeBlocksCache(req.vendor.id, blocks);
            return ApiResponse.success(res, blocks, 'Home blocks retrieved');
        }
    }

    const theme = await Theme.findByPk(vendor.theme_id, { attributes: ['home_blocks'] });
    if (!theme) return ApiResponse.success(res, [], 'Theme not found');

    const raw = safeParseArray(theme.home_blocks);
    blocks = raw.map(b => ({
        block_type: b.block_type,
        variant:    b.variant || 'variant_1',
        is_visible: b.is_visible !== false ? 1 : 0,
    }));

    setHomeBlocksCache(req.vendor.id, blocks);
    ApiResponse.success(res, blocks, 'Home blocks retrieved');
});

// PUT /vendors/home-blocks
const saveHomeBlocks = asyncHandler(async (req, res) => {
    const { blocks } = req.body;
    if (!Array.isArray(blocks)) throw ApiError.badRequest('blocks must be an array');

    const normalized = blocks.map(b => ({
        block_type: b.block_type,
        variant:    b.variant || 'variant_1',
        is_visible: b.is_visible !== false,
    }));

    await Vendor.update({ home_blocks: JSON.stringify(normalized) }, { where: { id: req.vendor.id } });
    clearHomeBlocksCache(req.vendor.id);

    ApiResponse.success(res, normalized, 'Home blocks saved');
});

module.exports = {
    getMyPlan,
    getClientPlans,
    getThemesByPlan,
    selectTheme,
    getAllPalettes,
    selectPalette,
    getColors,
    saveColors,
    resetCustomColors,
    getHomeBlocks,
    saveHomeBlocks,
};
