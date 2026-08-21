const { sequelize, Event, EventGuest, EventGuestGroup } = require('../models');
const ApiError = require('../utils/apiError');
const guestService = require('./clientGuest.service');

/**
 * CSV guest import — the four-step wizard.
 *
 * ── HOW A ROW FINDS ITS EVENT ────────────────────────────────────────────────
 * The sample CSV names the event as TEXT (`Event Name*`), not an id. The
 * industry-standard resolution, and what this does:
 *
 *   1. `Event ID` column, if present and it belongs to this client  <- wins
 *   2. otherwise an exact, case-insensitive match on `Event Name`
 *   3. otherwise the event chosen on the upload step
 *   4. otherwise the row is REPORTED, never guessed
 *
 * An `Event ID` column is included in the EXPORT so a re-import round-trips
 * exactly, while a hand-made file can leave it out and be matched by name. That
 * is the pattern Mailchimp/HubSpot-style importers use, and it is why the name
 * column stays: nobody can hand-type ids.
 *
 * **A non-matching name never creates an event.** A typo would otherwise spawn
 * a junk event that then shows up in My Events, the dashboard and Analytics.
 * Two events sharing a name is reported as ambiguous rather than resolved
 * arbitrarily.
 *
 * ── WHAT ACTUALLY BREAKS CSV IMPORTS ─────────────────────────────────────────
 * Every one of these is handled below, because every one of them is common:
 *
 *   BOM            Excel writes UTF-8 with a BOM, so the first header arrives as
 *                  "﻿First Name*" and column one never matches anything.
 *   delimiter      Some locales export with ';' — detected, not assumed.
 *   quoted commas  "Chennai, Tamil Nadu" and newlines inside Notes.
 *   phone mangling Excel turns +919876543210 into 9.19877E+11 and eats the '+'.
 *   header drift   "First Name*" / "first_name" / "FIRST NAME" all mean one thing.
 *   blank rows     Excel appends empties; they are not errors, they are nothing.
 *   in-file dupes  two rows with the same email, before the DB is even consulted.
 *   partial fail   row 7 being bad must not roll back rows 1-6 the user wanted.
 */

const MAX_ROWS = 5000;
const MAX_BYTES = 10 * 1024 * 1024; // matches the design's "Maximum file size: 10 MB"

/** Canonical field -> the header spellings that mean it. */
const HEADER_MAP = {
    first_name: ['first name', 'firstname', 'first_name', 'given name'],
    last_name: ['last name', 'lastname', 'last_name', 'surname', 'family name'],
    email: ['email', 'email address', 'e-mail', 'mail'],
    mobile: ['phone number', 'phone', 'mobile', 'mobile number', 'contact'],
    whatsapp: ['whatsapp number', 'whatsapp', 'whats app number'],
    event_name: ['event name', 'event'],
    event_id: ['event id', 'event_id'],
    group_name: ['guest group', 'group', 'group name'],
    rsvp_status: ['rsvp status', 'status', 'rsvp'],
    response_type: ['response type', 'response'],
    plus_one: ['plus one allowed', 'plus one', 'plusone'],
    plus_one_count: ['plus one count', 'plusone count'],
    company: ['company / organization', 'company', 'organization', 'organisation'],
    title: ['title / salutation', 'title', 'salutation'],
    address_line1: ['address line 1', 'address1', 'address'],
    address_line2: ['address line 2', 'address2'],
    city: ['city', 'town'],
    state: ['state / province', 'state', 'province'],
    postal_code: ['pin / zip code', 'pin', 'zip', 'zip code', 'postal code', 'pincode'],
    country: ['country'],
    dietary_preference: ['dietary preference', 'dietary preferences', 'diet'],
    special_requirements: ['special requirements', 'special requirement', 'requirements'],
    notes: ['notes', 'note', 'remarks'],
    table_number: ['table number', 'table'],
};

const REQUIRED = ['first_name', 'email'];

