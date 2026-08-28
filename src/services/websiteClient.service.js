const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Sequelize, WebsiteClient, Vendor } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS } = require('./websiteClientOAuth.service');

const MODEL_NAME = 'WebsiteClient';
const MODULE_SLUG = 'website_clients';

/** The tenant a public signup belongs to when the request cannot name one. */
const DEFAULT_VENDOR_ID = Number(process.env.WEBSITE_CLIENT_DEFAULT_VENDOR_ID || 1);

// Whitelist, so a stray body key can never write company_id, an id, or flip
// `source` / `email_verified` from an admin form.
// `subscription_plan_id` is here and deliberately NOT in REGISTRABLE_FIELDS:
// the plan is a commercial fact the admin decides, never something a
// visitor can grant themselves by putting it in a signup body.
const WRITABLE_FIELDS = ['name', 'email', 'dial_code', 'mobile', 'is_active', 'vendor_id', 'subscription_plan_id'];

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

/**
 * Every read carries `has_password` — whether this client can sign in at all.
 *
 * A row with no password is locked out permanently (see `create`), and until
 * this existed the admin list showed it as a perfectly normal active client.
 * The hash itself is NEVER returned: the literal reports only whether one is
 * set, and `exclude` is restated here rather than left to `defaultScope`,
 * because passing query-level `attributes` is exactly the case where relying on
 * a scope to still apply is a bet rather than a guarantee.
 *
 * QUALIFIED with the model alias on purpose. `VENDOR_INCLUDE` joins `vendors`,
 * which has its own `password` column, so a bare `password IS NOT NULL` is
 * ambiguous SQL and fails at runtime rather than at review.
 *
 * MySQL returns 1/0 for the comparison, not a boolean, so read it for
 * truthiness on the client rather than comparing against `false`.
 */
const CLIENT_ATTRIBUTES = {
    exclude: ['password', 'otp_hash'],
    include: [
        [Sequelize.literal('`WebsiteClient`.`password` IS NOT NULL'), 'has_password'],
    ],
};

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

/**
 * `paranoid: false` because `uniq_website_client_email (vendor_id, email)` is a
 * plain unique index — it counts soft-deleted rows, while a normal lookup does
 * not. Without this the insert collides and Sequelize reports only
 * "Validation error", which says nothing about what went wrong.
 *
 * A deleted row is NOT silently reused here, unlike the social path. There a
 * provider has proven the person controls the address; a password signup proves
 * nothing, so handing over a previous occupant's record would be a takeover.
 */
