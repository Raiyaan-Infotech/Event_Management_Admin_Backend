const bcrypt = require('bcryptjs');
const { Sequelize, WebsiteClient, Vendor } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'WebsiteClient';
const MODULE_SLUG = 'website_clients';

/** The tenant a public signup belongs to when the request cannot name one. */
const DEFAULT_VENDOR_ID = Number(process.env.WEBSITE_CLIENT_DEFAULT_VENDOR_ID || 1);

// Whitelist, so a stray body key can never write company_id, an id, or flip
// `source` / `email_verified` from an admin form.
const WRITABLE_FIELDS = ['name', 'email', 'dial_code', 'mobile', 'is_active', 'vendor_id'];

// What a PUBLIC signup is allowed to set. Narrower than the admin whitelist on
// purpose: `is_active` and `vendor_id` are decided by the server, never by the
// visitor's request body.
const REGISTRABLE_FIELDS = ['name', 'email', 'dial_code', 'mobile', 'password'];

const pick = (fields, data = {}) =>
    fields.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

const VENDOR_INCLUDE = [
    { model: Vendor, as: 'vendor', attributes: ['id', 'company_name'], required: false },
];

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

// Mirrors the signup form's own rules. Kept here too because the frontend is
// not a trust boundary — a direct POST bypasses it entirely.
const assertPasswordValid = (password) => {
    const value = String(password || '');
    if (value.length < 8) throw ApiError.badRequest('Password must be at least 8 characters.');
    if (!/\d/.test(value)) throw ApiError.badRequest('Password must include a number.');
    if (!/[A-Z]/.test(value)) throw ApiError.badRequest('Password must include an uppercase letter.');
};

const assertEmailFree = async (email, vendorId, excludeId = null) => {
    const where = { email, vendor_id: vendorId };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    const existing = await WebsiteClient.findOne({ where, attributes: ['id'] });
    if (existing) throw ApiError.badRequest('An account with this email already exists.');
};

// ── Public: self-signup from the website ─────────────────────────────────────

/**
 * Creates a client from the public signup form.
 *
 * Returns the row WITHOUT its password (the model's defaultScope drops it).
 * No session is issued: these accounts have no portal to log into yet, so
 * handing back a token would imply a login that does not exist.
 */
const register = async (data = {}, vendorId = DEFAULT_VENDOR_ID, companyId = null) => {
    const payload = pick(REGISTRABLE_FIELDS, data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Full name is required.');
    }
    payload.name = String(payload.name).trim();

    payload.email = normalizeEmail(payload.email);
    if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
        throw ApiError.badRequest('A valid email address is required.');
    }

    assertPasswordValid(payload.password);

    payload.mobile = digitsOnly(payload.mobile) || null;
    payload.dial_code = String(payload.dial_code || '+91').trim();

    const resolvedVendorId = Number(vendorId) || DEFAULT_VENDOR_ID;
    await assertEmailFree(payload.email, resolvedVendorId);

    // Not verified: there is no SMS provider wired up, so the signup form's OTP
    // is a local-only UI. The flags exist so turning that on is a flag flip.
    const created = await WebsiteClient.create({
        ...payload,
        vendor_id: resolvedVendorId,
        company_id: companyId ?? null,
        source: 'website',
        email_verified: 0,
        mobile_verified: 0,
        is_active: 1,
        created_by: null,
    });

    // Re-read through the default scope so the hash cannot ride along.
    return WebsiteClient.findByPk(created.id);
};

// ── Public: login from the website ───────────────────────────────────────────

/**
 * Verifies a website client's credentials.
 *
 * Deliberately issues NO token and NO cookie. These accounts still have no
 * portal to land in, so the screen only confirms the credentials were right —
 * handing back a session would imply access that does not exist. When a client
 * area is built, this is where the token gets minted.
 *
 * The same "Invalid email or password" is returned for an unknown email and a
 * wrong password, so the response cannot be used to enumerate registered
 * addresses. An inactive account is told apart, because that is a state the
 * person cannot fix by guessing again.
 */
const login = async (data = {}, vendorId = DEFAULT_VENDOR_ID) => {
    const email = normalizeEmail(data.email);
    const password = String(data.password || '');

    if (!email || !password) {
        throw ApiError.badRequest('Email and password are required.');
    }

    const resolvedVendorId = Number(vendorId) || DEFAULT_VENDOR_ID;

    // `defaultScope` drops the hash, so it has to be asked for explicitly. The
    // model declares a `withPassword` scope for exactly this — an explicit scope
    // replaces the default one, so the hash comes back.
    const client = await WebsiteClient.scope('withPassword').findOne({
        where: { email, vendor_id: resolvedVendorId },
    });

    if (!client || !client.password) throw ApiError.unauthorized('Invalid email or password.');

    const isValid = await bcrypt.compare(password, client.password);
    if (!isValid) throw ApiError.unauthorized('Invalid email or password.');

    if (client.is_active !== 1) {
        throw ApiError.forbidden('Your account is not active. Please contact us.');
    }

    // Gives the admin Clients list something real in its Last Login column.
    // `silent` so the row's updated_at is not churned by a plain sign-in, and
    // `hooks: false` so beforeUpdate cannot re-hash the already-hashed password.
    await client.update({ last_login_at: new Date() }, { silent: true, hooks: false });

    // Re-read through the default scope so the hash cannot ride along.
    return WebsiteClient.findByPk(client.id);
};

