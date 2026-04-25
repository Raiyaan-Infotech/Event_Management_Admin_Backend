const {
    Vendor,
    VendorSlider,
    VendorPortfolioItem,
    VendorGallery,
    VendorTestimonial,
    VendorSocialLink,
} = require('../models');
const ApiResponse = require('../utils/apiResponse');
const ApiError    = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');

async function buildPreviewData(vendorId) {
    const vendor = await Vendor.findByPk(vendorId, {
        attributes: [
            'id', 'company_name', 'company_logo', 'short_description', 'website',
            'about_us', 'company_information', 'company_contact', 'company_email',
            'company_address', 'nav_menu', 'footer_links', 'copywrite', 'poweredby',
        ],
    });

    if (!vendor) throw ApiError.notFound('Vendor not found');

    const { Subscription } = require('../models');
    const [sliders, portfolioItems, gallery, testimonials, plans, socialLinks] = await Promise.all([
        VendorSlider.findAll({
            where: { vendor_id: vendorId },
            order: [['id', 'ASC']],
        }),
        VendorPortfolioItem.findAll({
            where: { vendor_id: vendorId },
            order: [['createdAt', 'DESC']],
        }),
        VendorGallery.findAll({
            where: { vendor_id: vendorId },
            order: [['createdAt', 'DESC']],
        }),
        VendorTestimonial.findAll({
            where: { vendor_id: vendorId, is_active: 1 },
            order: [['createdAt', 'DESC']],
        }),
        Subscription.findAll({
            where: { is_active: 1, is_custom: 0 },
            order: [['sort_order', 'ASC']],
            attributes: ['id', 'name', 'price', 'discounted_price', 'features', 'label_color'],
        }),
        VendorSocialLink.findAll({
            where: { vendor_id: vendorId, is_active: 1 },
            order: [['sort_order', 'ASC'], ['id', 'ASC']],
        }),
    ]);

    return {
        vendor,
        sliders,
        portfolio: {
            clients:  portfolioItems.filter(p => p.type === 'client'),
            sponsors: portfolioItems.filter(p => p.type === 'sponsor'),
            events:   portfolioItems.filter(p => p.type === 'event'),
        },
        gallery,
        testimonials,
        plans,
        socialLinks,
    };
}

// Public — for backward compat (admin might call with explicit id)
const getPreviewData = asyncHandler(async (req, res) => {
    const vendorId = parseInt(req.params.id, 10);
    const data = await buildPreviewData(vendorId);
    ApiResponse.success(res, data, 'Preview data retrieved');
});

// Authenticated — uses logged-in vendor's own ID
const getMyPreviewData = asyncHandler(async (req, res) => {
    const vendorId = req.vendor.id;
    const data = await buildPreviewData(vendorId);
    ApiResponse.success(res, data, 'Preview data retrieved');
});

module.exports = { getPreviewData, getMyPreviewData };
