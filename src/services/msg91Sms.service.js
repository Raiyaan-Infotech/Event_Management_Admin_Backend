const axios = require('axios');

const logger = require('../utils/logger');

/**
 * SMS OTP delivery via MSG91's Flow (templated SMS) API.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `msg91Whatsapp.service.js` is the only delivery channel today, and a
 * WhatsApp message CANNOT be read by Android's SMS Retriever / SMS User
 * Consent APIs — those only ever see the native SMS inbox. Autofilling the
 * OTP box on the mobile app's Register/Login screens is impossible without a
 * real SMS being sent, which is what this module adds. See the mobile app's
 * `sms_autofill_service.dart` for the client half.
 *
 * ── SAME CONTRACT AS msg91Whatsapp.service.js, ON PURPOSE ───────────────────
 * `sendOtp({ dialCode, mobile, code, purpose })` resolves `{ delivered,
 * reason }` and never throws, for the identical reason: the code is already
 * generated, bcrypt-hashed and stored by the caller BEFORE delivery is
 * attempted (see guestRegistration.service.js / websiteClient.service.js), so
 * a delivery failure must be reportable without losing a code that is still
 * checkable if the person already has it another way (e.g. WhatsApp, if both
 * channels are enabled).
 *
 * ── ⚠ INDIA REQUIRES A DLT-REGISTERED TEMPLATE — THIS CANNOT SEND FREE TEXT ──
 * TRAI regulation means an unregistered SMS body is silently dropped by the
 * carrier, not rejected by MSG91 — it looks "sent" and never arrives. The
 * template text, its variable placeholders, and the entity/template ids all
 * have to be registered with MSG91 first; `MSG91_SMS_FLOW_ID` and
 * `MSG91_SMS_VAR` below are configuration for a template that already exists
 * on the MSG91 side, not something this code can create.
 *
 * ── THE APP-HASH SUFFIX, FOR ANDROID AUTOFILL ────────────────────────────────
 * Android's SMS Retriever API only auto-reads a message whose text ends with
 * an 11-character hash of the app's own package name + signing certificate —
 * see https://developer.android.com/identity/sms-retriever/verify. That hash
 * MUST be part of the DLT-approved template's literal text (typically its own
 * variable), which is why it is sent as `MSG91_SMS_APP_HASH_VAR` rather than
 * appended here: this module cannot alter template text after the fact.
 *
 * Docs: https://docs.msg91.com/p/tf9GTextN/e/oWmXQ2yzL5/MSG91
 */

const ENDPOINT = 'https://control.msg91.com/api/v5/flow/';

/** Same reasoning as msg91Whatsapp.service.js's TIMEOUT_MS. */
const TIMEOUT_MS = 10_000;

const config = () => ({
    authKey: (process.env.MSG91_SMS_AUTHKEY || process.env.MSG91_WA_AUTHKEY || '').trim(),

    // The DLT-approved template's MSG91 flow id — NOT free text. Register the
    // template on MSG91's DLT panel first; this only points at it.
    flowId: (process.env.MSG91_SMS_FLOW_ID || '').trim(),

    // The template's variable name that holds the code, e.g. "OTP" or "VAR1" —
    // whatever the approved template actually declares.
    otpVar: (process.env.MSG91_SMS_VAR || 'OTP').trim(),

    // Optional: only set this if the registered template has a SEPARATE
    // variable for the Android app-hash suffix (see the file header). Empty
    // by default — sending a variable the template does not declare is
    // harmless to MSG91, but there is nothing to send until the template
    // exists, so this stays opt-in rather than assumed.
    appHashVar: (process.env.MSG91_SMS_APP_HASH_VAR || '').trim(),
    appHash: (process.env.MSG91_SMS_APP_HASH || '').trim(),

    // Independent on/off switch from MSG91_OTP_ENABLED (WhatsApp's), so SMS
    // can be trialled without touching the channel already in production.
    enabled: (process.env.MSG91_SMS_OTP_ENABLED || 'false').toLowerCase() === 'true',
});

const isDisabled = () => !config().enabled;

const isConfigured = () => {
    const c = config();
    return Boolean(c.authKey && c.flowId);
};

/** Country code + subscriber, digits only — identical shape to the WhatsApp
 *  sender's `toWhatsAppNumber`, since MSG91's SMS API wants the same format. */
const toSmsNumber = (dialCode, mobile) => {
    const local = String(mobile || '').replace(/\D/g, '');
    if (!local) return '';
    const cc = String(dialCode || '').replace(/\D/g, '') || '91';
    return local.length > 10 ? local : `${cc}${local}`;
};

/**
 * Send one OTP over SMS. Resolves `{ delivered, reason }`, never throws — see
 * the file header for why.
 */
const sendOtp = async ({ dialCode, mobile, code, purpose = 'login' }) => {
    const c = config();
    const to = toSmsNumber(dialCode, mobile);

    if (!c.enabled) return { delivered: false, reason: 'disabled' };
    if (!isConfigured()) return { delivered: false, reason: 'not_configured' };
    if (!to) return { delivered: false, reason: 'no_number' };

    const recipient = {
        mobiles: to,
        [c.otpVar]: String(code),
        ...(c.appHashVar && c.appHash ? { [c.appHashVar]: c.appHash } : {}),
    };

    const body = {
        flow_id: c.flowId,
        recipients: [recipient],
    };

    try {
        const res = await axios.post(ENDPOINT, body, {
            headers: { 'Content-Type': 'application/json', authkey: c.authKey },
            timeout: TIMEOUT_MS,
            validateStatus: () => true,
        });

        // MSG91's Flow API answers 200 with `type: 'error'` for a bad flow id
        // or a template MSG91 rejects, the same shape as the WhatsApp sender.
        const ok = res.status >= 200 && res.status < 300 && res.data?.type !== 'error';

        if (!ok) {
            logger.error?.(
                `[MSG91 SMS] ${purpose} OTP to ${to} REFUSED (http ${res.status}): ` +
                `${JSON.stringify(res.data)}`,
            );
            return { delivered: false, reason: res.data?.message || `http_${res.status}` };
        }

        logger.info?.(`[MSG91 SMS] ${purpose} OTP delivered to ${to}`);
        return { delivered: true, reason: null };
    } catch (err) {
        logger.error?.(`[MSG91 SMS] ${purpose} OTP to ${to} FAILED: ${err.message}`);
        return { delivered: false, reason: err.code === 'ECONNABORTED' ? 'timeout' : 'network' };
    }
};

module.exports = { sendOtp, isConfigured, isDisabled, toSmsNumber, ENDPOINT };
