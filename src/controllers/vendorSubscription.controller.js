const { Subscription } = require('../models');
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

module.exports = { getMyPlan };
