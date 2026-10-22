const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

/**
 * Mobile number check by country code, from Google's libphonenumber rules
 * (offline — no API call). The app runs the same rules (phone_numbers_parser),
 * so both sides agree.
 *
 *   checkMobile('+91', '98765 43210')   → { ok: true, dialCode: '+91', national: '9876543210' }
 *   checkMobile('+91', '+971501234567') → { ok: true, dialCode: '+971', national: '501234567' }
 *   checkMobile('+91', '12345')         → { ok: false }
 *
 * A number typed with its own "+code" wins over [dialCode]. A leading trunk 0
 * ("098765…") is dropped. Landlines are refused — the number is used for
 * WhatsApp / SMS invitations.
 */
const MOBILE_TYPES = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE']);

const checkMobile = (dialCode, mobile) => {
    const raw = String(mobile ?? '').replace(/[\s\-()]/g, '');
    if (!raw) return { ok: false };
    const code = String(dialCode ?? '').replace(/\D/g, '') || '91';
    const parsed = parsePhoneNumberFromString(raw, { defaultCallingCode: code });
    if (!parsed || !parsed.isValid() || !MOBILE_TYPES.has(parsed.getType())) {
        return { ok: false };
    }
    return {
        ok: true,
        dialCode: `+${parsed.countryCallingCode}`,
        national: String(parsed.nationalNumber),
    };
};

/** "Please enter a valid mobile number for +91." */
const invalidMobileMessage = (dialCode) => {
    const code = String(dialCode ?? '').replace(/\D/g, '');
    return code
        ? `Please enter a valid mobile number for +${code}.`
        : 'Please enter a valid mobile number.';
};

module.exports = { checkMobile, invalidMobileMessage };
