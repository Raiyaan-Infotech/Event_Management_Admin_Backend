const { ClientPreference, ClientNotificationPref, EmailConfig } = require('../models');
const ApiError = require('../utils/apiError');

/**
 * Settings Phase 2 — a client's own preferences, and what they agreed to be
 * notified about.
 *
 * ── THE CATALOGUE IS SERVED, NOT HARDCODED IN THE UI ────────────────────────
 * The list of notification types, their labels, their groups and their allowed
 * frequencies all come back from `getSettings`. The screen renders whatever it
 * is given. A list typed into a React component drifts from the list the server
 * validates against, and the failure is silent: the toggle saves nothing and
 * looks like it worked. Same reasoning as §316's `unavailable` block.
 *
 * ── ⚠ NOTHING IS DELIVERED YET, AND THE API SAYS SO ─────────────────────────
 * `email_configs` has no active row (no SMTP is configured anywhere in this
 * system), and this portal has no in-app notification feed — the header bell is
 * a hardcoded empty state, and `mail_notifications` belongs to `vendor_clients`,
 * the OLDER portal. So these preferences record CONSENT and drive no sending.
 *
 * That was a deliberate call: consent recorded now is already correct on the
 * day delivery is wired, and the alternative — no table — means whatever is
 * built later starts by emailing everybody. But a screen that hides it would be
 * the §321 mistake: somebody switches on "Account Security" alerts, believes
 * they will be warned, and nothing can send. So `deliveryState()` reports the
 * real state per channel WITH its reason, and the screens describe it from that
 * rather than from strings typed into a component. They unlock by themselves.
 *
 * ── WHAT IS NOT IN THE CATALOGUE, AND WHY ───────────────────────────────────
 * The supplied design listed types this system cannot ever raise:
 *
 *   Team Member Activity  — there are no team members (§323 refused the same
 *                           row on the pricing matrix)
 *   Guest Check-in        — `event_guests` has no check-in column; nothing
 *                           records one
 *   New Message / Reply   — messaging is paused (§222) and unbuilt
 *   Surveys & Feedback    — no survey feature exists anywhere
 *
 * A preference for an event that cannot occur is a switch wired to nothing. The
 * ones kept below all name something the system really does.
 */

/* ── Notification catalogue ──────────────────────────────────────────────── */

const EMAIL_FREQUENCIES = [
    { value: 'instant', label: 'Instant' },
    { value: 'daily_digest', label: 'Daily Digest' },
    { value: 'weekly_digest', label: 'Weekly Digest' },
];

/** A reminder is not sent at an interval, it is sent BEFORE something. */
const REMINDER_FREQUENCIES = [
    { value: '1h_before', label: '1 hour before' },
    { value: '24h_before', label: '24 hours before' },
    { value: '48h_before', label: '2 days before' },
    { value: '1w_before', label: '1 week before' },
];

