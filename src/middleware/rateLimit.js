const rateLimit = require('express-rate-limit');

/**
 * Rate limits for the endpoints where guessing is the attack.
 *
 * ── WHY THIS EXISTS NOW ─────────────────────────────────────────────────────
 * There was no rate limiting anywhere in this codebase. That was survivable
 * while every credential was a password or a long OTP hash, and stops being
 * survivable the moment a SIX DIGIT code is enough to sign in: a million
 * possibilities, and an unthrottled endpoint will answer as fast as the network
 * allows. A TOTP code is only a second factor if guessing it is slow.
 *
 * ── KEYED BY IP, WITH THE LIMITS OF THAT STATED ─────────────────────────────
 * `express-rate-limit` keys on the client IP. Behind Render's proxy that is only
 * correct if `trust proxy` is set on the app — otherwise every request appears
 * to come from the proxy and one attacker can exhaust everybody's budget. That
 * is a deployment property, not something this file can enforce, so it is named
 * here rather than assumed.
 *
 * Legitimate traffic never approaches these numbers. Somebody mistyping a code
 * three times in a row is not rate limited; somebody trying a thousand is.
 */

/** The message shape the rest of the API uses, so a 429 is not the odd one out. */
const handler = (message) => (req, res) => res.status(429).json({
    success: false,
    message,
});

/**
 * Sign-in and OTP request. Deliberately not tight enough to lock out a household
 * behind one NAT address who are all signing in at once.
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: handler('Too many attempts. Please wait a few minutes and try again.'),
});

/**
 * Anything that checks a short numeric code — the OTP verify and every 2FA
 * route. Much tighter, because this is the one somebody brute-forces.
 *
 * 10 in 15 minutes against a 6-digit space is ~0.001% of the keyspace per
 * window; a full sweep would take over two years.
 */
const codeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    // A wrong code should count. Only successes are forgiven, so somebody
    // signing in normally is never held against their own budget.
    skipSuccessfulRequests: true,
    handler: handler('Too many incorrect codes. Please wait a few minutes and try again.'),
});

/**
 * Token refresh. Higher, because an app in normal use refreshes on a timer and
 * several tabs can refresh at once — but still bounded.
 */
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: handler('Too many requests. Please wait a moment and try again.'),
});

module.exports = { authLimiter, codeLimiter, refreshLimiter };
