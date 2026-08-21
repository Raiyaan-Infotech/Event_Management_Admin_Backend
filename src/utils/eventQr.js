const crypto = require('crypto');

/**
 * The encrypted payload an event's QR code carries.
 *
 * ── WHAT THE QR ACTUALLY CONTAINS ────────────────────────────────────────────
 * The ciphertext itself, verbatim — not a URL. Point any ordinary QR scanner at
 * it and you get an opaque string like:
 *
 *   EVQ1.qLm3...  .Zt9x...  .8kJd7fQa...
 *
 * Nothing about the event, the tenant or the host leaks to whoever scanned it.
 * Only this backend holds the key, so only this backend can turn that string
 * back into event details — which is the point: the code can be printed on an
 * invitation and passed around, and it is still useless to anyone else.
 *
 * ── WHY AES-256-GCM AND NOT A JWT ────────────────────────────────────────────
 * A JWT is signed, not encrypted: its payload is base64 and anyone who scans it
 * reads every field. GCM gives both — confidentiality AND an authentication tag,
 * so a tampered code fails to decrypt rather than decrypting into a different
 * event id.
 *
 * ── FORMAT ───────────────────────────────────────────────────────────────────
 *   EVQ<version>.<iv>.<authTag>.<ciphertext>      all three parts base64url
 *
 * Dots as separators and base64url throughout keep it in the QR alphanumeric
 * range and out of the URL-escaping business. The version prefix is read before
 * anything is decrypted, so the payload shape can change later without breaking
 * codes already printed on paper.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Bumped when the PAYLOAD SHAPE changes — not when the key rotates. */
const QR_VERSION = 1;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;  // AES-256

let warnedAboutFallback = false;

/**
 * The 32-byte key, derived from the configured secret.
 *
 * Read at call time, not module load, so it survives the install wizard writing
 * .env after startup — the same reason utils/jwt.js does it that way.
 *
 * scrypt with a fixed salt is deliberate: the key must come out identical on
 * every process and every Render instance, or a code issued by one dyno cannot
 * be read by another. The salt is a domain label, not a secret; its job here is
 * only to keep this key independent of anything else derived from the same
 * password.
 */
const getKey = () => {
    let secret = process.env.EVENT_QR_SECRET;

    if (!secret) {
        // Falling back keeps local development working before the var is set.
        // It is derived through a different salt than any JWT use, so the two
        // keys are unrelated even though the password is shared.
        secret = process.env.ACCESS_TOKEN_SECRET;
        if (!warnedAboutFallback) {
            warnedAboutFallback = true;
            // eslint-disable-next-line no-console
            console.warn(
                '[eventQr] EVENT_QR_SECRET is not set — falling back to ACCESS_TOKEN_SECRET. ' +
                'Set EVENT_QR_SECRET before issuing real QR codes: changing the key later ' +
                'makes every code already printed undecryptable.'
            );
        }
    }

    if (!secret) {
        throw new Error(
            'eventQr: neither EVENT_QR_SECRET nor ACCESS_TOKEN_SECRET is set — cannot encrypt QR payloads.'
        );
    }

    return crypto.scryptSync(secret, 'event-qr-v1', KEY_BYTES);
};

const b64url = (buf) => buf.toString('base64url');
const unb64url = (str) => Buffer.from(str, 'base64url');

/**
 * Encrypt an object into the QR string.
 *
 * Keys are kept short on purpose. Every character is a module in the printed
 * code, and a QR that has to hold 400 characters needs a much denser grid than
 * one holding 200 — which matters when it is printed small on an invitation.
 */
const encrypt = (payload) => {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `EVQ${QR_VERSION}.${b64url(iv)}.${b64url(tag)}.${b64url(ciphertext)}`;
};

/**
 * Turn a scanned string back into the payload.
 *
 * Returns null for anything that is not a valid, untampered token of a version
 * this build understands — a wrong key, a truncated scan and a deliberately
 * edited code are all indistinguishable here, and all equally "not our code".
 * Callers must treat null as "unrecognised", never as an empty event.
 */
const decrypt = (token) => {
    if (typeof token !== 'string' || !token.startsWith('EVQ')) return null;

    const parts = token.trim().split('.');
    if (parts.length !== 4) return null;

    const version = Number(parts[0].slice(3));
    if (!Number.isInteger(version) || version < 1 || version > QR_VERSION) return null;

    try {
        const iv = unb64url(parts[1]);
        const tag = unb64url(parts[2]);
        const ciphertext = unb64url(parts[3]);

        if (iv.length !== IV_BYTES || tag.length !== 16) return null;

        const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
        decipher.setAuthTag(tag);

        // final() is what verifies the tag — it throws on any tampering, which
        // is why the whole thing sits in the try rather than just update().
        const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plain.toString('utf8'));
    } catch {
        return null;
    }
};

/**
 * The payload for one event row.
 *
 * Carries the ownership triple the feature was asked for — event id, company
 * id, vendor id — plus enough of a summary that a scanner can show something
 * useful without a second lookup. It is a SNAPSHOT: an event renamed later
 * still scans as its old name until the code is reissued, which is correct for
 * a code that may already be printed.
 */
const buildPayload = (event) => ({
    v: QR_VERSION,
    eid: event.id,
    cid: event.company_id ?? null,
    vid: event.vendor_id ?? null,
    clid: event.website_client_id ?? null,
    pid: event.subscription_plan_id ?? null,
    cat: event.event_category_id ?? null,
    typ: event.event_type_id ?? null,
    rel: event.religion_id ?? null,
    nm: event.name ?? null,
    sd: event.start_date ?? null,
    ed: event.end_date ?? null,
    st: event.start_time ?? null,
    et: event.end_time ?? null,
    ts: Math.floor(Date.now() / 1000),
});

/** The compact payload expanded back into readable field names. */
const expandPayload = (payload) => ({
    version: payload.v ?? null,
    event_id: payload.eid ?? null,
    company_id: payload.cid ?? null,
    vendor_id: payload.vid ?? null,
    website_client_id: payload.clid ?? null,
    subscription_plan_id: payload.pid ?? null,
    event_category_id: payload.cat ?? null,
    event_type_id: payload.typ ?? null,
    religion_id: payload.rel ?? null,
    name: payload.nm ?? null,
    start_date: payload.sd ?? null,
    end_date: payload.ed ?? null,
    start_time: payload.st ?? null,
    end_time: payload.et ?? null,
    issued_at: payload.ts ? new Date(payload.ts * 1000).toISOString() : null,
});

/** Encrypt an event row straight into its token. */
const issueToken = (event) => encrypt(buildPayload(event));

module.exports = {
    QR_VERSION,
    encrypt,
    decrypt,
    buildPayload,
    expandPayload,
    issueToken,
};
