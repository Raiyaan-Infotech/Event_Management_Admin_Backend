const {
    Vendor,
    VendorSlider,
    VendorPortfolioItem,
    VendorGallery,
    VendorTestimonial,
    VendorSocialLink,
    VendorPage,
    VendorClient,
    Theme,
    VendorThemeColor,
    ColorPalette,
    Subscription,
} = require('../models');
const ApiResponse      = require('../utils/apiResponse');
const ApiError         = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { safeParseArray } = require('../utils/json');
const { v4: uuidv4 } = require('uuid');

const COLOR_KEYS = ['primary_color', 'secondary_color', 'header_color', 'footer_color', 'text_color', 'hover_color'];

const toSlug = (name) =>
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const findActiveVendorBySlug = async (slug, attributes) => {
    const vendors = await Vendor.findAll({
        where: { status: 'active' },
        attributes,
        raw: true,
    });

    return vendors.find(v => toSlug(v.company_name || '') === slug);
};

const getPublicVendorWebsite = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const vendor = await findActiveVendorBySlug(slug, [
            'id', 'company_name', 'company_logo', 'short_description', 'website',
            'about_us', 'company_information', 'company_contact', 'company_email',
            'company_address', 'nav_menu', 'footer_links', 'copywrite', 'poweredby',
            'newsletter_status', 'theme_id', 'palette_id',
    ]);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const vendorId = vendor.id;

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

    // ── Resolve colors (3-tier) ──
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

        const theme_defaults = {};
        for (const k of COLOR_KEYS) theme_defaults[k] = theme?.[k] ?? null;

        let palette_defaults = null;
        if (palette) {
            palette_defaults = {};
            for (const k of COLOR_KEYS) palette_defaults[k] = palette[k] ?? null;
        }

        const has_custom = !!(override && override.is_active === 1);

        colors = {};
        for (const k of COLOR_KEYS) {
            colors[k] = (has_custom && override[k])
                ? override[k]
                : (palette_defaults?.[k] || theme_defaults[k] || null);
        }

        if (theme?.home_blocks) {
            const raw = safeParseArray(theme.home_blocks);
            home_blocks = raw.map(b => ({
                block_type: b.block_type,
                variant:    b.variant || 'variant_1',
                is_visible: b.is_visible !== false,
            }));
        }
    }

    ApiResponse.success(res, {
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
    }, 'Vendor website data retrieved');
});

const generateClientId = () => {
    return `CLI-${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
};

const registerPublicVendorClient = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const {
        name, email, mobile, address, country, state, district, city, locality, pincode,
        subscribe_newsletter: subscribeNewsletter,
    } = req.body;

    if (!name || !email || !mobile) {
        throw ApiError.badRequest('Name, email, and mobile are required');
    }

    const vendor = await findActiveVendorBySlug(slug, ['id', 'company_name', 'company_id']);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const existing = await VendorClient.findOne({
        where: {
            vendor_id: vendor.id,
            email,
        },
    });

    const wantsNewsletter = subscribeNewsletter === true || subscribeNewsletter === 1 || subscribeNewsletter === '1' || subscribeNewsletter === 'true';
    const clientType = wantsNewsletter ? 'subscribed' : 'unsubscribed';

    if (existing) {
        await existing.update({
            name,
            mobile,
            address: address || null,
            country: country || null,
            state: state || null,
            district: district || null,
            city: city || null,
            locality: locality || null,
            pincode: pincode || null,
            client_type: clientType,
            registration_type: existing.registration_type || 'guest',
            login_access: 1,
            is_active: 1,
        });

        return ApiResponse.success(res, existing, wantsNewsletter
            ? 'Existing client updated and subscribed successfully'
            : 'Existing client updated successfully');
    }

    const client = await VendorClient.create({
        vendor_id: vendor.id,
        company_id: vendor.company_id || null,
        client_id: generateClientId(),
        name,
        email,
        mobile,
        address: address || null,
        country: country || null,
        state: state || null,
        district: district || null,
        city: city || null,
        locality: locality || null,
        pincode: pincode || null,
        subscription_id: null,
        plan: null,
        registration_type: 'guest',
        client_type: clientType,
        login_access: 1,
        is_active: 1,
    });

    ApiResponse.success(res, client, 'Registration completed successfully', 201);
});

const loginPublicVendorClient = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { email, mobile } = req.body;

    if (!email || !mobile) {
        throw ApiError.badRequest('Email and mobile are required');
    }

    const vendor = await findActiveVendorBySlug(slug, ['id', 'company_name']);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const client = await VendorClient.findOne({
        where: {
            vendor_id: vendor.id,
            email,
            mobile,
        },
    });

    if (!client) throw ApiError.unauthorized('Invalid email or mobile');
    if (client.is_active !== 1) throw ApiError.forbidden('Your account is inactive. Please contact the vendor.');
    if (client.login_access !== 1) throw ApiError.forbidden('Login access is not enabled. Please contact the vendor.');

    ApiResponse.success(res, client, 'Login successful');
});

const subscribePublicVendorNewsletter = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { email, name, mobile } = req.body;

    if (!email) throw ApiError.badRequest('Email is required');

    const vendor = await findActiveVendorBySlug(slug, ['id', 'company_name', 'company_id']);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const existing = await VendorClient.findOne({ where: { vendor_id: vendor.id, email } });
    if (existing) {
        await existing.update({
            client_type: 'subscribed',
            registration_type: existing.registration_type || 'guest',
            login_access: existing.login_access === 1 ? 1 : existing.login_access,
        });
        return ApiResponse.success(res, existing, 'Newsletter subscribed successfully');
    }

    const localName = email.split('@')[0] || 'Newsletter Subscriber';
    const client = await VendorClient.create({
        vendor_id: vendor.id,
        company_id: vendor.company_id || null,
        client_id: generateClientId(),
        name: name || localName,
        email,
        mobile: mobile || '',
        registration_type: 'guest',
        client_type: 'subscribed',
        login_access: 0,
        is_active: 1,
    });

    ApiResponse.success(res, client, 'Newsletter subscribed successfully', 201);
});

module.exports = {
    getPublicVendorWebsite,
    registerPublicVendorClient,
    loginPublicVendorClient,
    subscribePublicVendorNewsletter,
};
