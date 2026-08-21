/* Exercises the CSV import against the real sample file. Temporary. */
require('dotenv').config();
const fs = require('fs');
const { WebsiteClient, Event, EventGuest, EventGuestGroup, sequelize } = require('../src/models');
const importSvc = require('../src/services/clientGuestImport.service');
const guestSvc = require('../src/services/clientGuest.service');
const groupSvc = require('../src/services/clientGuestGroup.service');

const SAMPLE = 'C:/Users/LK MEDIA/Downloads/20260819_Client Module (1)/20260819_Client Module/05_4_Import_Guests sample.csv';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l}  ${x}`); } };

(async () => {
    // The client that actually OWNS the events, not merely the first with a
    // plan — the import is owner-scoped, so picking the wrong one makes every
    // row fail to resolve its event, which is correct behaviour badly tested.
    const events = await Event.findAll({ order: [['id', 'ASC']] });
    const client = await WebsiteClient.findByPk(events[0].website_client_id);
    console.log(`client ${client.id} (${client.email}) owns ${events.length} events`);
    const wedding = events.find((e) => e.name === 'Our Special Wedding');

    console.log('\n── PARSE THE REAL SAMPLE ──────────────────────────');
    const content = fs.readFileSync(SAMPLE, 'utf8');
    const parsed = await importSvc.parseCsv(client.id, { content });

    console.log('  delimiter :', parsed.delimiter);
    console.log('  mapped    :', parsed.mapping.filter((m) => m.field).length, 'of', parsed.mapping.length, 'headers');
    console.log('  unmapped  :', JSON.stringify(parsed.unmapped));
    console.log('  rows      :', parsed.total_rows, '| valid', parsed.valid_count, '| skipped', parsed.skipped_count, '| errors', parsed.error_count);
    console.log('  newGroups :', JSON.stringify(parsed.new_groups));

    ok('all 22 headers mapped', parsed.mapping.filter((m) => m.field).length === 22, JSON.stringify(parsed.unmapped));
    ok('4 rows parsed', parsed.total_rows === 4);
    // The demo seeder builds emails from the same name pool, so one CSV row can
    // legitimately collide with a guest already on this event. Every row must be
    // accounted for as either valid or skipped, and none may be an ERROR.
    ok('no rows errored', parsed.error_count === 0, JSON.stringify(parsed.errors));
    ok('every row accounted for', parsed.valid_count + parsed.skipped_count === 4);
    if (parsed.skipped_count) console.log('  skipped   :', JSON.stringify(parsed.skipped));
    ok('any skip is a real duplicate', parsed.skipped.every((s) => /already|duplicate/i.test(s.reason)));
    ok('resolved the event by name', parsed.preview.every((r) => r.event_id === wedding.id));

    const amit = parsed.preview.find((r) => r.first_name === 'Amit');
    console.log('  Amit      :', JSON.stringify({
        name: amit.name, status: amit.rsvp_status, response: amit.response_type,
        plus_one: amit.plus_one, count: amit.plus_one_count, city: amit.city,
        diet: amit.dietary_preference, mobile: amit.mobile, source: amit.invite_source,
    }));
    ok('Accepted -> accepted/yes', amit.rsvp_status === 'accepted' && amit.response_type === 'yes');
    ok('Plus One Yes/1 kept', amit.plus_one === 1 && amit.plus_one_count === 1);
    ok('address parsed', amit.city === 'Chennai' && amit.postal_code === '600001');
    ok('phone kept intact', amit.mobile === '+919876543210', amit.mobile);
    ok('invite_source is import', amit.invite_source === 'import');

    // Row-level checks run only on rows that survived, since a duplicate skip is
    // legitimate here. `Invited + blank response` is the important one — it is
    // the case the screens alone never showed — so it is asserted from a
    // synthetic row when the sample's own Rahul collides with seeded data.
    const invitedCase = parsed.preview.find((r) => r.rsvp_status === 'invited')
        ?? (await importSvc.parseCsv(client.id, {
            content: [
                'First Name*,Email*,Event Name*,RSVP Status,Response Type',
                'Invitee,invitee.only@example.com,Our Special Wedding,Invited,',
            ].join(String.fromCharCode(10)),
        })).preview[0];
    ok('Invited + blank response -> invited/none',
        invitedCase.rsvp_status === 'invited' && invitedCase.response_type === 'none',
        `${invitedCase.rsvp_status}/${invitedCase.response_type}`);

    const neha = parsed.preview.find((r) => r.first_name === 'Neha');
    if (neha) ok('Declined/No -> declined/no', neha.rsvp_status === 'declined' && neha.response_type === 'no');

    const priya = parsed.preview.find((r) => r.first_name === 'Priya');
    if (priya) {
        ok('quoted address line 2 kept', priya.address_line2 === 'Apt 2B', priya.address_line2);
        ok('Plus One No -> count forced to 0', priya.plus_one === 0 && priya.plus_one_count === 0);
    }

    console.log('\n── THE AWKWARD CASES ──────────────────────────────');

    // BOM + CRLF + quoted comma + doubled quote + blank trailing row
    const nasty = '\ufeff"First Name*","Last Name","Email*","Event Name*","Address Line 1","Notes"\r\n'
        + '"Ravi","Kumar","ravi@example.com","Our Special Wedding","12 Main St, Anna Nagar","He said ""yes"" twice"\r\n'
        + '\r\n';
    const nastyParsed = await importSvc.parseCsv(client.id, { content: nasty });
    ok('BOM header still matches', nastyParsed.valid_count === 1, JSON.stringify(nastyParsed.errors));
    ok('quoted comma kept whole', nastyParsed.preview[0]?.address_line1 === '12 Main St, Anna Nagar', nastyParsed.preview[0]?.address_line1);
    ok('doubled quote unescaped', nastyParsed.preview[0]?.notes === 'He said "yes" twice', nastyParsed.preview[0]?.notes);
    ok('blank trailing row ignored', nastyParsed.error_count === 0);

    // Semicolon delimiter
    const semi = 'First Name*;Email*;Event Name*\nSemi;semi@example.com;Our Special Wedding\n';
    const semiParsed = await importSvc.parseCsv(client.id, { content: semi });
    ok('semicolon delimiter detected', semiParsed.delimiter === ';' && semiParsed.valid_count === 1);

    // Unknown event
    const badEvent = 'First Name*,Email*,Event Name*\nGhost,ghost@example.com,Sangeet Night\n';
    const badParsed = await importSvc.parseCsv(client.id, { content: badEvent });
    ok('unknown event reported, not created', badParsed.error_count === 1 && badParsed.valid_count === 0);
    console.log('   ->', badParsed.errors[0].errors[0]);
    ok('no event was created', (await Event.count()) === events.length);

    // Excel-mangled phone
    const mangled = 'First Name*,Email*,Event Name*,Phone Number\nMangled,mangled@example.com,Our Special Wedding,9.19877E+11\n';
    const mangledParsed = await importSvc.parseCsv(client.id, { content: mangled });
    ok('scientific-notation phone rejected', mangledParsed.error_count === 1);
    console.log('   ->', mangledParsed.errors[0].errors[0]);

    // Missing required column
    try {
        await importSvc.parseCsv(client.id, { content: 'Last Name,Email*\nX,x@example.com\n' });
        ok('missing first name column refused', false);
    } catch (e) { ok('missing first name column refused', /first name/i.test(e.message), e.message); }

    // In-file duplicate
    const dupe = 'First Name*,Email*,Event Name*\nA,same@example.com,Our Special Wedding\nB,same@example.com,Our Special Wedding\n';
    const dupeParsed = await importSvc.parseCsv(client.id, { content: dupe });
    ok('in-file duplicate skipped', dupeParsed.valid_count === 1 && dupeParsed.skipped_count === 1);

    // defaultEventId fallback
    const noEvent = 'First Name*,Email*\nFallback,fallback@example.com\n';
    const fallbackParsed = await importSvc.parseCsv(client.id, { content: noEvent, defaultEventId: wedding.id });
    ok('falls back to the chosen event', fallbackParsed.valid_count === 1 && fallbackParsed.preview[0].event_id === wedding.id);

    const noEventNoDefault = await importSvc.parseCsv(client.id, { content: noEvent });
    ok('no event and no default -> reported', noEventNoDefault.error_count === 1);

    console.log('\n── COMMIT ─────────────────────────────────────────');
    const before = await EventGuest.count();
    const result = await importSvc.commitImport(client.id, client.company_id, {
        content, createGroups: true,
    });
    console.log('  result:', JSON.stringify(result));
    const after = await EventGuest.count();
    ok('valid rows written', result.imported === parsed.valid_count && after === before + result.imported);
    ok('groups created for unseen names', result.created_groups.length === parsed.new_groups.length,
        JSON.stringify(result.created_groups.map((g) => g.name)));

    const written = await EventGuest.findOne({ where: { email: 'amit.sharma@example.com', invite_source: 'import' } });
    ok('group linked on the row', !!written.group_id);
    ok('invited_at stamped for a status row', !!written.invited_at);
    ok('responded_at stamped for a real answer', !!written.responded_at);

    console.log('\n── RE-IMPORT IS IDEMPOTENT ────────────────────────');
    const again = await importSvc.commitImport(client.id, client.company_id, { content, createGroups: false });
    ok('second run imports nothing', again.imported === 0 && again.skipped === 4, JSON.stringify(again));
    ok('and reports every row as already present', again.failed === 0);
    ok('guest count unchanged', (await EventGuest.count()) === after);

    console.log('\n── LIST + STATS + GROUPS ──────────────────────────');
    const imported = await guestSvc.listGuests(client.id, { status: 'imported', limit: 50 });
    ok('Imported tab returns exactly what was imported',
        imported.pagination.totalItems === result.imported, String(imported.pagination.totalItems));
    ok('Imported tab rows are all import-sourced', imported.rows.every((r) => r.is_imported));
    const accepted = await guestSvc.listGuests(client.id, { status: 'accepted', limit: 5 });
    ok('Accepted tab returns only accepted', accepted.rows.every((r) => r.rsvp_status === 'accepted'));
    const stats = await guestSvc.getGuestStats(client.id);
    console.log('  stats:', JSON.stringify(stats));
    ok('stats add up', stats.accepted + stats.pending + stats.declined + stats.not_responded === stats.total_rows);

    const groupStats = await groupSvc.getGroupStats(client.id);
    console.log('  groups:', JSON.stringify(groupStats));
    ok('group stats counted', groupStats.total_groups === result.created_groups.length
        && groupStats.groups_in_use === result.created_groups.length, JSON.stringify(groupStats));

    console.log('\n── CLEANUP ────────────────────────────────────────');
    await EventGuest.destroy({ where: { invite_source: 'import' }, force: true });
    await EventGuestGroup.destroy({ where: {}, force: true });
    console.log('  guests left:', await EventGuest.count(), '| groups left:', await EventGuestGroup.count());

    console.log(`\n${pass} passed, ${fail} failed\n`);
    await sequelize.close();
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