/** Strip the trailing '*', lowercase, collapse whitespace, drop the BOM. */
const normaliseHeader = (raw) =>
    String(raw ?? '')
        .replace(/^﻿/, '')
        .replace(/\*+$/, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

/** Which canonical field a header means, or null. */
const matchHeader = (raw) => {
    const key = normaliseHeader(raw);
    if (!key) return null;
    for (const [field, spellings] of Object.entries(HEADER_MAP)) {
        if (spellings.includes(key)) return field;
    }
    // Fall back to an exact snake_case match so an export re-imports cleanly.
    const snake = key.replace(/[^a-z0-9]+/g, '_');
    return Object.prototype.hasOwnProperty.call(HEADER_MAP, snake) ? snake : null;
};

/**
 * Split one CSV line, respecting quotes.
 *
 * Hand-rolled rather than a dependency: this backend ships no CSV parser, the
 * grammar is small, and the two things that actually matter are quoted commas
 * and doubled quotes inside a quoted field.
 */
const splitLine = (line, delimiter) => {
    const out = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (quoted) {
            if (ch === '"') {
                // "" inside a quoted field is a literal quote, not the end.
                if (line[i + 1] === '"') { field += '"'; i += 1; }
                else quoted = false;
            } else field += ch;
            continue;
        }

        if (ch === '"') quoted = true;
        else if (ch === delimiter) { out.push(field); field = ''; }
        else field += ch;
    }
    out.push(field);
    return out.map((f) => f.trim());
};

/**
 * Split the whole file into rows, keeping newlines that sit inside quotes.
 *
 * A Notes field with a line break would otherwise become two broken rows — and
 * a spreadsheet will happily produce one.
 */
const splitRows = (text) => {
    const rows = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') { current += '""'; i += 1; continue; }
            quoted = !quoted;
            current += ch;
            continue;
        }
        if (!quoted && (ch === '\n' || ch === '\r')) {
            if (ch === '\r' && text[i + 1] === '\n') i += 1;
            rows.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current) rows.push(current);
    return rows;
};

/** Comma or semicolon — detected from the header line, never assumed. */
const detectDelimiter = (headerLine) => {
    const commas = (headerLine.match(/,/g) || []).length;
    const semis = (headerLine.match(/;/g) || []).length;
    return semis > commas ? ';' : ',';
};

/**
 * Undo Excel's phone mangling as far as it can be undone.
 *
 * `+919876543210` becomes `9.19877E+11` once Excel decides it is a number, and
 * that is lossy — the digits are gone, not hidden. Detected and reported rather
 * than silently imported as a wrong number.
 */
const cleanPhone = (raw) => {
    const value = String(raw ?? '').trim();
    if (!value) return { value: null };
    if (/e\+?\d+$/i.test(value.replace(/\s/g, ''))) {
        return { value: null, error: 'Phone looks like it was converted to a number by a spreadsheet (e.g. 9.19877E+11). Format the column as Text and export again.' };
    }
    const cleaned = value.replace(/[^\d+]/g, '');
    if (cleaned.replace(/\D/g, '').length < 5) return { value: null, error: 'Phone number is too short.' };
    return { value: cleaned.slice(0, 20) };
};

const YES = new Set(['yes', 'y', 'true', '1', 'allowed']);
const NO = new Set(['no', 'n', 'false', '0', '']);

const parseBool = (raw) => {
    const value = String(raw ?? '').trim().toLowerCase();
    if (YES.has(value)) return 1;
    if (NO.has(value)) return 0;
    return null;
};

/** The CSV's words for status, mapped to what the column stores. */
const STATUS_WORDS = {
    accepted: 'accepted', attending: 'accepted', going: 'accepted', yes: 'accepted',
    declined: 'declined', 'not attending': 'declined', no: 'declined',
    pending: 'pending', maybe: 'pending',
    invited: 'invited', sent: 'invited',
    'not responded': 'not_responded', '': 'not_responded', 'no response': 'not_responded',
};