// ── Admin CRUD ───────────────────────────────────────────────────────────────

const getAll = async (query = {}, companyId = undefined) => {
    const listQuery = { sort_by: 'created_at', sort_order: 'DESC', ...query };

    const where = {};
    if (query.source && query.source !== 'all') where.source = query.source;
    if (query.vendor_id && query.vendor_id !== 'all') where.vendor_id = Number(query.vendor_id);

    return baseService.getAll(WebsiteClient, MODEL_NAME, listQuery, {
        searchFields: ['name', 'email', 'mobile'],
        sortableFields: ['created_at', 'name', 'email', 'last_login_at'],
        companyId,
        moduleSlug: MODULE_SLUG,
        include: VENDOR_INCLUDE,
        where,
    });
};

const getById = async (id, companyId = undefined) =>
    baseService.getById(WebsiteClient, MODEL_NAME, id, { companyId, include: VENDOR_INCLUDE });

const create = async (data, userId = null, companyId = undefined) => {
    const payload = pick(WRITABLE_FIELDS, data);

    if (!payload.name || !String(payload.name).trim()) {
        throw ApiError.badRequest('Full name is required.');
    }
    payload.name = String(payload.name).trim();

    payload.email = normalizeEmail(payload.email);
    if (!payload.email) throw ApiError.badRequest('Email is required.');

    payload.vendor_id = Number(payload.vendor_id) || DEFAULT_VENDOR_ID;
    payload.mobile = digitsOnly(payload.mobile) || null;

    await assertEmailFree(payload.email, payload.vendor_id);

    // An admin-created account may be given a password; it is optional, since
    // these rows are primarily a record of who signed up.
    if (data.password) {
        assertPasswordValid(data.password);
        payload.password = data.password;
    }
    payload.source = 'admin';

    const created = await baseService.create(WebsiteClient, MODEL_NAME, payload, userId, companyId);
    return WebsiteClient.findByPk(created.id, { include: VENDOR_INCLUDE });
};

const update = async (id, data, userId = null, companyId = undefined) => {
    const client = await WebsiteClient.findByPk(id);
    if (!client) throw ApiError.notFound('Client not found');

    const payload = pick(WRITABLE_FIELDS, data);

    if (payload.name !== undefined) {
        if (!String(payload.name).trim()) throw ApiError.badRequest('Full name is required.');
        payload.name = String(payload.name).trim();
    }

    if (payload.email !== undefined) {
        payload.email = normalizeEmail(payload.email);
        if (!payload.email) throw ApiError.badRequest('Email is required.');
        await assertEmailFree(payload.email, payload.vendor_id ?? client.vendor_id, id);
    }

    if (payload.mobile !== undefined) payload.mobile = digitsOnly(payload.mobile) || null;

    // Changing a password is an explicit act, never a side effect of an edit
    // that happened to carry the field.
    if (data.password) {
        assertPasswordValid(data.password);
        payload.password = data.password;
    }

    await baseService.update(WebsiteClient, MODEL_NAME, id, payload, userId, companyId);
    return WebsiteClient.findByPk(id, { include: VENDOR_INCLUDE });
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) =>
    baseService.update(
        WebsiteClient,
        MODEL_NAME,
        id,
        // 0/1/2 all meaningful (inactive / active / blocked), so the raw value
        // is kept rather than coerced to a boolean.
        { is_active: Number(is_active) },
        userId,
        companyId
    );

const deleteById = async (id, userId = null, companyId = undefined) =>
    baseService.remove(WebsiteClient, MODEL_NAME, id, userId, companyId);

/** Counts for the list header. One grouped query, not four. */
const getStats = async (companyId = undefined) => {
    const where = {};
    if (companyId !== undefined && companyId !== null) where.company_id = companyId;

    const rows = await WebsiteClient.findAll({
        where,
        attributes: ['is_active', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        group: ['is_active'],
        raw: true,
    });

    const byStatus = rows.reduce((acc, row) => {
        acc[Number(row.is_active)] = Number(row.count);
        return acc;
    }, {});

    return {
        total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        active: byStatus[1] || 0,
        inactive: byStatus[0] || 0,
        blocked: byStatus[2] || 0,
    };
};

module.exports = {
    register,
    login,
    getAll,
    getById,
    getStats,
    create,
    update,
    updateStatus,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
