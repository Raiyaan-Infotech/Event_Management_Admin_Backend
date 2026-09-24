const { Sequelize, Guest, GuestGroup } = require('../models');

const { Op } = Sequelize;

/**
 * CSV out — the phone-book export, and the sample template for the import.
 *
 * The phone book is `guests` (§581): people, not invitations. So the
 * columns are the person's, with no Event / RSVP / table columns — those are
 * answers about one event and belong to a participant (see the RSVP export).
 *
 * Same column order out and in, which is what makes "export, edit in Excel,
 * re-import" a safe round trip: the import reads every header written here.
 */

const COLUMNS = [
    ['First Name*', (c) => c.first_name || c.name],
    ['Last Name', (c) => c.last_name],
    ['Phone Number*', (c) => c.mobile],
    ['WhatsApp Number', (c) => c.whatsapp],
    ['Email', (c) => c.email],
    ['Guest Group', (c, ctx) => (c.group_id ? ctx.groupNames.get(c.group_id) ?? '' : '')],
    ['Title / Salutation', (c) => c.title],
    ['Company / Organization', (c) => c.company],
    ['Address Line 1', (c) => c.address_line1],
    ['Address Line 2', (c) => c.address_line2],
    ['City', (c) => c.city],
    ['State / Province', (c) => c.state],
    ['PIN / ZIP Code', (c) => c.postal_code],
    ['Country', (c) => c.country],
    ['Dietary Preference', (c) => c.dietary_preference],
    ['Special Requirements', (c) => c.special_requirements],
    ['Notes', (c) => c.notes],
];

/**
 * Quote one field.
 *
 * Everything is quoted — an unquoted `Chennai, Tamil Nadu` shifts every later
 * column by one. A leading tab guards values Excel would otherwise treat as a
 * formula or rewrite (`+919876543210` → `9.19877E+11`, the digits lost for
 * good), which is the most common way an exported guest list comes back
 * broken.
 */
const cell = (value) => {
    if (value === null || value === undefined) return '""';
    const text = String(value);
    const needsGuard = /^[+=\-@\t\r]/.test(text);
    return `"${(needsGuard ? `\t${text}` : text).replace(/"/g, '""')}"`;
};

const toCsv = (rows) => rows.map((row) => row.map(cell).join(',')).join('\r\n');

/**
 * Export the phone book. Same filters as the list screen, so what exports is
 * what is on screen.
 */
const exportGuests = async (clientId, query = {}) => {
    const where = { website_client_id: clientId };

    const tab = String(query.status || 'all').toLowerCase();
    if (tab === 'imported') where.source = 'import';

    const groupId = Number(query.group_id) || null;
    if (groupId) where.group_id = groupId;
    else if (String(query.group_id) === '0') where.group_id = null;

    const search = String(query.search || '').trim();
    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { mobile: { [Op.like]: `%${search}%` } },
            { company: { [Op.like]: `%${search}%` } },
        ];
    }

    const [guests, groups] = await Promise.all([
        Guest.findAll({ where, order: [['created_at', 'DESC'], ['id', 'DESC']] }),
        GuestGroup.findAll({ where: { website_client_id: clientId }, attributes: ['id', 'name'] }),
    ]);
    const ctx = { groupNames: new Map(groups.map((g) => [g.id, g.name])) };

    const rows = [COLUMNS.map(([header]) => header)];
    for (const guest of guests) rows.push(COLUMNS.map(([, read]) => read(guest, ctx)));

    return {
        filename: `guests-${new Date().toISOString().slice(0, 10)}.csv`,
        // A BOM, deliberately: without it Excel opens a UTF-8 CSV as the local
        // codepage and mangles every non-ASCII name. The import strips it.
        content: `﻿${toCsv(rows)}`,
        count: guests.length,
    };
};

/**
 * The "Download Sample CSV" link on the import screen — built from the same
 * COLUMNS, with the client's own first group, so it imports as-is.
 */
const sampleCsv = async (clientId) => {
    const group = await GuestGroup.findOne({
        where: { website_client_id: clientId },
        attributes: ['id', 'name'],
        order: [['id', 'ASC']],
    });
    const groupName = group?.name ?? 'Family';

    const sample = [
        {
            first_name: 'Amit', last_name: 'Sharma', mobile: '+919876543210', whatsapp: '+919876543210',
            email: 'amit.sharma@example.com', group: groupName, title: 'Mr.', company: '',
            address_line1: '12 Gandhi Street', address_line2: '', city: 'Chennai', state: 'Tamil Nadu',
            postal_code: '600001', country: 'India', dietary_preference: 'Vegetarian',
            special_requirements: 'Wheelchair access', notes: 'Close relative',
        },
        {
            first_name: 'Priya', last_name: 'Mehta', mobile: '+919812345678', whatsapp: '',
            email: '', group: groupName, title: 'Ms.', company: 'ABC Events',
            address_line1: '45 Rose Avenue', address_line2: 'Apt 2B', city: 'Bengaluru', state: 'Karnataka',
            postal_code: '560001', country: 'India', dietary_preference: 'Vegan',
            special_requirements: '', notes: 'College friend',
        },
    ];
    // Read through COLUMNS so the sample can never fall out of step with them.
    const ctx = { groupNames: new Map([[1, groupName]]) };
    const rows = [
        COLUMNS.map(([header]) => header),
        ...sample.map((s) => COLUMNS.map(([, read]) => read({ ...s, group_id: 1 }, ctx))),
    ];

    return {
        filename: 'guest-import-sample.csv',
        content: `﻿${toCsv(rows)}`,
    };
};

module.exports = { exportGuests, sampleCsv, COLUMNS };