const assertEmailFree = async (email, vendorId, excludeId = null) => {
    const where = { email, vendor_id: vendorId };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    const existing = await WebsiteClient.findOne({
        where,
        attributes: ['id', 'deleted_at'],
        paranoid: false,
    });
    if (!existing) return;

    if (existing.deleted_at) {
        throw ApiError.badRequest(
            'An account with this email was removed previously. Please contact us to restore it.'
        );
    }
    throw ApiError.badRequest('An account with this email already exists.');
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

    // A public signup carries no company context, so this used to store NULL —
    // and every admin read scopes by `company_id` (base.service adds
    // `WHERE company_id = ?`), which NULL can never match. The rows existed but
    // were invisible in the one module that exists to show them. The vendor is
    // known, and it already belongs to a company, so derive it from there.
    let resolvedCompanyId = companyId ?? null;
    if (resolvedCompanyId == null) {
        const vendor = await Vendor.findByPk(resolvedVendorId, { attributes: ['id', 'company_id'] });
        resolvedCompanyId = vendor?.company_id ?? null;
    }

    // Not verified: there is no SMS provider wired up, so the signup form's OTP
    // is a local-only UI. The flags exist so turning that on is a flag flip.
    const created = await WebsiteClient.create({
        ...payload,
        vendor_id: resolvedVendorId,
        company_id: resolvedCompanyId,
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

    // The login form offers a mobile field, and it used to be ignored outright:
    // any number at all — including one belonging to nobody — was accepted so
    // long as the email and password matched. A field that looks like it is
    // being checked and is not is worse than no field.
    //
    // Checked only when one is supplied, because mobile is optional at signup
    // and a blank field means "not offered", not "must be empty". Compared on
    // digits alone so +91 98765 43210 and 9876543210 are the same number.
    //
    // Deliberately AFTER the password check: reversing them would let anyone
    // test whether a mobile number belongs to a given account without knowing
    // the password.
    const suppliedMobile = digitsOnly(data.mobile);
    if (suppliedMobile) {
        const storedMobile = digitsOnly(client.mobile);
        if (!storedMobile) {
            throw ApiError.unauthorized('This account has no mobile number on file.');
        }
        if (storedMobile !== suppliedMobile) {
            throw ApiError.unauthorized('That mobile number does not match this account.');
        }
    }

    if (client.is_active !== 1) {
        throw ApiError.forbidden('Your account is not active. Please contact us.');
    }

    // Re-read through the default scope. This instance does not carry the
    // password column at all, which is what makes the stamp below safe.
    const safeClient = await WebsiteClient.findByPk(client.id);

    // Gives the admin Clients list something real in its Last Login column.
    //
    // Stamped on the default-scoped instance deliberately, NOT on `client`.
    // `client` was loaded through `withPassword`, so it carries the hash, and
    // the model's beforeUpdate hook hashes the password whenever a row is
    // saved. Only that hook's own `changed('password')` check holds it off —
    // and a hash fed back through bcrypt yields a hash OF the hash, which
    // matches nothing. The account is then unrecoverable, and it fails
    // silently: the login that breaks it still succeeds, and the NEXT one
    // reads as a mistyped password. On `safeClient` the column is not loaded,
    // so there is nothing there to re-hash.
    //
    // Note this DOES move updated_at, and Sequelize's `silent` option cannot
    // stop it: the column is declared `ON UPDATE CURRENT_TIMESTAMP`, so MySQL
    // rewrites it on any change to the row no matter what the ORM sends. So a
    // sign-in reads as a modification in the admin Clients list. Left as is —
    // the alternative is either writing the old value back by hand on every
    // login, or dropping the DB default that every other table here relies on.
    await safeClient.update({ last_login_at: new Date() });

    return safeClient;
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
        attributes: CLIENT_ATTRIBUTES,
        where,
    });
};

const getById = async (id, companyId = undefined) =>
    baseService.getById(WebsiteClient, MODEL_NAME, id, {
        companyId,
        include: VENDOR_INCLUDE,
        attributes: CLIENT_ATTRIBUTES,
    });

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

    // REQUIRED, and deliberately so. This table began as a record of who signed
    // up, when an admin-created row was never expected to sign in. Since the
    // client portal shipped it IS an account someone signs into, and there is no
    // forgot-password, set-password or invite endpoint anywhere in the system —
    // so a row created without one can never obtain a password by any route.
    // Optional here meant locked out forever, reported as "Invalid email or
    // password" with nothing on the admin screen to explain it.
    //
    // Checked here and not only in the form: a direct POST bypasses the frontend
    // entirely, which is the same reason assertPasswordValid exists at all.
    if (!data.password) {
        throw ApiError.badRequest(
            'A password is required so the client can sign in to the portal.'
        );
    }
    assertPasswordValid(data.password);
    payload.password = data.password;

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

/**
 * `uniqueFields: ['email']` is the important part.
 *
 * These are self-signup accounts, so a deleted person coming back and signing
 * up again is ordinary user behaviour, not an edge case. The row is only soft
 * deleted, but `uniq_website_client_email (vendor_id, email)` is a plain unique
 * index that still counts it — so without this the address stays occupied
 * forever and the next signup dies on a duplicate key that Sequelize reports
 * only as "Validation error".
 *
 * base.service already solves this: it stamps the listed unique fields on the
 * way out so the value can be reused. It just defaults to ['slug', 'key'], and
 * nobody told it this table's unique field is the email.
 *
 * With this, deleting frees the address immediately and a returning visitor
 * simply signs up again and gets a working account — no restore, no admin
 * having to switch anything back on.
 */
