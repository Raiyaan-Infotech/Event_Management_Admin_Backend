const { Subscription, Vendor, Theme } = require('../models');
const themeService     = require('../services/theme.service');
const { Op }           = require('sequelize');
const ApiResponse      = require('../utils/apiResponse');
const ApiError         = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');

// GET /vendors/subscription
// Returns the custom plan assigned to this vendor, or all common plans if none.
const getMyPlan = asyncHandler(async (req, res) => {
    const vendorId = req.vendor.id;

    // 1. Check for a custom plan assigned to this vendor
    const customPlan = await Subscription.findOne({
        where: { is_custom: 1, vendor_id: vendorId, is_active: 1 },
    });

    if (customPlan) {
        return ApiResponse.success(res, { type: 'custom', plans: [customPlan] }, 'Subscription retrieved');
    }

    // 2. Fall back to all active common plans
    const commonPlans = await Subscription.findAll({
        where: { is_custom: 0, is_active: 1 },
        order: [['sort_order', 'ASC'], ['price', 'ASC']],
    });

    ApiResponse.success(res, { type: 'common', plans: commonPlans }, 'Subscription plans retrieved');
});

// GET /vendors/subscription/themes/:planId
const getThemesByPlan = asyncHandler(async (req, res) => {
    const { planId } = req.params;
    const themes = await themeService.getThemesByPlan(planId);
    return ApiResponse.success(res, { themes }, 'Themes retrieved for plan');
});

// PUT /vendors/subscription/theme
// Saves the vendor's selected theme_id, clears custom_colors so new theme starts fresh
const selectTheme = asyncHandler(async (req, res) => {
    const vendorId = req.vendor.id;
    const { theme_id } = req.body;

    if (!theme_id) throw ApiError.badRequest('theme_id is required');

    const theme = await Theme.findByPk(theme_id);
    if (!theme || !theme.is_active) throw ApiError.notFound('Theme not found or inactive');

    await Vendor.update({ theme_id, custom_colors: null }, { where: { id: vendorId } });

    ApiResponse.success(res, { theme_id }, 'Theme saved successfully');
});

// GET /vendors/subscription/colors
// Returns theme default colors merged with vendor's custom overrides
const getColors = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findByPk(req.vendor.id, {
        attributes: ['theme_id', 'custom_colors'],
    });

    if (!vendor?.theme_id) throw ApiError.badRequest('No active theme set');

    const theme = await Theme.findByPk(vendor.theme_id, {
        attributes: ['primary_color', 'secondary_color', 'header_color', 'footer_color', 'text_color', 'hover_color'],
    });
    if (!theme) throw ApiError.notFound('Theme not found');

    const custom = vendor.custom_colors || {};
    const colors = {
        primary_color:   custom.primary_color   ?? theme.primary_color,
        secondary_color: custom.secondary_color ?? theme.secondary_color,
        header_color:    custom.header_color    ?? theme.header_color,
        footer_color:    custom.footer_color    ?? theme.footer_color,
        text_color:      custom.text_color      ?? theme.text_color,
        hover_color:     custom.hover_color     ?? theme.hover_color,
    };

    ApiResponse.success(res, { colors, has_custom: Object.keys(custom).length > 0 }, 'Colors retrieved');
});

// PUT /vendors/subscription/colors
// Saves vendor custom color overrides (partial — only provided keys stored)
const saveColors = asyncHandler(async (req, res) => {
    const vendor = await Vendor.findByPk(req.vendor.id, { attributes: ['id', 'custom_colors'] });

    const { primary_color, secondary_color, header_color, footer_color, text_color, hover_color, reset } = req.body;

    if (reset) {
        await vendor.update({ custom_colors: null });
        return ApiResponse.success(res, null, 'Colors reset to theme defaults');
    }

    const existing = vendor.custom_colors || {};
    const updated  = { ...existing };

    if (primary_color   !== undefined) updated.primary_color   = primary_color;
    if (secondary_color !== undefined) updated.secondary_color = secondary_color;
    if (header_color    !== undefined) updated.header_color    = header_color;
    if (footer_color    !== undefined) updated.footer_color    = footer_color;
    if (text_color      !== undefined) updated.text_color      = text_color;
    if (hover_color     !== undefined) updated.hover_color     = hover_color;

    await vendor.update({ custom_colors: updated });
    ApiResponse.success(res, { custom_colors: updated }, 'Colors saved successfully');
});

// GET /vendors/home-blocks
// Returns the home_blocks from the vendor's active theme — drives sidebar + BlockGuard
const getHomeBlocks = asyncHandler(async (req, res) => {
    const vendorId = req.vendor.id;

    const vendor = await Vendor.findByPk(vendorId, { attributes: ['theme_id'] });
    if (!vendor?.theme_id) {
        return ApiResponse.success(res, [], 'No active theme set');
    }

    const theme = await Theme.findByPk(vendor.theme_id, { attributes: ['home_blocks'] });
    if (!theme) {
        return ApiResponse.success(res, [], 'Theme not found');
    }

    const raw = Array.isArray(theme.home_blocks)
        ? theme.home_blocks
        : (typeof theme.home_blocks === 'string' ? JSON.parse(theme.home_blocks) : []);

    // Return in the shape the frontend hook expects: [{ block_type, is_visible }]
    const blocks = raw.map(b => ({
        block_type: b.block_type,
        is_visible: b.is_visible !== false ? 1 : 0,
    }));

    ApiResponse.success(res, blocks, 'Home blocks retrieved');
});

module.exports = { getMyPlan, getThemesByPlan, selectTheme, getHomeBlocks, getColors, saveColors };
