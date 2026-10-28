const crypto = require('crypto');
const eventQr = require('./eventQr');

/**
 * PERSONAL QR codes (Jamal, 2026-10-28) — one per PERSON: each account
 * (`website_clients`: a host, or a participant — a participant's QR is their
 * account's, the same in every event they join) and each CONTACT PERSON
 * (vendor + mobile; they have no account). Made when that person is created.
 *
 * Same encryption and `EVQ1.` format as the event QR (utils/eventQr.js), so a
 * scanned code is opaque, cannot be forged, and one decode tells its type:
 * an event payload carries `eid`, a person payload carries `k` + `c`.
 *
 *   payload  { v: 1, k: 'c' | 'cp', c: <qr_code> }
 *
 * `qr_code` (32 random hex chars, unique) is what a scan looks the person up
 * by; `qr_token` is the encrypted string drawn as the QR, stored so the image
 * stays the same every time it is shown.
 */

const KINDS = { client: 'c', contact_person: 'cp' };
const KIND_NAMES = Object.fromEntries(Object.entries(KINDS).map(([name, k]) => [k, name]));

const newCode = () => crypto.randomBytes(16).toString('hex');

/** The QR string for one person. */
const issue = (kind, code) => {
    const k = KINDS[kind];
    if (!k) throw new Error(`personQr: unknown kind "${kind}"`);
    return eventQr.encrypt({ v: 1, k, c: code });
};

/**
 * A scanned string → `{ kind, code }` for a person QR, or null (an event QR,
 * a foreign code, a tampered one).
 */
const parse = (token) => {
    const payload = eventQr.decrypt(token);
    if (!payload || !KIND_NAMES[payload.k] || typeof payload.c !== 'string') return null;
    return { kind: KIND_NAMES[payload.k], code: payload.c };
};

/** Fill `qr_code` / `qr_token` on a row about to be inserted (no id needed). */
const stamp = (row, kind) => {
    if (row.qr_code && row.qr_token) return;
    const code = row.qr_code || newCode();
    row.qr_code = code;
    row.qr_token = issue(kind, code);
};

module.exports = { KINDS, newCode, issue, parse, stamp };
