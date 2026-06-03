const { Subscription, Vendor } = require('../models');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');

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

    const commonPlans = await Subscription.findAll({
        where: { is_custom: 0, is_active: 1 },
        order: [['sort_order', 'ASC'], ['price', 'ASC']],
    });

    if (customPlan) {
        return ApiResponse.success(
            res,
            { type: 'custom', plans: [customPlan], all_plans: [customPlan, ...commonPlans] },
            'Subscription retrieved',
        );
    }

    const normalizedMembership = (vendor.membership || '').trim().toLowerCase();
    const matchedPlan = commonPlans.find(
        (plan) => typeof plan.name === 'string' && plan.name.trim().toLowerCase() === normalizedMembership,
    );

    if (matchedPlan) {
        return ApiResponse.success(
            res,
            { type: 'common', plans: [matchedPlan], all_plans: commonPlans },
            'Subscription retrieved',
        );
    }

    ApiResponse.success(
        res,
        { type: 'common', plans: commonPlans, all_plans: commonPlans },
        'Subscription plans retrieved',
    );
});

// GET /vendors/client/subscription/plans
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

module.exports = {
    getMyPlan,
    getClientPlans,
};