const deleteById = async (id, userId = null, companyId = undefined) =>
    baseService.remove(WebsiteClient, MODEL_NAME, id, userId, companyId, {
        uniqueFields: ['email'],
    });

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

    // Accounts that cannot sign in at all, because no password was ever set.
    //
    // Scoped to the password sources on purpose: a client who signed up through
    // Google or Facebook has no password by design and signs in through the
    // provider, so counting them here would report a problem that does not
    // exist and bury the rows that are genuinely broken.
    const cannotSignIn = await WebsiteClient.count({
        where: {
            ...where,
            password: null,
            source: { [Op.in]: ['website', 'admin'] },
        },
    });

    return {
        total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        active: byStatus[1] || 0,
        inactive: byStatus[0] || 0,
        blocked: byStatus[2] || 0,
        cannot_sign_in: cannotSignIn,
    };
};


// ── Mobile OTP login (the mobile app's sign-in) ─────────────────────────────
//
// A SECOND way in, alongside email + password. The app signs a client in with
// the mobile number already on their record — nothing is created here, so a
// number that is not on an account cannot become one.
//
// ⚠ NOT the same as `sendMobileOtp` / `verifyMobileOtp` in
// websiteClientOAuth.service.js. Those ATTACH a number to an account that is
// already authenticated after a social sign-in, and are authorised by a
// short-lived link token. These two AUTHENTICATE, and are reached with no
// session at all — which is why they are here in the login service rather than
// beside their similarly-named cousins.
//
// ⚠ THERE IS STILL NO SMS PROVIDER. The code is generated, hashed and checked
// for real, but nothing delivers it; with OTP_ACCEPT_ANY on, any value passes.
// See the note on `verifyLoginOtp`.

/** Finds the ONE active client a number belongs to, within a tenant. */
const findClientByMobile = async (mobile, vendorId) => {
    const digits = digitsOnly(mobile);
    if (digits.length < 7 || digits.length > 15) {
        throw ApiError.badRequest('Please enter a valid mobile number.');
    }

    const resolvedVendorId = Number(vendorId) || DEFAULT_VENDOR_ID;

    /**
     * `unscoped`, because the OTP hash is the whole point of this lookup.
     *
     * The model's defaultScope excludes `otp_hash` — correct everywhere else,
     * and it silently broke this flow: `verifyLoginOtp` read `client.otp_hash`
     * as `undefined` and answered "please request a code first" for every code,
     * including a correct one just issued.
     *
     * `password` stays excluded rather than using the `withPassword` scope the
     * OAuth flow reaches for. Nothing here needs it, and an instance that does
     * not carry the hash cannot re-hash it on save — the trap that silently
     * bricks an account.
     */
    /**
     * Match on what was TYPED, and on the same number without a country code.
     *
     * Every stored `mobile` here is the bare national number (10 digits), with
     * the country code held separately in `dial_code`. But the login form shows
     * a `+91` prefix, so people reasonably type `+91 98846 99435` — which
     * `digitsOnly` turns into 12 digits and an exact match rejects, reporting
     * "no account is registered with that number" about an account that plainly
     * exists. That is a wrong answer, not a strict one.
     *
     * So the last 10 digits are tried as well. Kept to a small explicit
     * candidate list rather than a `LIKE '%…'` suffix match: a wildcard prefix
     * cannot use the index, and it would also match a DIFFERENT subscriber
     * whose number merely ends the same way.
     */
    const candidates = [...new Set([digits, digits.slice(-10)])];

    const client = await WebsiteClient.unscoped().findOne({
        where: { vendor_id: resolvedVendorId, mobile: { [Op.in]: candidates } },
        attributes: { exclude: ['password'] },
    });

    /**
     * ⚠ THIS ANSWER REVEALS WHETHER A NUMBER IS REGISTERED.
     *
     * The email login deliberately says "Invalid email or password" for both an
     * unknown address and a wrong password, so it cannot be used to enumerate
     * accounts. This one does not, and that is a considered trade, not an
     * oversight: these accounts are created BY AN ADMIN, so someone typing
     * their own number and being told nothing is wrong — then waiting for a
     * code that can never arrive — has no way to discover that they were never
     * added. Say so instead.
     *
     * If account enumeration matters more than that, return the same generic
     * "code sent" here and fail at verify.
     */
    if (!client) {
        throw ApiError.unauthorized('No account is registered with that mobile number.');
    }
    if (Number(client.is_active) !== 1) {
        throw ApiError.forbidden('Your account is not active. Please contact us.');
    }
    return client;
};

