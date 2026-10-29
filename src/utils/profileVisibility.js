/**
 * Participant Public Visibility (Jamal, 2026-10-29) — what OTHER participants
 * of a shared event may see of an account. The host and the event's contact
 * person always see everything; this only narrows participant-to-participant
 * views (the participants directory and a scanned personal QR).
 *
 *   profile_visibility  'everyone' | 'private'   (private = not shown at all)
 *   visible_fields      { photo, name, contact }  (NULL / missing key = shown)
 */
const VISIBILITIES = ['everyone', 'private'];
const FIELDS = ['photo', 'name', 'contact'];

const parseFields = (raw) => {
    let v = raw;
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch (e) { v = null; }
    }
    const out = {};
    for (const f of FIELDS) out[f] = !(v && typeof v === 'object' && v[f] === false);
    return out;
};

/** Everything shown — the host's / contact person's view. */
const ALL_SHOWN = Object.freeze({
    visibility: 'everyone',
    fields: Object.freeze({ photo: true, name: true, contact: true }),
});

/** The settings of one account row (any object carrying the two columns). */
const settingsOf = (client) => ({
    visibility: client?.profile_visibility === 'private' ? 'private' : 'everyone',
    fields: parseFields(client?.visible_fields),
});

/**
 * Validate the two keys of a `PUT /client/me` body. Returns the column patch;
 * calls `bad(message)` (which throws) on a wrong value.
 */
const patchFrom = (data, bad) => {
    const patch = {};
    if (data.profile_visibility !== undefined) {
        const v = String(data.profile_visibility || '').trim().toLowerCase();
        if (!VISIBILITIES.includes(v)) bad('Please choose who can see your profile.');
        patch.profile_visibility = v;
    }
    if (data.visible_fields !== undefined) {
        const src = data.visible_fields;
        if (src !== null && (typeof src !== 'object' || Array.isArray(src))) {
            bad('Please choose what others can see.');
        }
        patch.visible_fields = src === null ? null : parseFields(src);
    }
    return patch;
};

module.exports = { VISIBILITIES, FIELDS, ALL_SHOWN, settingsOf, patchFrom };
