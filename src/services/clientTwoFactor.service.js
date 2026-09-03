const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const otp = require('otplib');
const { ClientTwoFactor, ClientBackupCode, WebsiteClient, sequelize } = require('../models');
const ApiError = require('../utils/apiError');

/**
 * Two-factor authentication for website clients — authenticator app (TOTP).
 *
 * ── WHY TOTP AND NOT SMS ────────────────────────────────────────────────────
 * There is no SMS provider in this project and none has been bought; the mobile
 * login OTP is written to the server log with "NOT SENT — no SMS provider". A
 * second factor that cannot be delivered is not a second factor. TOTP needs no
 * provider at all: Google Authenticator, Authy and Microsoft Authenticator all
 * read the same `otpauth://` URI, and verification is arithmetic against a
 * shared secret.
 *
 * ── ENROLMENT IS TWO STEPS ──────────────────────────────────────────────────
 * `setup` creates a secret and returns the QR; 2FA is NOT on yet. `confirm`
 * takes a code from the app, which is the only proof the QR was actually
 * scanned, and only then flips `is_enabled`. Enabling at setup would lock out
 * anybody who closed the tab halfway.
 *
 * ── ⚠ WHAT 2FA HERE DOES NOT COVER ──────────────────────────────────────────
 * The Flutter app signs in with a phone number and an OTP and is deliberately
 * NOT asked for a code (a product decision). So while 2FA protects the web
 * sign-in, the app remains a route in without it. The 2FA screen says this out
 * loud rather than implying the account is sealed.
 */

/*
  otplib's defaults are the interoperable ones — 6 digits, 30-second period,
  SHA1. These are not "weak settings", they are what the authenticator apps
  implement; changing them produces a QR that scans and then never matches.

  EPOCH_TOLERANCE is in SECONDS, not steps: 30 accepts the adjacent window in
  each direction, which is how a phone whose clock is a few seconds out still
  works.
*/
const DIGITS = 6;
const PERIOD = 30;
const EPOCH_TOLERANCE = 30;

const BACKUP_CODE_COUNT = 10;
/* No 0/O/1/I/L: these are read off a screen and typed, often from a printout. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ISSUER = process.env.TWO_FACTOR_ISSUER || 'Event Invit';

/* ── Backup codes ────────────────────────────────────────────────────────── */

/** `8F3R-L9KD-S2PQ` — grouped for reading aloud and for typing without losing your place. */
const generateBackupCode = () => {
    const pick = () => CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    const group = () => Array.from({ length: 4 }, pick).join('');
    return `${group()}-${group()}-${group()}`;
};

/** Comparison form: case and dashes are presentation, not part of the secret. */
const normaliseCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Replace the whole set.
 *
 * Regenerating INVALIDATES every previous code, which is the point — the reason
 * to regenerate is that you no longer trust the old list. Returns plaintext
 * ONCE; only hashes are kept, so this is the single moment they can be shown.
 */
const issueBackupCodes = async (clientId, transaction = null) => {
    await ClientBackupCode.destroy({ where: { website_client_id: clientId }, transaction });

    const codes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    await ClientBackupCode.bulkCreate(
        codes.map((code) => ({
            website_client_id: clientId,
            code_hash: bcrypt.hashSync(normaliseCode(code), 10),
        })),
        { transaction },
    );
    return codes;
};

/**
 * Spend a backup code, if it matches an unused one.
 *
 * Every unused hash has to be compared, because a hash cannot be looked up by
 * its plaintext — that is what makes it a hash. Ten bcrypt comparisons is the
 * cost of not storing them readable, and this path runs only when somebody has
 * lost their phone.
 */
const consumeBackupCode = async (clientId, input) => {
    const candidate = normaliseCode(input);
    if (!candidate) return false;

    const rows = await ClientBackupCode.findAll({
        where: { website_client_id: clientId, used_at: null },
    });

    for (const row of rows) {
        if (bcrypt.compareSync(candidate, row.code_hash)) {
            // Guarded UPDATE, not a plain save: two requests racing the same
            // code must not both be told it worked.
            const [spent] = await ClientBackupCode.update(
                { used_at: new Date() },
                { where: { id: row.id, used_at: null } },
            );
            return spent === 1;
        }
    }
    return false;
};

