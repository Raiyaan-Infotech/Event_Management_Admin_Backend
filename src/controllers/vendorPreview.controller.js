const {
    Vendor,
    VendorSlider,
    VendorPortfolioItem,
    VendorGallery,
    VendorTestimonial,
    VendorSocialLink,
    VendorPage,
    Theme,
    VendorThemeColor,
    ColorPalette,
} = require('../models');
const {  District, City } = require('../models');
const ApiResponse      = require('../utils/apiResponse');
const ApiError         = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { safeParseArray } = require('../utils/json');

const COLOR_KEYS = ['primary_color', 'secondary_color', 'header_color', 'footer_color', 'text_color', 'hover_color'];

async function buildPreviewData(vendorId) {
    const vendor = await Vendor.findByPk(vendorId, {
        attributes: [
            'id', 'company_name', 'company_logo', 'short_description', 'website',
            'about_us', 'company_information', 'company_contact', 'company_email',
            'company_address', 'nav_menu', 'footer_links', 'copywrite', 'poweredby',
            'newsletter_status', 'theme_id', 'palette_id',
        ],
        include: [
                    { model: District, as: 'district', attributes: ['id', 'name'] },
                    { model: City, as: 'locality', attributes: ['id', 'name', 'pincode'] },
                ],
    });

    if (!vendor) throw ApiError.notFound('Vendor not found');

    const { Subscription } = require('../models');
    const [sliders, portfolioItems, gallery, testimonials, plans, socialLinks, pages] = await Promise.all([
        VendorSlider.findAll({ where: { vendor_id: vendorId }, order: [['id', 'ASC']] }),
        VendorPortfolioItem.findAll({ where: { vendor_id: vendorId }, order: [['createdAt', 'DESC']] }),
        VendorGallery.findAll({ where: { vendor_id: vendorId }, order: [['createdAt', 'DESC']] }),
        VendorTestimonial.findAll({ where: { vendor_id: vendorId, is_active: 1 }, order: [['createdAt', 'DESC']] }),
        Subscription.findAll({
            where: { is_active: 1, is_custom: 0 },
            order: [['sort_order', 'ASC']],
            attributes: ['id', 'name', 'price', 'discounted_price', 'features', 'label_color'],
        }),
        VendorSocialLink.findAll({
            where: { vendor_id: vendorId, is_active: 1 },
            order: [['sort_order', 'ASC'], ['id', 'ASC']],
        }),
        VendorPage.findAll({
            where: { vendor_id: vendorId, is_active: 1 },
            attributes: ['id', 'name', 'description', 'content', 'is_active'],
            order: [['id', 'ASC']],
        }),
    ]);

    const termsPage = pages.find(page => page.name === 'Terms & Conditions');
    const privacyPage = pages.find(page => page.name === 'Privacy Policy');

    // ── Resolve active colors (priority: custom > palette > theme defaults) ──
    let colors = null;
    let theme_id = vendor.theme_id ?? null;
    let home_blocks = [];

    if (vendor.theme_id) {
        const [theme, palette, override] = await Promise.all([
            Theme.findByPk(vendor.theme_id, {
                attributes: [...COLOR_KEYS, 'home_blocks'],
            }),
            vendor.palette_id
                ? ColorPalette.findByPk(vendor.palette_id, { attributes: COLOR_KEYS })
                : Promise.resolve(null),
            VendorThemeColor.findOne({
                where: { vendor_id: vendorId, theme_id: vendor.theme_id },
            }),
        ]);

        // Theme fallback colors
        const theme_defaults = {};
        for (const k of COLOR_KEYS) theme_defaults[k] = theme?.[k] ?? null;

        // Selected palette colors
        let palette_defaults = null;
        if (palette) {
            palette_defaults = {};
            for (const k of COLOR_KEYS) palette_defaults[k] = palette[k] ?? null;
        }

        const has_custom = !!(override && override.is_active === 1);

        // Build merged colors
        colors = {};
        for (const k of COLOR_KEYS) {
            colors[k] = (has_custom && override[k])
                ? override[k]
                : (palette_defaults?.[k] || theme_defaults[k] || null);
        }

        // Home blocks
        if (theme?.home_blocks) {
            const raw = safeParseArray(theme.home_blocks);
            home_blocks = raw.map(b => ({
                block_type: b.block_type,
                variant:    b.variant || 'variant_1',
                is_visible: b.is_visible !== false,
            }));
        }
    }

    return {
        vendor,
        theme_id,
        home_blocks,
        colors,
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
        pages,
        terms_content:   termsPage?.content   || '',
        privacy_content: privacyPage?.content || '',
    };
}

// Public — for backward compat (admin with explicit id)
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
