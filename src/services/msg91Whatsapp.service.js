const axios = require('axios');

const logger = require('../utils/logger');

/**
 * WhatsApp OTP delivery via MSG91.
 *
 * ── SCOPE: MOBILE OTP ONLY ──────────────────────────────────────────────────
 * This sends one thing — the six-digit code behind the app's Register and
 * Login screens. It is deliberately not a general "send a WhatsApp message"
 * helper: campaign sending already belongs to `clientMessage.service` and its
 * channel enum, and a shared sender here would invite the two to drift.
 *
 * ── THE CODE NEVER COMES FROM HERE ──────────────────────────────────────────
 * Both callers generate the code, bcrypt-hash it and store the hash BEFORE
 * calling this. That order matters: a code that is sent but not stored cannot
 * be verified, whereas a code stored but not sent merely fails a login the
 * guest can retry. So delivery failure is reported, never thrown — see `send`.
 *
 * ── WHY A TEMPLATE, AND NOT PLAIN TEXT ──────────────────────────────────────
 * A business-initiated WhatsApp message must go out on a Meta-approved
 * template; a free-form body is rejected outright. MSG91 carries the code in
 * `body_1`, and authentication templates additionally take `button_1` for the
 * one-tap "copy code" button. Both are sent when the template is an
 * authentication one, which is what MSG91's own OTP example shows.
 *
 * ⚠ Meta restricts authentication templates to verified businesses meeting a
 * daily conversation threshold. If the template is not approved, MSG91 answers
 * 200 with an error in the body — which is why `send` inspects the body rather
 * than trusting the status code.
 *
 * Docs: https://msg91.com/help/whatsapp/whatsapp-otp
 */

const ENDPOINT = 'https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/';

/** MSG91 stops waiting long before this; the cap is here so a hung socket
 *  cannot hold an OTP request open and time the caller's HTTP request out. */
const TIMEOUT_MS = 10_000;

/**
 * Configuration, read at call time rather than at module load.
 *
 * Read fresh on every send so the flags can be flipped in `.env` and picked up
 * on the next restart without this module caching a stale "not configured".
 */
const config = () => ({
    authKey: (process.env.MSG91_WA_AUTHKEY || '').trim(),
    template: (process.env.MSG91_OTP_TEMPLATE || '').trim(),
    number: (process.env.MSG91_WA_NUMBER || '').trim().replace(/\D/g, ''),

    /* Optional, and only because MSG91 accounts differ. An older WhatsApp
       Business account needs the template namespace; a newer one rejects
       nothing when it is absent, so it is omitted rather than sent empty. */
    namespace: (process.env.MSG91_WA_NAMESPACE || '').trim(),
    language: (process.env.MSG91_WA_LANG || 'en').trim(),

    /* Authentication templates carry a copy-code button and MUST be given its
       value; a plain utility template has no button and rejects the component.
       Defaults on, matching MSG91's OTP example. */
    withButton: (process.env.MSG91_OTP_BUTTON || 'true').toLowerCase() !== 'false',
});

/** Whether OTPs can actually be delivered. Callers use this to decide whether
 *  to log the code instead — never to decide whether to store it. */
const isConfigured = () => {
    const c = config();
    return Boolean(c.authKey && c.template && c.number);
};

/**
 * The number in the form WhatsApp wants: country code + subscriber, digits
 * only, no `+`.
 *
 * The stored `mobile` is the bare 10-digit number and the country lives apart
 * in `dial_code`, so the two are joined here. Sending the subscriber number
 * alone reaches nobody — WhatsApp has no concept of a default country.
 */
const toWhatsAppNumber = (dialCode, mobile) => {
    const local = String(mobile || '').replace(/\D/g, '');
    if (!local) return '';
    const cc = String(dialCode || '').replace(/\D/g, '') || '91';
    // Already carries its country code (an imported or OAuth-created row).
    return local.length > 10 ? local : `${cc}${local}`;
};

/**
 * Send one OTP.
 *
 * Resolves `{ delivered, reason }` and NEVER throws. A WhatsApp outage must
 * not turn into a 500 on the Verify button: the code is already stored, so the
 * honest outcome is "we could not deliver it", which the caller surfaces while
 * leaving the flow intact.
 */
const sendOtp = async ({ dialCode, mobile, code, purpose = 'login' }) => {
    const c = config();
    const to = toWhatsAppNumber(dialCode, mobile);

    if (!isConfigured()) return { delivered: false, reason: 'not_configured' };
    if (!to) return { delivered: false, reason: 'no_number' };

    const components = {
        body_1: { type: 'text', value: String(code) },
        ...(c.withButton
            ? { button_1: { subtype: 'url', type: 'text', value: String(code) } }
            : {}),
    };

    const body = {
        integrated_number: c.number,
        content_type: 'template',
        payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: {
                name: c.template,
                language: { code: c.language, policy: 'deterministic' },
                ...(c.namespace ? { namespace: c.namespace } : {}),
                to_and_components: [{ to: [to], components }],
            },
        },
    };

    try {
        const res = await axios.post(ENDPOINT, body, {
            headers: { 'Content-Type': 'application/json', authkey: c.authKey },
            timeout: TIMEOUT_MS,
            // Read the body on a 4xx too: MSG91 explains the refusal there, and
            // "Request failed with status code 400" alone is undebuggable.
            validateStatus: () => true,
        });

        // MSG91 answers 200 with `type: 'error'` for a template that is not
        // approved, so the status code alone does not mean delivered.
        const ok = res.status >= 200 && res.status < 300 && res.data?.type !== 'error';

        if (!ok) {
            logger.error?.(
                `[MSG91] ${purpose} OTP to ${to} REFUSED (http ${res.status}): ` +
                `${JSON.stringify(res.data)}`,
            );
            return {
                delivered: false,
                reason: res.data?.message || `http_${res.status}`,
            };
        }

        // The code itself is never logged on the success path — it is a live
        // credential for the next few minutes and logs outlive it.
        logger.info?.(`[MSG91] ${purpose} OTP delivered to ${to}`);
        return { delivered: true, reason: null };
    } catch (err) {
        logger.error?.(`[MSG91] ${purpose} OTP to ${to} FAILED: ${err.message}`);
        return { delivered: false, reason: err.code === 'ECONNABORTED' ? 'timeout' : 'network' };
    }
};

module.exports = { sendOtp, isConfigured, toWhatsAppNumber, ENDPOINT };