const RESPONSE_WORDS = {
    yes: 'yes', y: 'yes', attending: 'yes',
    no: 'no', n: 'no', declined: 'no',
    maybe: 'maybe', pending: 'maybe',
    '': 'none',
};

/**
 * Parse and validate, WITHOUT writing anything.
 *
 * This is steps 2 and 3 of the wizard — Map Fields and Review & Preview. The
 * caller sees exactly what would be created, and which rows would be refused
 * and why, before anything touches the database.
 */
const analyse = async (clientId, { content, defaultEventId = null }) => {
    if (typeof content !== 'string' || !content.trim()) {
        throw ApiError.badRequest('The file is empty.');
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
        throw ApiError.badRequest('That file is larger than 10 MB.');
    }

    const lines = splitRows(content).filter((l) => l.trim() !== '');
    if (lines.length < 2) {
        throw ApiError.badRequest('The file has a header but no rows.');
    }

    const delimiter = detectDelimiter(lines[0]);
    const rawHeaders = splitLine(lines[0], delimiter);

    // The mapping the wizard's step 2 displays, including what it could not
    // place — an unrecognised column is worth showing, not silently dropping.
    const mapping = rawHeaders.map((header, index) => ({
        index,
        header: String(header ?? '').replace(/^﻿/, ''),
        field: matchHeader(header),
    }));

    const found = new Set(mapping.map((m) => m.field).filter(Boolean));
    const missing = REQUIRED.filter((f) => !found.has(f));
    if (missing.length) {
        throw ApiError.badRequest(
            `The file is missing required column(s): ${missing.map((m) => m.replace('_', ' ')).join(', ')}.`
        );
    }

    // Everything needed to resolve names to ids, read once.
    const [events, groups] = await Promise.all([
        Event.findAll({
            where: { website_client_id: clientId },
            attributes: ['id', 'name'],
        }),
        EventGuestGroup.findAll({
            where: { website_client_id: clientId },
            attributes: ['id', 'name'],
        }),
    ]);

    const eventsByName = new Map();
    for (const event of events) {
        const key = event.name.trim().toLowerCase();
        // Keep a list, not the last one — two events sharing a name has to be
        // reported as ambiguous, and that is only knowable if both are kept.
        if (!eventsByName.has(key)) eventsByName.set(key, []);
        eventsByName.get(key).push(event);
    }
    const eventIds = new Set(events.map((e) => e.id));
    const groupsByName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g]));

    const existing = await EventGuest.findAll({
        where: { website_client_id: clientId },
        attributes: ['event_id', 'email'],
    });
    const alreadyThere = new Set(existing.map((g) => `${g.event_id}::${(g.email || '').toLowerCase()}`));

    const valid = [];
    const errors = [];
    const skipped = [];
    const seenInFile = new Set();
    const newGroups = new Set();

    const dataLines = lines.slice(1);
    if (dataLines.length > MAX_ROWS) {
        throw ApiError.badRequest(`That file has ${dataLines.length} rows. The limit is ${MAX_ROWS}.`);
    }

    dataLines.forEach((line, i) => {
        // +2: humans count from 1 and row 1 is the header, so this is the row
        // number they will see in their spreadsheet.
        const rowNumber = i + 2;
        const cells = splitLine(line, delimiter);

        const get = (field) => {
            const col = mapping.find((m) => m.field === field);
            return col ? (cells[col.index] ?? '') : '';
        };

        const firstName = get('first_name').trim();
        const email = get('email').trim().toLowerCase();

        if (!firstName && !email) return; // a blank trailing row is nothing, not an error

        const rowErrors = [];
        if (!firstName) rowErrors.push('First name is required.');
        if (!email) rowErrors.push('Email is required.');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) rowErrors.push('Email is not valid.');

        // ── Resolve the event ──────────────────────────────────────────────
        let eventId = null;
        const rawEventId = Number(get('event_id'));
        const eventName = get('event_name').trim();

        if (rawEventId && eventIds.has(rawEventId)) {
            eventId = rawEventId;
        } else if (eventName) {
            const matches = eventsByName.get(eventName.toLowerCase()) ?? [];
            if (matches.length === 1) eventId = matches[0].id;
            else if (matches.length > 1) {
                rowErrors.push(`You have ${matches.length} events called "${eventName}". Add an Event ID column to say which.`);
            } else {
                rowErrors.push(`No event called "${eventName}". Create it first, or correct the spelling.`);
            }
        } else if (defaultEventId) {
            eventId = defaultEventId;
        } else {
            rowErrors.push('No event given, and no event was chosen for this import.');
        }

        // ── Phones ─────────────────────────────────────────────────────────
        const mobile = cleanPhone(get('mobile'));
        const whatsapp = cleanPhone(get('whatsapp'));
        if (mobile.error) rowErrors.push(mobile.error);
        if (whatsapp.error) rowErrors.push(whatsapp.error);

        if (rowErrors.length) {
            errors.push({ row: rowNumber, name: firstName || email || `Row ${rowNumber}`, errors: rowErrors });
            return;
        }

        // ── Duplicates ─────────────────────────────────────────────────────
        const key = `${eventId}::${email}`;
        if (seenInFile.has(key)) {
            skipped.push({ row: rowNumber, name: firstName, email, reason: 'Duplicate of an earlier row in this file.' });
            return;
        }
        if (alreadyThere.has(key)) {
            // The design's own guideline: "Duplicate email addresses will be skipped."
            skipped.push({ row: rowNumber, name: firstName, email, reason: 'Already on this event’s guest list.' });
            return;
        }
        seenInFile.add(key);

        // ── Group: matched by name, created only if the caller opts in ─────
        const groupName = get('group_name').trim();
        let groupId = null;
        if (groupName) {
            const group = groupsByName.get(groupName.toLowerCase());
            if (group) groupId = group.id;
            else newGroups.add(groupName);
        }

        const statusWord = get('rsvp_status').trim().toLowerCase();
        const responseWord = get('response_type').trim().toLowerCase();
        const plusOne = parseBool(get('plus_one')) ?? 0;
        const plusCount = Number(get('plus_one_count')) || 0;

        valid.push({
            row: rowNumber,
            event_id: eventId,
            group_id: groupId,
            group_name: groupId ? null : (groupName || null),
            title: get('title').trim().slice(0, 30) || null,
            first_name: firstName.slice(0, 100),
            last_name: get('last_name').trim().slice(0, 100) || null,
            name: guestService.composeName(firstName, get('last_name').trim(), firstName),
            email,
            dial_code: '+91',
            mobile: mobile.value,
            whatsapp: whatsapp.value,
            company: get('company').trim().slice(0, 200) || null,
            table_number: get('table_number').trim().slice(0, 30) || null,
            rsvp_status: STATUS_WORDS[statusWord] ?? 'not_responded',
            response_type: RESPONSE_WORDS[responseWord] ?? 'none',
            invite_source: 'import',
            address_line1: get('address_line1').trim().slice(0, 255) || null,
            address_line2: get('address_line2').trim().slice(0, 255) || null,
            city: get('city').trim().slice(0, 120) || null,
            state: get('state').trim().slice(0, 120) || null,
            postal_code: get('postal_code').trim().slice(0, 20) || null,
            country: get('country').trim().slice(0, 100) || 'India',
            dietary_preference: get('dietary_preference').trim().slice(0, 255) || null,
            special_requirements: get('special_requirements').trim().slice(0, 500) || null,
            plus_one: plusOne,
            plus_one_count: plusOne ? Math.min(20, Math.max(0, plusCount)) : 0,
            notes: get('notes').trim().slice(0, 500) || null,
        });
    });

    return {
        delimiter,
        mapping,
        unmapped: mapping.filter((m) => !m.field).map((m) => m.header),
        total_rows: dataLines.length,
        valid,
        skipped,
        errors,
        new_groups: [...newGroups],
    };
};