/* ── Status ──────────────────────────────────────────────────────────────── */

const getStatus = async (client) => {
    const [record, unused] = await Promise.all([
        ClientTwoFactor.findOne({ where: { website_client_id: client.id } }),
        ClientBackupCode.count({ where: { website_client_id: client.id, used_at: null } }),
    ]);

    return {
        is_enabled: Boolean(record?.is_enabled),
        // A secret exists but was never confirmed — the screen offers "finish
        // setting up" rather than starting again from a new QR.
        is_pending: Boolean(record) && !record.is_enabled,
        confirmed_at: record?.confirmed_at ?? null,
        last_used_at: record?.last_used_at ?? null,
        backup_codes_remaining: unused,
        /*
          Stated by the API rather than written into the screen, so the day the
          app does implement a challenge this stops claiming otherwise without
          anybody having to find the component.
        */
        covers: {
            web_sign_in: true,
            mobile_app: false,
            note: 'The mobile app signs in with your phone number and a one-time code, and is not asked for an authenticator code.',
        },
    };
};

/* ── Enrolment ───────────────────────────────────────────────────────────── */

/**
 * Begin enrolment: a secret and the `otpauth://` URI its QR encodes.
 *
 * The QR is drawn in the BROWSER from this URI. Rendering a PNG here would mean
 * the secret travelling as an image nobody can inspect, and a QR library in a
 * backend that has no other use for one.
 */
const beginSetup = async (client) => {
    const existing = await ClientTwoFactor.scope('withSecret').findOne({
        where: { website_client_id: client.id },
    });

    if (existing?.is_enabled) {
        throw ApiError.badRequest('Two-factor authentication is already on. Turn it off first if you want to set it up again.');
    }

    // Reuse an unconfirmed secret rather than minting a new one on every visit:
    // somebody who scanned the QR, switched apps and came back would otherwise
    // find their authenticator generating codes for a secret we had discarded.
    const secret = existing?.secret || otp.generateSecret();

    if (existing) await existing.update({ secret });
    else await ClientTwoFactor.create({ website_client_id: client.id, secret, is_enabled: false });

    return {
        secret,
        // The label is what shows up in the authenticator's list, so it has to
        // say which account it is — these apps hold one line per entry.
        otpauth_url: otp.generateURI({
            strategy: 'totp',
            issuer: ISSUER,
            label: client.email || `client-${client.id}`,
            secret,
        }),
        issuer: ISSUER,
        digits: DIGITS,
        period: PERIOD,
    };
};

/**
 * Check a code against the stored secret, refusing a replay.
 *
 * `verifySync` returns `{ valid, delta, epoch, timeStep }`, and `timeStep` is
 * the 30-second window the code belonged to. Recording it means the SAME six
 * digits cannot be used twice inside their window — without it, a code read
 * over somebody's shoulder stays good for up to a minute.
 */
const verifyTotp = async (record, code) => {
    const token = String(code || '').replace(/\D/g, '');
    if (token.length !== DIGITS) return false;

    let result;
    try {
        result = otp.verifySync({
            secret: record.secret,
            token,
            epochTolerance: EPOCH_TOLERANCE,
        });
    } catch {
        // A malformed or corrupted secret throws rather than returning false.
        // Treated as "did not verify" — this runs on the sign-in path, where an
        // exception would be a 500 on somebody's login screen.
        return false;
    }
    if (!result?.valid) return false;

    const counter = Number(result.timeStep);
    if (record.last_used_counter !== null && Number(record.last_used_counter) >= counter) {
        return false;
    }

    await record.update({ last_used_counter: counter, last_used_at: new Date() });
    return true;
};

/**
 * Finish enrolment. Returns the backup codes, which are shown exactly once.
 */
const confirmSetup = async (client, code) => {
    const record = await ClientTwoFactor.scope('withSecret').findOne({
        where: { website_client_id: client.id },
    });
    if (!record) throw ApiError.badRequest('Start setting up two-factor authentication first.');
    if (record.is_enabled) throw ApiError.badRequest('Two-factor authentication is already on.');

    if (!(await verifyTotp(record, code))) {
        throw ApiError.badRequest('That code is not right. Check your authenticator app and try the current code.');
    }

    return sequelize.transaction(async (t) => {
        await record.update({ is_enabled: true, confirmed_at: new Date() }, { transaction: t });
        const codes = await issueBackupCodes(client.id, t);
        return { codes };
    });
};