const CATALOG = {
    email: [
        {
            group: 'Event Activity',
            types: [
                { type: 'new_rsvp', label: 'New RSVP', description: 'When someone responds to your event.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'instant' },
                { type: 'event_reminder', label: 'Event Reminder', description: 'A reminder before your event starts.', frequencies: REMINDER_FREQUENCIES, default_frequency: '24h_before' },
                { type: 'event_updates', label: 'Event Updates', description: 'When details of your event change.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'instant' },
            ],
        },
        {
            group: 'Guests',
            types: [
                { type: 'new_guest', label: 'New Guest Added', description: 'When a guest is added to your event.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'daily_digest' },
            ],
        },
        {
            group: 'Account & Billing',
            types: [
                { type: 'billing_payments', label: 'Billing & Payments', description: 'Invoices, payments and refunds.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'instant' },
                { type: 'plan_subscription', label: 'Plan & Subscription', description: 'Changes to your plan, renewals and cancellations.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'instant' },
                { type: 'account_security', label: 'Account Security', description: 'Password changes and account activity.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'instant' },
            ],
        },
        {
            group: 'From us',
            types: [
                // Consent flags. Worth recording BEFORE anything can send, which
                // is the whole point of a consent flag.
                { type: 'product_updates', label: 'Product Updates', description: 'New features and improvements.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'weekly_digest' },
                { type: 'marketing_tips', label: 'Offers & Tips', description: 'Occasional offers and tips for getting more from your events.', frequencies: EMAIL_FREQUENCIES, default_frequency: 'weekly_digest', default_enabled: false },
            ],
        },
    ],
    in_app: [
        {
            group: 'Events',
            types: [
                { type: 'event_created', label: 'Event Created', description: 'When a new event is created.' },
                { type: 'event_updated', label: 'Event Updated', description: 'When an event is changed.' },
                { type: 'event_reminder', label: 'Event Reminder', description: 'Before an event starts.', default_sound: true },
            ],
        },
        {
            group: 'Guests & RSVPs',
            types: [
                { type: 'new_rsvp', label: 'New RSVP', description: 'When someone responds to your event.', default_sound: true },
                { type: 'new_guest', label: 'New Guest Added', description: 'When a guest is added to your event.' },
                { type: 'rsvp_updated', label: 'RSVP Updated', description: 'When a guest changes their response.' },
            ],
        },
        {
            group: 'System & Account',
            types: [
                { type: 'system_announcements', label: 'System Announcements', description: 'Important updates about the platform.' },
                { type: 'account_alerts', label: 'Account Alerts', description: 'Security and account related alerts.', default_sound: true },
            ],
        },
    ],
};

/** Flattened once, for validation. */
const KNOWN = Object.fromEntries(
    Object.entries(CATALOG).map(([channel, groups]) => [
        channel,
        new Map(groups.flatMap((g) => g.types.map((t) => [t.type, t]))),
    ]),
);

const CHANNELS = Object.keys(CATALOG);

/* ── Preference options ──────────────────────────────────────────────────── */

/**
 * Everything the client may choose, and the ONLY values accepted. Served with
 * the settings so the dropdowns are built from the same list that validates
 * them — a `<Select>` offering a value the server rejects is a save that fails
 * for no reason the person can see.
 */
const OPTIONS = {
    /*
      ⚠ ONE language. The `languages` table holds exactly one active row
      (English). Offering more here would be offering translations that do not
      exist; the list grows on its own when that table does.
    */
    language_code: [{ value: 'en', label: 'English' }],
    date_format: [
        { value: 'DD/MM/YYYY', label: '31/12/2026 (DD/MM/YYYY)' },
        { value: 'MM/DD/YYYY', label: '12/31/2026 (MM/DD/YYYY)' },
        { value: 'YYYY-MM-DD', label: '2026-12-31 (YYYY-MM-DD)' },
        { value: 'DD MMM YYYY', label: '31 Dec 2026' },
        { value: 'MMM DD, YYYY', label: 'Dec 31, 2026' },
    ],
    theme: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
    ],
    /*
      Real routes only. The design offered "My Events" and similar; a landing
      page pointing at a route that does not exist lands on the catch-all, and
      the client cannot tell that from a broken portal.
    */
    default_landing: [
        { value: 'dashboard', label: 'Dashboard', path: '/dashboard' },
        { value: 'events', label: 'My Events', path: '/dashboard/events' },
        { value: 'guests', label: 'Guests', path: '/dashboard/guests' },
        { value: 'templates', label: 'Templates', path: '/dashboard/templates' },
    ],
    items_per_page: [
        { value: 10, label: '10' },
        { value: 20, label: '20' },
        { value: 50, label: '50' },
        { value: 100, label: '100' },
    ],
};

/**
 * ⚠ Which preferences actually CHANGE something today.
 *
 * Reported as data so the screen can mark the rest "saved, not yet applied"
 * without any component hardcoding the list. When one gets wired, flip it here
 * and the UI follows — nobody has to remember which files to revisit.
 *
 * `date_format` and `time_zone` are applied by the portal's shared formatter,
 * `theme` by next-themes. The rest are recorded and not yet read.
 *
 * ⚠ `default_landing` is deliberately false. This portal has NO login of its
 * own — the client signs in on the tenant's website and arrives with a cookie
 * already set — so there is no "just signed in" moment to redirect from.
 * Applying it on every visit to /dashboard instead would mean a client who
 * chose "My Events" could never open their dashboard again.
 */
const APPLIED = {
    language_code: false,
    date_format: true,
    time_zone: true,
    theme: true,
    default_landing: false,
    items_per_page: false,
    compact_mode: false,
    auto_save: false,
    show_tips: false,
};

/**
 * The whitelist. Anything not named here is dropped, so a client cannot patch
 * `website_client_id` and move their preferences onto somebody else's account.
 * Same shape as STAFF_EDITABLE_FIELDS and CLIENT_EDITABLE_FIELDS.
 */
const EDITABLE = [
    'language_code', 'date_format', 'time_zone', 'theme', 'default_landing',
    'items_per_page', 'compact_mode', 'auto_save', 'show_tips',
    'emails_disabled', 'in_app_disabled', 'dnd_starts_at', 'dnd_ends_at',
];

const BOOLEANS = new Set([
    'compact_mode', 'auto_save', 'show_tips', 'emails_disabled', 'in_app_disabled',
]);

/* ── Delivery state ──────────────────────────────────────────────────────── */

/**
 * Can this channel actually deliver anything?
 *
 * Read from the DATABASE, not from a constant, so email switches itself on the
 * moment somebody configures a provider. `PAYMENTS_ENABLED` in
 * clientInvoice.service.js is the same idea; this one needs no flag at all
 * because the answer is a row that either exists or does not.
 */
async function deliveryState(companyId) {
    const emailConfigs = await EmailConfig.count({
        where: { is_active: 1, ...(companyId ? { company_id: companyId } : {}) },
    });

    return {
        email: {
            enabled: emailConfigs > 0,
            reason: emailConfigs > 0
                ? null
                : 'No email provider is configured yet, so nothing is sent by email. Your choices are saved and will be used as soon as one is.',
        },
        in_app: {
            // Hardcoded false, and honestly: unlike email there is no row to
            // count. Building the feed is what flips this, and the one line to
            // change is right here.
            enabled: false,
            reason: 'In-app notifications are not delivered yet — there is no notification feed in this portal. Your choices are saved and will be used as soon as there is.',
        },
    };
}

/* ── Reads ───────────────────────────────────────────────────────────────── */

/**
 * The client's preference row, created with defaults on first read.
 *
 * `findOrCreate` rather than find-then-create: two requests arriving together
 * (the portal loads Settings and the header at once) would both see nothing and
 * both insert. The unique index would reject the second, and the client would
 * see a 500 on a page that only reads.
 */
async function ensurePreferences(clientId) {
    const [row] = await ClientPreference.findOrCreate({
        where: { website_client_id: clientId },
        defaults: { website_client_id: clientId },
    });
    return row;
}

/**
 * Every catalogue entry, carrying the client's stored choice where they have
 * made one and the catalogue's default where they have not.
 *
 * ── WHY DEFAULTS ARE NOT WRITTEN AS ROWS ON FIRST READ ──────────────────────
 * Seeding a row per type per client would mean 16 inserts for somebody who has
 * never opened the screen, and — worse — it FREEZES today's defaults. Changing
 * a default later would then reach only clients created after the change, and
 * the two groups would silently diverge. Absent means "has not chosen", so a
 * default stays a default until they say otherwise.
 */
function mergeCatalog(channel, rows) {
    const stored = new Map(rows.filter((r) => r.channel === channel).map((r) => [r.type, r]));

    return CATALOG[channel].map((group) => ({
        group: group.group,
        types: group.types.map((t) => {
            const row = stored.get(t.type);
            return {
                type: t.type,
                label: t.label,
                description: t.description,
                ...(t.frequencies ? { frequencies: t.frequencies } : {}),
                enabled: row ? Boolean(row.enabled) : (t.default_enabled ?? true),
                ...(channel === 'email'
                    ? { frequency: row?.frequency ?? t.default_frequency ?? 'instant' }
                    : { sound: row ? Boolean(row.sound) : (t.default_sound ?? false) }),
                // True once the client has actually touched it — lets the UI
                // distinguish "off because they chose off" from "off by default".
                is_set: Boolean(row),
            };
        }),
    }));
}

/**
 * What a preference is when nobody has chosen.
 *
 * Read off the MODEL, not typed out again here — the column defaults are what
 * a new row actually gets, so "Reset to Defaults" and a brand-new account land
 * in the same place. Typing the list twice is how the two quietly diverge.
 */
function defaultPreferences() {
    const attrs = ClientPreference.rawAttributes;
    return Object.fromEntries(
        EDITABLE
            .filter((key) => attrs[key] && 'defaultValue' in attrs[key])
            .map((key) => [key, attrs[key].defaultValue]),
    );
}

const getSettings = async (client) => {
    const clientId = client.id;
    const [prefs, rows, delivery] = await Promise.all([
        ensurePreferences(clientId),
        ClientNotificationPref.findAll({ where: { website_client_id: clientId } }),
        deliveryState(client.company_id),
    ]);

    return {
        preferences: prefs.toJSON(),
        notifications: {
            email: mergeCatalog('email', rows),
            in_app: mergeCatalog('in_app', rows),
        },
        options: OPTIONS,
        applied: APPLIED,
        // So "Reset to Defaults" restores what the database would give a new
        // row, rather than what a component believes the defaults are.
        defaults: defaultPreferences(),
        delivery,
        /*
          Whether Do Not Disturb is quiet RIGHT NOW, computed here rather than
          in the UI. The window is stored; deciding "is it active" from two
          timestamps in three different screens is three chances to decide it
          differently.
        */
        dnd_active: isDndActive(prefs),
    };
};

function isDndActive(prefs) {
    if (!prefs.dnd_ends_at) return false;
    const now = Date.now();
    const start = prefs.dnd_starts_at ? new Date(prefs.dnd_starts_at).getTime() : -Infinity;
    return start <= now && now < new Date(prefs.dnd_ends_at).getTime();
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

/** Every option list is `{value,label}`; this is the membership test for one. */
const allows = (key, value) =>
    OPTIONS[key].some((o) => String(o.value) === String(value));

const updatePreferences = async (client, body = {}) => {
    const patch = {};

    for (const key of EDITABLE) {
        if (!(key in body)) continue;
        const value = body[key];

        if (BOOLEANS.has(key)) {
            patch[key] = value === true || value === 1 || value === '1' || value === 'true';
            continue;
        }

        if (key === 'dnd_starts_at' || key === 'dnd_ends_at') {
            if (value === null || value === '') { patch[key] = null; continue; }
            const at = new Date(value);
            if (Number.isNaN(at.getTime())) {
                throw ApiError.badRequest('That Do Not Disturb time is not a valid date.');
            }
            patch[key] = at;
            continue;
        }

        if (!allows(key, value)) {
            // Names the field AND what was sent. "Invalid value" on a screen
            // with nine dropdowns is a message that cannot be acted on.
            throw ApiError.badRequest(`"${value}" is not an accepted value for ${key}.`);
        }
        patch[key] = key === 'items_per_page' ? Number(value) : value;
    }

    if (!Object.keys(patch).length) {
        throw ApiError.badRequest('There is nothing to update.');
    }

    /*
      A DND window that ends before it starts would make isDndActive() answer
      false forever — quiet hours that are never quiet. Checked against the
      MERGED values, not just the patch, because either end can arrive alone.
    */
    const prefs = await ensurePreferences(client.id);
    const starts = 'dnd_starts_at' in patch ? patch.dnd_starts_at : prefs.dnd_starts_at;
    const ends = 'dnd_ends_at' in patch ? patch.dnd_ends_at : prefs.dnd_ends_at;
    if (starts && ends && new Date(ends) <= new Date(starts)) {
        throw ApiError.badRequest('Do Not Disturb must end after it starts.');
    }

    await prefs.update(patch);
    return getSettings(client);
};

/**
 * Save notification choices — one or many, in a single call.
 *
 * Sent as a batch because the screen has sixteen switches and a request per
 * flick is sixteen chances to end up half-saved. Each is upserted on its
 * `(client, channel, type)` slot, so saving twice is not two rows.
 */
const updateNotifications = async (client, body = {}) => {
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length) {
        throw ApiError.badRequest('No notification settings were sent.');
    }

    for (const item of items) {
        const { channel, type } = item || {};
        if (!CHANNELS.includes(channel)) {
            throw ApiError.badRequest(`"${channel}" is not a notification channel.`);
        }
        const known = KNOWN[channel].get(type);
        if (!known) {
            // Rejected rather than stored. An unknown type stored is a row
            // nothing will ever read, sitting in the table looking meaningful.
            throw ApiError.badRequest(`"${type}" is not a ${channel} notification in this system.`);
        }

        const values = {
            website_client_id: client.id,
            channel,
            type,
            enabled: item.enabled === undefined ? true : Boolean(item.enabled),
            frequency: null,
            sound: null,
        };

        if (channel === 'email') {
            const freq = item.frequency ?? known.default_frequency ?? 'instant';
            const allowedFreqs = known.frequencies || EMAIL_FREQUENCIES;
            if (!allowedFreqs.some((f) => f.value === freq)) {
                throw ApiError.badRequest(`"${freq}" is not an accepted frequency for ${type}.`);
            }
            values.frequency = freq;
        } else {
            values.sound = item.sound === undefined
                ? Boolean(known.default_sound)
                : Boolean(item.sound);
        }

        const existing = await ClientNotificationPref.findOne({
            where: { website_client_id: client.id, channel, type },
        });
        if (existing) await existing.update(values);
        else await ClientNotificationPref.create(values);
    }

    return getSettings(client);
};

module.exports = {
    getSettings,
    updatePreferences,
    updateNotifications,
    // Exported for the tests, and for whatever wires delivery later — the
    // catalogue is the contract between this service and the sender.
    CATALOG,
    OPTIONS,
    APPLIED,
    defaultPreferences,
    deliveryState,
    isDndActive,
};
