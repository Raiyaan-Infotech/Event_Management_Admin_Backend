const {
    SubscriptionPlan,
    WebsiteClient,
    ClientSubscription,
    GuestGroup,
} = require('../models');
const ApiError = require('../utils/apiError');
const subscriptionPlanService = require('./subscriptionPlan.service');

/**
 * Field handling shared by the PHONE BOOK (`guests`) and the
 * PARTICIPANTS of an event (`event_participants`) — §581.
 *
 * A participant is described by the same person fields as a guest (the
 * portal's Add Guest form and the app's Add Participant form are one field set,
 * §504), plus the answers that only make sense for ONE event: RSVP, party size,
 * table number. So:
 *
 *   normalisePerson      both tables
 *   normaliseAttendance  event_participants only
 *
 * One module so the two cannot drift: a field added to the guest form and
 * forgotten on the participant form is exactly the §504 bug.
 */

const PERSON_FIELDS = [
    'group_id',
    'title', 'first_name', 'last_name', 'date_of_birth', 'email', 'dial_code', 'mobile', 'whatsapp',
    'gender', 'relationship', 'relationship_option_id', 'company',
    'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country',
    'dietary_preference', 'food_preference_option_id', 'special_requirements', 'notes',
];

const ATTENDANCE_FIELDS = [
    'table_number', 'party_size',
    'rsvp_status', 'response_type', 'invite_source',
    'plus_one', 'plus_one_count', 'custom_answers',
];

const GENDERS = ['male', 'female', 'other'];
const RSVP_STATUSES = ['not_responded', 'invited', 'pending', 'accepted', 'declined'];
const RESPONSE_TYPES = ['none', 'yes', 'no', 'maybe'];
const INVITE_SOURCES = ['whatsapp', 'email', 'sms', 'manual', 'import', 'qr'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (value, max) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed.slice(0, max) : null;
};

/** Build the display name from the parts, so `name` never drifts from them. */
const composeName = (first, last, fallback) => {
    const joined = [first, last].filter(Boolean).join(' ').trim();
    return joined || fallback || null;
};

/** Last 10 digits — how a mobile is compared, whatever format it was typed in. */
const mobileKey = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const pick = (body, fields) => {
    const picked = {};
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(body || {}, field)) picked[field] = body[field];
    }
    return picked;
};

/**
 * The person fields, validated. `partial` = an update: only what was sent is
 * touched, and first name / mobile are required only when sent.
 *
 * Email is OPTIONAL and mobile MANDATORY (§576): an invitation is shared to a
 * phone number, so that is the field a guest cannot be without.
 */
const normalisePerson = async (clientId, body, { partial = false, existing = null } = {}) => {
    const data = {};
    const picked = pick(body, PERSON_FIELDS);
    const has = (f) => Object.prototype.hasOwnProperty.call(picked, f);
    const required = (f) => !partial || has(f);

    // ── Group: optional, must be the client's own ──────────────────────────
    if (has('group_id')) {
        const raw = picked.group_id;
        if (raw === '' || raw === null || raw === undefined) {
            data.group_id = null;
        } else {
            const groupId = Number(raw);
            const group = await GuestGroup.findOne({
                where: { id: groupId, website_client_id: clientId },
                attributes: ['id'],
            });
            if (!group) throw ApiError.badRequest('That guest group is not on your account.');
            data.group_id = groupId;
        }
    }

    // ── Identity ───────────────────────────────────────────────────────────
    if (required('first_name')) {
        const first = str(picked.first_name, 100);
        if (!first) throw ApiError.badRequest('Please enter the first name.');
        data.first_name = first;
    }
    if (has('last_name')) data.last_name = str(picked.last_name, 100);
    if (has('title')) data.title = str(picked.title, 30);

    // YYYY-MM-DD or empty. Checked as a REAL calendar date (2026-02-30 is not),
    // and never in the future — a birthday that has not happened yet is a typo.
    if (has('date_of_birth')) {
        const raw = str(picked.date_of_birth, 10);
        if (!raw) {
            data.date_of_birth = null;
        } else {
            const valid = /^\d{4}-\d{2}-\d{2}$/.test(raw)
                && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw;
            if (!valid) throw ApiError.badRequest('Please enter a valid date of birth.');
            if (raw > new Date().toISOString().slice(0, 10)) {
                throw ApiError.badRequest('Date of birth cannot be in the future.');
            }
            data.date_of_birth = raw;
        }
    }

    if (data.first_name !== undefined || data.last_name !== undefined) {
        data.name = composeName(
            data.first_name ?? existing?.first_name,
            data.last_name !== undefined ? data.last_name : existing?.last_name,
            existing?.name
        );
    }

    if (has('email')) {
        const email = str(picked.email, 255);
        if (email && !EMAIL.test(email)) throw ApiError.badRequest('Please enter a valid email address.');
        data.email = email ? email.toLowerCase() : null;
    }

    if (has('dial_code')) data.dial_code = str(picked.dial_code, 8);
    // Digits, +, spaces and dashes only — a pasted "(+91) 98765-43210" is fine,
    // a name in the phone box is not.
    for (const field of ['mobile', 'whatsapp']) {
        if (!has(field) && !(field === 'mobile' && required('mobile'))) continue;
        const value = str(picked[field], 20);
        if (field === 'mobile' && !value) throw ApiError.badRequest('Please enter the mobile number.');
        if (value && !/^[+\d][\d\s-]{4,}$/.test(value)) {
            throw ApiError.badRequest('Please enter a valid phone number.');
        }
        data[field] = value;
    }

    const optional = {
        company: 200, address_line1: 255, address_line2: 255, city: 120, state: 120,
        postal_code: 20, country: 100, dietary_preference: 255,
        special_requirements: 500, notes: 500, relationship: 60,
    };
    for (const [field, max] of Object.entries(optional)) {
        if (has(field)) data[field] = str(picked[field], max);
    }

    // Matched against the list rather than stored as typed.
    if (has('gender')) data.gender = GENDERS.includes(picked.gender) ? picked.gender : null;

    // The option-table ids behind `relationship` and `dietary_preference`. The
    // label is what was chosen at the time and survives the option being
    // renamed; the id joins back to the catalogue. Both are kept.
    for (const field of ['relationship_option_id', 'food_preference_option_id']) {
        if (has(field)) {
            const id = Number(picked[field]);
            data[field] = Number.isInteger(id) && id > 0 ? id : null;
        }
    }

    return data;
};

