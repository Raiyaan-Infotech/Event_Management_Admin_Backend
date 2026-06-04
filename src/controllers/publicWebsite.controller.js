const {
    Vendor,
    VendorClient,
    Subscription,
    District,
    City,
} = require('../models');
const ApiResponse      = require('../utils/apiResponse');
const ApiError         = require('../utils/apiError');
const { asyncHandler } = require('../utils/helpers');
const { v4: uuidv4 } = require('uuid');
const { generateClientHandoffToken } = require('../utils/jwt');
const { validateClientPassword } = require('../utils/clientPasswordPolicy');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const toSlug = (name) =>
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const findActiveVendorBySlug = async (slug, attributes, options = {}) => {
    const vendors = await Vendor.findAll({
        where: { status: 'active' },
        attributes,
        raw: true,
    });

    const matchedVendor = vendors.find(v => toSlug(v.company_name || '') === slug);
    if (!matchedVendor || !options.include) return matchedVendor;

    const vendor = await Vendor.findByPk(matchedVendor.id, {
        attributes,
        include: options.include,
    });
    return vendor ? vendor.toJSON() : matchedVendor;
};

const getPublicVendorWebsite = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const vendor = await findActiveVendorBySlug(slug, [
            'id', 'company_name', 'company_logo', 'short_description', 'website',
            'about_us', 'company_information', 'company_contact', 'company_email',
            'company_address', 'contact_mode', 'contact', 'alt_contact', 'alt_email',
            'address', 'alt_address', 'copywrite', 'poweredby',
            'city_id', 'state_id', 'country_id', 'pincode_id',
    ], {
        include: [
            { model: District, as: 'district', attributes: ['id', 'name'] },
            { model: City, as: 'locality', attributes: ['id', 'name', 'pincode'] },
        ],
    });
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const subscriptionPlans = await Subscription.findAll({
        where: { is_active: 1, is_custom: 0 },
        order: [['sort_order', 'ASC']],
        attributes: ['id', 'name', 'price', 'discounted_price', 'features', 'label_color'],
    });

    return ApiResponse.success(res, {
        vendor,
        colors: null,
        sliders: [],
        heroSection: null,
        portfolio: { clients: [], sponsors: [], events: [] },
        gallery: [],
        testimonials: [],
        plans: subscriptionPlans,
        socialLinks: [],
        pages: [],
        terms_content: '',
        privacy_content: '',
    }, 'Vendor data retrieved');

});

const generateClientId = () => {
    return `CLI-${uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
};

const registerPublicVendorClient = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const {
        name, email, mobile, password, address, country, state, district, city, locality, pincode,
        subscribe_newsletter: subscribeNewsletter,
    } = req.body;

    const normalizedEmail = normalizeEmail(email);

    if (!name || !normalizedEmail || !mobile || !password) {
        throw ApiError.badRequest('Name, email, mobile, and password are required');
    }
    validateClientPassword(password);

    const vendor = await findActiveVendorBySlug(slug, ['id', 'company_name', 'company_id']);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const existing = await VendorClient.findOne({
        where: { email: normalizedEmail },
        paranoid: false,
    });

    const wantsNewsletter = subscribeNewsletter === true || subscribeNewsletter === 1 || subscribeNewsletter === '1' || subscribeNewsletter === 'true';
    const clientType = wantsNewsletter ? 'subscribed' : 'unsubscribed';

    if (existing) {
        throw ApiError.conflict('This email is already registered.');
    }

    const client = await VendorClient.create({
        vendor_id: vendor.id,
        company_id: vendor.company_id || null,
        client_id: generateClientId(),
        name,
        email: normalizedEmail,
        mobile,
        password,
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
    const { email, password } = req.body;

    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
        throw ApiError.badRequest('Email and password are required');
    }

    const vendor = await findActiveVendorBySlug(slug, ['id', 'company_name']);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const client = await VendorClient.findOne({
        where: {
            vendor_id: vendor.id,
            email: normalizedEmail,
        },
        attributes: { include: ['password'] },
    });

    if (!client) throw ApiError.unauthorized('Invalid email or password');
    const isValid = await client.validatePassword(password);
    if (!isValid) throw ApiError.unauthorized('Invalid email or password');
    if (client.is_active !== 1) throw ApiError.forbidden('Your account is inactive. Please contact the vendor.');
    if (client.login_access !== 1) throw ApiError.forbidden('Login access is not enabled. Please contact the vendor.');

    ApiResponse.success(res, {
        handoff_token: generateClientHandoffToken(client),
    }, 'Login successful');
});

const subscribePublicVendorNewsletter = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const { email, name, mobile } = req.body;

    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail) throw ApiError.badRequest('Email is required');

    const vendor = await findActiveVendorBySlug(slug, ['id', 'company_name', 'company_id']);
    if (!vendor) throw ApiError.notFound('Vendor not found');

    const existing = await VendorClient.findOne({
        where: { email: normalizedEmail },
        paranoid: false,
    });
    if (existing) {
        if (existing.vendor_id !== vendor.id || existing.deletedAt) {
            throw ApiError.conflict('This email is already registered.');
        }
        await existing.update({
            client_type: 'subscribed',
            registration_type: existing.registration_type || 'guest',
            login_access: existing.login_access === 1 ? 1 : existing.login_access,
        });
        return ApiResponse.success(res, existing, 'Newsletter subscribed successfully');
    }

    const localName = normalizedEmail.split('@')[0] || 'Newsletter Subscriber';
    const client = await VendorClient.create({
        vendor_id: vendor.id,
        company_id: vendor.company_id || null,
        client_id: generateClientId(),
        name: name || localName,
        email: normalizedEmail,
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