/**
 * Steps 2 and 3 of the wizard — Map Fields and Review & Preview.
 *
 * The same analysis, capped for the wire. A 5000-row file must not put 5000
 * rows through JSON and into the browser just to show a preview table.
 */
const parseCsv = async (clientId, options) => {
    const result = await analyse(clientId, options);
    return {
        delimiter: result.delimiter,
        mapping: result.mapping,
        unmapped: result.unmapped,
        total_rows: result.total_rows,
        // The Review step's three numbers, counted over EVERYTHING.
        valid_count: result.valid.length,
        skipped_count: result.skipped.length,
        error_count: result.errors.length,
        new_groups: result.new_groups,
        // Samples, clearly capped.
        preview: result.valid.slice(0, 20),
        skipped: result.skipped.slice(0, 50),
        errors: result.errors.slice(0, 50),
    };
};

/**
 * Step 4 — write the valid rows.
 *
 * Re-parses rather than trusting a payload echoed back from the browser: the
 * preview is a display, and accepting rows straight from the client would let a
 * crafted request file guests against another account's event.
 *
 * Rows that failed validation are NOT imported and are NOT a reason to refuse
 * the rest. A file of 500 with three bad rows imports 497 — rolling all of it
 * back because of row 7 is the behaviour people hate most about importers.
 */