/**
 * Turn it off — but only for somebody who can prove they are the account
 * holder right now. Without that, anybody who finds an unlocked laptop can
 * remove the protection that laptop was supposed to need.
 */
const disable = async (client, { password, code } = {}) => {
    const record = await ClientTwoFactor.scope('withSecret').findOne({
        where: { website_client_id: client.id },
    });
    if (!record?.is_enabled) throw ApiError.badRequest('Two-factor authentication is not on.');

    let proved = false;

    if (code) {
        proved = (await verifyTotp(record, code)) || (await consumeBackupCode(client.id, code));
    }

    if (!proved && password) {
        const withPassword = await WebsiteClient.scope('withPassword').findByPk(client.id);
        proved = Boolean(withPassword?.password)
            && bcrypt.compareSync(String(password), withPassword.password);
    }

    if (!proved) {
        /*
          A social-only account has no password to offer, so its only proof is a
          code. Saying which is missing is not a leak — the person is already
          signed in — and "incorrect" with no explanation is unactionable.
        */
        throw ApiError.badRequest('Enter your current password or a code from your authenticator app to turn this off.');
    }

    await sequelize.transaction(async (t) => {
        await ClientBackupCode.destroy({ where: { website_client_id: client.id }, transaction: t });
        await record.destroy({ transaction: t });
    });

    return { is_enabled: false };
};

const regenerateBackupCodes = async (client) => {
    const record = await ClientTwoFactor.findOne({ where: { website_client_id: client.id } });
    if (!record?.is_enabled) {
        throw ApiError.badRequest('Turn on two-factor authentication before generating backup codes.');
    }
    const codes = await issueBackupCodes(client.id);
    return { codes };
};

/**
 * The sign-in check: a TOTP code, or a backup code, either being enough.
 *
 * Used by the login challenge. Returns false rather than throwing, so the
 * caller decides the wording and the rate limiting.
 */
const verifyForLogin = async (clientId, code) => {
    const record = await ClientTwoFactor.scope('withSecret').findOne({
        where: { website_client_id: clientId, is_enabled: true },
    });
    if (!record) return false;
    if (await verifyTotp(record, code)) return true;
    return consumeBackupCode(clientId, code);
};

/** Is 2FA on for this client? One query, for the login path to branch on. */
const isEnabledFor = async (clientId) => {
    const count = await ClientTwoFactor.count({
        where: { website_client_id: clientId, is_enabled: true },
    });
    return count > 0;
};

/**
 * The value a device-trust token must match to still count as trust.
 *
 * Turning 2FA off and back on gives a fresh `confirmed_at`, so every trust
 * token issued under the old enrolment stops matching automatically — that is
 * what makes re-enrolling itself revoke standing trust, with no separate list
 * of revoked tokens to maintain.
 */
const confirmedAtFor = async (clientId) => {
    const record = await ClientTwoFactor.findOne({
        where: { website_client_id: clientId, is_enabled: true },
    });
    return record?.confirmed_at ?? null;
};

/**
 * Does a presented device-trust token still hold for this client?
 *
 * Compared as epoch milliseconds against the CURRENT `confirmed_at`, not
 * against what the token claims about itself — the token is untrusted input
 * until this check passes.
 */
const deviceTrustMatches = async (clientId, tokenTfa) => {
    if (!tokenTfa) return false;
    const confirmedAt = await confirmedAtFor(clientId);
    if (!confirmedAt) return false;
    return new Date(confirmedAt).getTime() === Number(tokenTfa);
};

module.exports = {
    getStatus,
    beginSetup,
    confirmSetup,
    disable,
    regenerateBackupCodes,
    verifyForLogin,
    isEnabledFor,
    confirmedAtFor,
    deviceTrustMatches,
    consumeBackupCode,
    issueBackupCodes,
    BACKUP_CODE_COUNT,
};