/**
 * Status and response move together when a participant actually replies — the
 * one place that decision lives, so a row never reads `Declined` beside `Yes`.
 */
const applyResponse = (data, previous = {}) => {
    const response = data.response_type ?? previous.response_type;
    const statusGiven = Object.prototype.hasOwnProperty.call(data, 'rsvp_status');
    // An explicit status wins — an import row that says Invited must stay so.
    if (statusGiven) return;
    if (!response || response === 'none') return;
    data.rsvp_status = response === 'yes' ? 'accepted' : response === 'no' ? 'declined' : 'pending';
};

/** The answers about ONE event — participants only. */
const normaliseAttendance = (body, { existing = null } = {}) => {
    const data = {};
    const picked = pick(body, ATTENDANCE_FIELDS);
    const has = (f) => Object.prototype.hasOwnProperty.call(picked, f);

    if (has('table_number')) data.table_number = str(picked.table_number, 30);

    if (has('party_size')) {
        const size = Number(picked.party_size);
        if (!Number.isInteger(size) || size < 1 || size > 50) {
            throw ApiError.badRequest('Party size must be between 1 and 50.');
        }
        data.party_size = size;
    }

    if (has('rsvp_status')) {
        const value = String(picked.rsvp_status || '').toLowerCase();
        if (!RSVP_STATUSES.includes(value)) throw ApiError.badRequest('Invalid RSVP status.');
        data.rsvp_status = value;
    }
    if (has('response_type')) {
        const value = String(picked.response_type || 'none').toLowerCase();
        if (!RESPONSE_TYPES.includes(value)) throw ApiError.badRequest('Invalid response type.');
        data.response_type = value;
    }
    if (has('invite_source')) {
        const value = String(picked.invite_source || 'manual').toLowerCase();
        if (!INVITE_SOURCES.includes(value)) throw ApiError.badRequest('Invalid invite source.');
        data.invite_source = value;
    }

    applyResponse(data, existing ?? {});

    // Stamp the moment a real answer first arrives; clear it if the answer is
    // taken back — a responded_at with no response makes the response rate wrong.
    const responded = data.response_type && data.response_type !== 'none';
    if (responded && !existing?.responded_at) data.responded_at = new Date();
    if (data.response_type === 'none') data.responded_at = null;

    if (has('plus_one')) data.plus_one = picked.plus_one ? 1 : 0;
    if (has('plus_one_count')) {
        const count = Number(picked.plus_one_count) || 0;
        if (count < 0 || count > 20) throw ApiError.badRequest('Plus one count must be 20 or fewer.');
        data.plus_one_count = count;
    }
    // The allowance is the authority; a count with it off is contradictory.
    if (data.plus_one === 0) data.plus_one_count = 0;

    if (has('custom_answers')) {
        data.custom_answers = picked.custom_answers && typeof picked.custom_answers === 'object'
            ? picked.custom_answers
            : null;
    }

    return data;
};

/**
 * One plan limit for a host, from the HOST's CURRENT plan.
 *
 * Read from the entitlement pointer (`website_clients`) first, then the latest
 * subscription row, then the event's own plan (§566). A plan that no longer
 * exists is skipped, never read as unlimited — production had a subscription
 * row pointing at a soft-deleted Free plan whose limit read as "no limit".
 *
 * `holder` needs `website_client_id` (and `subscription_plan_id` for the last
 * fallback). Pass a transaction to read inside it: a second lookup outside the
 * transaction returned the committed value and ignored a change made inside
 * (§571).
 */
const planLimitFor = async (holder, key, transaction) => {
    if (!subscriptionPlanService.LIMIT_KEYS.includes(key)) return null;

    const [host, sub] = await Promise.all([
        WebsiteClient.findByPk(holder.website_client_id, { attributes: ['id', 'subscription_plan_id'], transaction }),
        ClientSubscription.findOne({
            where: { website_client_id: holder.website_client_id },
            attributes: ['id', 'subscription_plan_id'],
            order: [['created_at', 'DESC']],
            transaction,
        }),
    ]);

    const candidates = [host?.subscription_plan_id, sub?.subscription_plan_id, holder.subscription_plan_id]
        .map(Number).filter(Boolean);
    for (const planId of candidates) {
        // Paranoid model: a soft-deleted plan comes back null and is skipped.
        const plan = await SubscriptionPlan.findByPk(planId, { attributes: ['id', key], transaction });
        if (!plan) continue;
        const n = Number(plan[key]);
        return Number.isInteger(n) && n > 0 ? n : null;
    }
    return null;
};

module.exports = {
    PERSON_FIELDS,
    ATTENDANCE_FIELDS,
    GENDERS,
    RSVP_STATUSES,
    RESPONSE_TYPES,
    INVITE_SOURCES,
    EMAIL,
    str,
    composeName,
    mobileKey,
    normalisePerson,
    normaliseAttendance,
    applyResponse,
    planLimitFor,
};
