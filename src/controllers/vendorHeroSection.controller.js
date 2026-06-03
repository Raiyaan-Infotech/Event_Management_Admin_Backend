const vendorHeroSectionService = require('../services/vendorHeroSection.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { logVendorActivity } = require('../middleware/activityLogger');

const get = asyncHandler(async (req, res) => {
    const heroSection = await vendorHeroSectionService.get(req.vendor.id);
    ApiResponse.success(res, heroSection, 'Hero section retrieved successfully');
});

const upsert = asyncHandler(async (req, res) => {
    const heroSection = await vendorHeroSectionService.upsert(
        req.body,
        req.vendor.id,
        req.vendor.company_id,
        req.vendor.id,
    );
    logVendorActivity(req.vendor.id, 'update_hero_section', 'vendor_hero_sections', 'Hero section updated', req);
    ApiResponse.success(res, heroSection, 'Hero section updated successfully');
});

module.exports = { get, upsert };