/**
 * Step 1 — issue a code to a registered number.
 *
 * No password is involved, so a client created by social sign-in (which has no
 * password at all) can use the app. That is a feature of this route, not a hole:
 * possession of the number is what is being tested, in place of the password.
 */
const requestLoginOtp = async (data = {}, vendorId = DEFAULT_VENDOR_ID) => {
    const client = await findClientByMobile(data.mobile, vendorId);

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = await bcrypt.hash(code, 10);

    // `hooks: false` so the model's beforeUpdate password hook cannot fire on a
    // row we did not load the password for.
    await client.update(
        {
            otp_hash: otpHash,
            otp_expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
            otp_attempts: 0,
        },
        { hooks: false }
    );

    // The delivery seam. Replace this line with the SMS call and the whole flow
    // keeps working unchanged.
    logger.info?.(
        `[OTP] login code for website_client ${client.id} -> ${client.dial_code || ''}${digitsOnly(data.mobile)}: ${code} (NOT SENT — no SMS provider)`
    );

    const echo =
        process.env.OTP_DEV_ECHO === 'true' && process.env.NODE_ENV !== 'production';

    return {
        expires_in: OTP_TTL_SECONDS,
        delivered: false,
        ...(echo ? { dev_code: code } : {}),
    };
};

/**
 * Step 2 — check the code and return the client to sign in.
 *
 * ⚠ OTP_ACCEPT_ANY makes the code decorative: with it on, ANY value passes,
 * so this endpoint proves only that the caller knows a registered number. That
 * is the agreed state until SMS exists. Turn it off the moment it does; nothing
 * else in this flow has to change.
 *
 * `mobile_verified` is deliberately NOT set by this route. Under the bypass it
 * would be a lie, and outside it the number was already verified when it was
 * put on the account.
 */
const verifyLoginOtp = async (data = {}, vendorId = DEFAULT_VENDOR_ID) => {
    const client = await findClientByMobile(data.mobile, vendorId);
    const code = digitsOnly(data.otp);

    if (!client.otp_hash || !client.otp_expires_at) {
        throw ApiError.badRequest('Please request a code first.');
    }
    if (new Date(client.otp_expires_at).getTime() < Date.now()) {
        throw ApiError.badRequest('That code has expired. Please request a new one.');
    }
    if (client.otp_attempts >= OTP_MAX_ATTEMPTS) {
        throw ApiError.badRequest('Too many incorrect attempts. Please request a new code.');
    }

    const acceptAny = process.env.OTP_ACCEPT_ANY === 'true';
    const matches =
        acceptAny || (code.length === 6 && (await bcrypt.compare(code, client.otp_hash)));

    if (!matches) {
        // Counted BEFORE the throw, or the cap is decorative.
        await client.update({ otp_attempts: client.otp_attempts + 1 }, { hooks: false });
        throw ApiError.badRequest('That code is not correct.');
    }

    if (acceptAny) {
        logger.warn?.(
            `[OTP] OTP_ACCEPT_ANY is on — accepted an unchecked login code for website_client ${client.id}`
        );
    }

    // Cleared so a used code can never be replayed.
    await client.update(
        { otp_hash: null, otp_expires_at: null, otp_attempts: 0, last_login_at: new Date() },
        { hooks: false }
    );

    // Re-read through the default scope so the caller never holds otp_hash.
    return WebsiteClient.findByPk(client.id);
};

module.exports = {
    register,
    login,
    requestLoginOtp,
    verifyLoginOtp,
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
