const { Event, EventGuest, EventGuestGroup } = require('../models');

/**
 * CSV out — the export, and the sample template.
 *
 * ── THE POINT OF THIS FILE ───────────────────────────────────────────────────
 * It closes the loop the import opened. The supplied sample names its event as
 * TEXT (`Event Name*`), which is friendly to type and ambiguous to resolve: a
 * typo has nowhere to go, and two events sharing a name cannot be told apart.
 *
 * The fix is not to drop the name column — nobody can hand-type ids — it is to
 * ADD an `Event ID` column that the export fills in and the import prefers:
 *
 *   export  writes both Event ID and Event Name
 *   import  uses Event ID when present, falls back to the name, and reports
 *           anything it cannot resolve
 *
 * So a file that came OUT of here goes back IN exactly, while a hand-made file
 * still works on names alone. Same column order in both directions, which is
 * what makes "export, edit in Excel, re-import" a safe round trip.
 */

/** The column order. `Event ID` first among the event pair — it is the authority. */
const COLUMNS = [
    ['First Name*', (g) => g.first_name || g.name],
    ['Last Name', (g) => g.last_name],
    ['Email*', (g) => g.email],
    ['Phone Number', (g) => g.mobile],
    ['WhatsApp Number', (g) => g.whatsapp],
    // Written by the export, optional on the way in. This is the fix.
    ['Event ID', (g) => g.event_id],
    ['Event Name*', (g, ctx) => ctx.eventNames.get(g.event_id) ?? ''],
    ['Guest Group', (g, ctx) => (g.group_id ? ctx.groupNames.get(g.group_id) ?? '' : '')],
    ['RSVP Status', (g) => STATUS_OUT[g.rsvp_status] ?? ''],
    ['Response Type', (g) => RESPONSE_OUT[g.response_type] ?? ''],
    ['Plus One Allowed', (g) => (g.plus_one ? 'Yes' : 'No')],
    ['Plus One Count', (g) => g.plus_one_count || 0],
    ['Company / Organization', (g) => g.company],
    ['Title / Salutation', (g) => g.title],
    ['Address Line 1', (g) => g.address_line1],
    ['Address Line 2', (g) => g.address_line2],
    ['City', (g) => g.city],
    ['State / Province', (g) => g.state],
    ['PIN / ZIP Code', (g) => g.postal_code],
    ['Country', (g) => g.country],
    ['Dietary Preference', (g) => g.dietary_preference],
    ['Special Requirements', (g) => g.special_requirements],
    ['Notes', (g) => g.notes],
];

/** Stored value -> the word the CSV uses. The import maps them back. */
const STATUS_OUT = {
    not_responded: 'Not Responded',
    invited: 'Invited',
    pending: 'Pending',
    accepted: 'Accepted',
    declined: 'Declined',
};

const RESPONSE_OUT = { none: '', yes: 'Yes', no: 'No', maybe: 'Maybe' };

/**
 * Quote one field.
 *
 * Everything is quoted, not just fields that look dangerous — an unquoted
 * `Chennai, Tamil Nadu` shifts every later column by one, and deciding
 * case-by-case is how that bug gets in.
 *
 * The leading apostrophe on phone-like values is deliberate: without it Excel
 * reads `+919876543210` as a formula-ish number and rewrites it to
 * `9.19877E+11`, losing the digits for good. That is the single most common way
 * an exported contact list comes back broken.
 */
const cell = (value) => {
    if (value === null || value === undefined) return '""';
    const text = String(value);
    const needsGuard = /^[+=\-@\t\r]/.test(text);
    return `"${(needsGuard ? `\t${text}` : text).replace(/"/g, '""')}"`;
};

const toCsv = (rows) => rows.map((row) => row.map(cell).join(',')).join('\r\n');

/**
 * Export a client's guests.
 *
 * Same filters as the list screen, so what exports is what is on screen — an
 * export that ignores the active filter is a different bug report every time.
 */
const exportGuests = async (clientId, query = {}) => {
    const { Op } = require('sequelize');

    const where = { website_client_id: clientId };
    const eventId = Number(query.event_id) || null;
    if (eventId) where.event_id = eventId;

    const tab = String(query.status || 'all').toLowerCase();
    if (tab === 'imported') where.invite_source = 'import';
    else if (tab === 'not_responded') where.rsvp_status = { [Op.in]: ['not_responded', 'invited'] };
    else if (['invited', 'pending', 'accepted', 'declined'].includes(tab)) where.rsvp_status = tab;

    const groupId = Number(query.group_id) || null;
    if (groupId) where.group_id = groupId;
    else if (String(query.group_id) === '0') where.group_id = null;

    const search = String(query.search || '').trim();
    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { company: { [Op.like]: `%${search}%` } },
        ];
    }

    const [guests, events, groups] = await Promise.all([
        EventGuest.findAll({ where, order: [['created_at', 'DESC'], ['id', 'DESC']] }),
        Event.findAll({ where: { website_client_id: clientId }, attributes: ['id', 'name'] }),
        EventGuestGroup.findAll({ where: { website_client_id: clientId }, attributes: ['id', 'name'] }),
    ]);

    const ctx = {
        eventNames: new Map(events.map((e) => [e.id, e.name])),
        groupNames: new Map(groups.map((g) => [g.id, g.name])),
    };

    const rows = [COLUMNS.map(([header]) => header)];
    for (const guest of guests) {
        rows.push(COLUMNS.map(([, read]) => read(guest, ctx)));
    }

    return {
        filename: `guests-${new Date().toISOString().slice(0, 10)}.csv`,
        // A BOM, deliberately: without it Excel opens a UTF-8 CSV as the local
        // codepage and mangles every non-ASCII name. The import strips it.
        content: `﻿${toCsv(rows)}`,
        count: guests.length,
    };
};

/**
 * The "Download Sample CSV" link on the import screen.
 *
 * Built from the client's OWN first event, so the example row is immediately
 * importable rather than referring to an event they do not have — which is the
 * fastest way to teach the Event ID / Event Name pairing without a manual.
 */
const sampleCsv = async (clientId) => {
    const [event, group] = await Promise.all([
        Event.findOne({
            where: { website_client_id: clientId },
            attributes: ['id', 'name'],
            order: [['id', 'ASC']],
        }),
        EventGuestGroup.findOne({
            where: { website_client_id: clientId },
            attributes: ['id', 'name'],
            order: [['id', 'ASC']],
        }),
    ]);

    const eventId = event?.id ?? '';
    const eventName = event?.name ?? 'Your Event Name';
    const groupName = group?.name ?? 'Family';

    const rows = [
        COLUMNS.map(([header]) => header),
        [
            'Amit', 'Sharma', 'amit.sharma@example.com', '+919876543210', '+919876543210',
            eventId, eventName, groupName, 'Accepted', 'Yes', 'Yes', 1,
            '', 'Mr.', '12 Gandhi Street', '', 'Chennai', 'Tamil Nadu', '600001', 'India',
            'Vegetarian', 'Wheelchair access', 'Close relative',
        ],
        [
            'Priya', 'Mehta', 'priya.mehta@example.com', '+919812345678', '',
            eventId, eventName, groupName, 'Invited', '', 'No', 0,
            'ABC Events', 'Ms.', '45 Rose Avenue', 'Apt 2B', 'Bengaluru', 'Karnataka', '560001', 'India',
            'Vegan', '', 'College friend',
        ],
    ];

    return {
        filename: 'guest-import-sample.csv',
        content: `﻿${toCsv(rows)}`,
    };
};

module.exports = { exportGuests, sampleCsv, COLUMNS, STATUS_OUT, RESPONSE_OUT };