/**
 * Step 4 — write the valid rows.
 *
 * Re-analyses the file rather than trusting rows echoed back from the browser:
 * the preview is a display, and accepting rows straight from the client would
 * let a crafted request file guests against another account's event.
 *
 * Rows that failed validation are NOT imported and are NOT a reason to refuse
 * the rest. A file of 500 with three bad rows imports 497 — rolling all of it
 * back because of row 7 is the behaviour people hate most about importers.
 */
const commitImport = async (clientId, companyId, { content, defaultEventId = null, createGroups = false }) => {
    const result = await analyse(clientId, { content, defaultEventId });
    const rows = result.valid;

    const outcome = {
        imported: 0,
        skipped: result.skipped.length,
        failed: result.errors.length,
        created_groups: [],
        errors: result.errors.slice(0, 50),
    };

    if (rows.length === 0) return outcome;

    return sequelize.transaction(async (transaction) => {
        const createdGroups = [];

        if (createGroups) {
            const wanted = [...new Set(rows.map((r) => r.group_name).filter(Boolean))];
            for (const name of wanted) {
                const group = await EventGuestGroup.create(
                    {
                        website_client_id: clientId,
                        company_id: companyId ?? null,
                        name: name.slice(0, 120),
                        description: 'Created during a guest import.',
                    },
                    { transaction }
                );
                createdGroups.push({ id: group.id, name: group.name });
                // Point every row that named this group at the new id.
                for (const row of rows) if (row.group_name === name) row.group_id = group.id;
            }
        }

        const payload = rows.map(({ row: _row, group_name: _groupName, ...rest }) => ({
            ...rest,
            website_client_id: clientId,
            company_id: companyId ?? null,
            // A row that arrives with a status was clearly invited; without
            // this its response-rate denominator is wrong on Analytics.
            invited_at: rest.rsvp_status === 'not_responded' ? null : new Date(),
            responded_at: rest.response_type === 'none' ? null : new Date(),
        }));

        // Chunked — 5000 individual inserts against production at ~374ms each
        // (§103) would take half an hour.
        const CHUNK = 500;
        for (let i = 0; i < payload.length; i += CHUNK) {
            await EventGuest.bulkCreate(payload.slice(i, i + CHUNK), { transaction });
        }

        return { ...outcome, imported: payload.length, created_groups: createdGroups };
    });
};

module.exports = { parseCsv, commitImport, HEADER_MAP, REQUIRED, MAX_ROWS };
