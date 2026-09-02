/*
 * Guest Profile + RSVP history — against the SERVICES, not over HTTP.
 *
 * ── WHY THIS ONE IS DIFFERENT ───────────────────────────────────────────────
 * Every other suite here drives a live server on :5001. This one calls the
 * service layer directly, for two reasons:
 *
 *   1. It needs no server, so a schema change can be proved the moment it is
 *      written rather than after somebody remembers to restart something.
 *   2. The rules being guarded are SERVICE rules — what gets written to the
 *      history, what a tag does when re-added, whether a reminder in the past
 *      is refused. Routing them through HTTP would test Express as well and
 *      tell you less about which of the two broke.
 *
 * ── WHAT THIS FILE IS REALLY GUARDING ───────────────────────────────────────
 *   · a response change APPENDS history and never rewrites it
 *   · a change that touches no response field writes NOTHING — a history with
 *     an entry per save is a history nobody reads
 *   · CLEARING a response is itself history. This is the one case where the
 *     guest row afterwards says nothing at all, and without an entry the fact
 *     that they once accepted would be gone from the system
 *   · `from_response_type` is NULL only on a first entry, never 'none'
 *   · `unknown` accommodation is not `not_required`
 *   · a re-added tag RESTORES its row instead of creating a duplicate
 *   · a reminder's "upcoming/overdue" is DERIVED, never stored
 *   · the profile links on EMAIL and says so; no email means one row
 *   · notes here are NOT `event_guests`.`notes`
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-guest-profile.test.js
 * Requires MySQL and the Phase 3 migration. No server needed.
 * Creates its own fixtures under a scratch client and removes them at the end.
 */
require('dotenv').config();

const {
    sequelize,
    WebsiteClient,
    Event,
    EventGuest,
    EventGuestNote,
    EventGuestTag,
    EventGuestReminder,
    EventGuestResponseLog,
} = require('../src/models');

const rsvpService = require('../src/services/clientRsvp.service');
const profileService = require('../src/services/clientGuestProfile.service');

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

const rejects = async (label, fn, match) => {
    try {
        await fn();
        fail++; console.log(`  FAIL  ${label}  (it was allowed)`);
    } catch (err) {
        const hit = !match || String(err.message).toLowerCase().includes(match.toLowerCase());
        if (hit) { pass++; console.log(`  PASS  ${label}`); }
        else { fail++; console.log(`  FAIL  ${label}  (wrong reason: ${err.message})`); }
    }
};

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const MARK = 'guest-profile-test@scratch.local';
let clientId; let eventId; let guestId; let siblingId; let noEmailId;

const setup = async () => {
    await teardown();

    const client = await WebsiteClient.create({
        vendor_id: 1, name: 'Profile Test Host', email: MARK, source: 'admin',
    });
    clientId = client.id;

    const event = await Event.create({
        website_client_id: clientId, name: 'Profile Test Wedding', start_date: '2027-01-15',
    });
    eventId = event.id;

    const second = await Event.create({
        website_client_id: clientId, name: 'Profile Test Reception', start_date: '2027-01-16',
    });

    // Same email on two events — this is the ONLY thing that links them.
    const guest = await EventGuest.create({
        event_id: eventId, website_client_id: clientId, name: 'Neha Test',
        email: 'neha.test@scratch.local', mobile: '9876500001', party_size: 2,
        rsvp_status: 'invited', invited_at: new Date(), response_type: 'none',
    });
    guestId = guest.id;

    const sibling = await EventGuest.create({
        event_id: second.id, website_client_id: clientId, name: 'Neha Test',
        email: 'neha.test@scratch.local', mobile: '9876500001', party_size: 1,
        rsvp_status: 'invited', response_type: 'none',
    });
    siblingId = sibling.id;

    // No email at all — cannot be linked to anybody, and that is correct.
    const anon = await EventGuest.create({
        event_id: eventId, website_client_id: clientId, name: 'No Email Test',
        mobile: '9876500002', party_size: 1, rsvp_status: 'invited', response_type: 'none',
    });
    noEmailId = anon.id;
};

const teardown = async () => {
    const stale = await WebsiteClient.findOne({ where: { email: MARK }, paranoid: false });
    if (!stale) return;
    // Guests, notes, tags, reminders and logs all CASCADE from the client.
    await WebsiteClient.destroy({ where: { id: stale.id }, force: true });
};

/* ── History ─────────────────────────────────────────────────────────────── */

const historyTests = async () => {
    console.log('\nRSVP history');

    const logsFor = (id) => EventGuestResponseLog.findAll({
        where: { guest_id: id }, order: [['id', 'ASC']],
    });

    ok('a guest who never answered has NO history',
        (await logsFor(guestId)).length === 0);

    await rsvpService.update(clientId, guestId, { response_type: 'yes', party_size: 2 });
    let logs = await logsFor(guestId);
    ok('answering appends one entry', logs.length === 1, `got ${logs.length}`);
    ok('the FIRST entry has from = NULL, not "none"',
        logs[0].from_response_type === null, String(logs[0].from_response_type));
    ok('it records what the answer BECAME', logs[0].to_response_type === 'yes');

    await rsvpService.update(clientId, guestId, { response_type: 'maybe' });
    logs = await logsFor(guestId);
    ok('changing the answer appends, never rewrites', logs.length === 2);
    ok('the earlier entry is untouched', logs[0].to_response_type === 'yes');
    ok('the later entry names what it changed FROM', logs[1].from_response_type === 'yes');
    ok('a later entry is not marked first', logs[1].from_response_type !== null);

    // The rule that keeps the history readable.
    await rsvpService.update(clientId, guestId, { group_id: null });
    ok('a change touching NO response field writes nothing',
        (await logsFor(guestId)).length === 2);

    await rsvpService.update(clientId, guestId, { response_type: 'maybe' });
    ok('re-saving the SAME answer writes nothing',
        (await logsFor(guestId)).length === 2);

    await rsvpService.update(clientId, guestId, { party_size: 4 });
    logs = await logsFor(guestId);
    ok('changing only the party size IS history', logs.length === 3);
    ok('it carries the unchanged answer forward', logs[2].to_response_type === 'maybe');
    ok('and the new party size', logs[2].party_size === 4);

    // The most important one.
    await rsvpService.resetResponse(clientId, guestId, 'Called to cancel');
    logs = await logsFor(guestId);
    ok('CLEARING a response is itself history', logs.length === 4);
    ok('it records the answer being taken back', logs[3].to_response_type === 'none');
    ok('and what it was before', logs[3].from_response_type === 'maybe');

    const guest = await EventGuest.findByPk(guestId);
    ok('the guest still exists after a reset', !!guest);
    ok('and their row says nothing — which is why the log matters',
        guest.response_type === 'none' && guest.responded_at === null);

    ok('history is append-only: nothing was deleted',
        (await logsFor(guestId)).length === 4);
};

/* ── Accommodation ───────────────────────────────────────────────────────── */

const accommodationTests = async () => {
    console.log('\nAccommodation');

    const guest = await EventGuest.findByPk(guestId);
    ok('defaults to unknown, not not_required', guest.accommodation === 'unknown');

    await rsvpService.update(clientId, guestId, { accommodation: 'required' });
    ok('can be set', (await EventGuest.findByPk(guestId)).accommodation === 'required');

    await rejects('a made-up value is refused',
        () => rsvpService.update(clientId, guestId, { accommodation: 'maybe_later' }),
        'accommodation');

    const logs = await EventGuestResponseLog.findAll({
        where: { guest_id: guestId }, order: [['id', 'DESC']], limit: 1,
    });
    ok('changing it appends history', logs[0].accommodation === 'required');
};

/* ── Notes ───────────────────────────────────────────────────────────────── */

const noteTests = async () => {
    console.log('\nNotes');

    const { id } = await profileService.createNote(clientId, guestId, {
        title: 'Vegetarian Preference',
        body: '<p>Neha prefers <strong>vegetarian</strong> food.</p>',
        category: 'dietary',
        is_pinned: true,
    });
    ok('a note is created', !!id);

    await rejects('a note with no title is refused',
        () => profileService.createNote(clientId, guestId, { title: '   ' }), 'title');

    await rejects('an unknown category is refused',
        () => profileService.updateNote(clientId, guestId, id, { category: 'gossip' }), 'category');

    const profile = await profileService.getProfile(clientId, guestId);
    const note = profile.notes.find((n) => n.id === id);
    ok('the note comes back on the profile', !!note);
    ok('its body is kept as HTML, not stripped',
        note.body.includes('<strong>'), note.body);
    ok('pinned notes sort first', profile.notes[0].is_pinned === true);
    ok('a fresh note is not marked edited', note.edited === false);

    // The distinction the whole design depends on.
    ok('the GUEST\'s own response note is separate from host notes',
        profile.guest.response_note === 'Called to cancel'
        && !profile.notes.some((n) => n.body.includes('Called to cancel')));

    await profileService.deleteNote(clientId, guestId, id);
    const after = await profileService.getProfile(clientId, guestId);
    ok('a deleted note leaves the profile', !after.notes.some((n) => n.id === id));

    const still = await EventGuestNote.findByPk(id, { paranoid: false });
    ok('but is only soft-deleted', !!still && !!still.deleted_at);
};

/* ── Tags ────────────────────────────────────────────────────────────────── */

const tagTests = async () => {
    console.log('\nTags');

    const { id } = await profileService.addTag(clientId, guestId, { label: 'Close Guest' });
    ok('a tag is added', !!id);

    await rejects('the same tag twice is refused',
        () => profileService.addTag(clientId, guestId, { label: 'Close Guest' }), 'already');

    await profileService.removeTag(clientId, guestId, id);
    const readded = await profileService.addTag(clientId, guestId, { label: 'Close Guest' });
    ok('a removed tag can be added back', !!readded.id);
    ok('and it RESTORES the same row rather than duplicating', readded.id === id);

    const live = await EventGuestTag.count({ where: { guest_id: guestId, label: 'Close Guest' } });
    ok('so the guest carries the label exactly once', live === 1, `got ${live}`);

    const profile = await profileService.getProfile(clientId, guestId);
    const tag = profile.tags.find((t) => t.label === 'Close Guest');
    ok('an uncoloured tag still gets a tint to render with', !!tag.tint);

    const again = await profileService.getProfile(clientId, guestId);
    ok('and the tint is stable between reads',
        again.tags.find((t) => t.label === 'Close Guest').tint === tag.tint);

    // Tags live on the guest ROW, so the same person can carry one per event.
    await profileService.addTag(clientId, siblingId, { label: 'Close Guest' });
    const merged = await profileService.getProfile(clientId, guestId);
    ok('the same label across two events shows ONCE on the profile',
        merged.tags.filter((t) => t.label === 'Close Guest').length === 1);
};

/* ── Reminders ───────────────────────────────────────────────────────────── */

const reminderTests = async () => {
    console.log('\nReminders');

    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const { id } = await profileService.createReminder(clientId, guestId, {
        title: 'Follow up if no response', due_at: future.toISOString(),
    });
    ok('a reminder is created', !!id);

    await rejects('a reminder in the past is REFUSED',
        () => profileService.createReminder(clientId, guestId, {
            title: 'Too late', due_at: '2020-01-01T10:00:00Z',
        }), 'passed');

    await rejects('a reminder with no date is refused',
        () => profileService.createReminder(clientId, guestId, { title: 'No date' }), 'date');

    let profile = await profileService.getProfile(clientId, guestId);
    let r = profile.reminders.find((x) => x.id === id);
    ok('its state is derived as upcoming', r.state === 'upcoming');
    ok('and "upcoming" is NOT what is stored', r.status === 'pending');

    // Prove the derivation rather than trusting it: move the date into the past
    // behind the service's back, which is the one thing the service refuses.
    await EventGuestReminder.update(
        { due_at: new Date(Date.now() - 3600 * 1000) }, { where: { id } },
    );
    profile = await profileService.getProfile(clientId, guestId);
    r = profile.reminders.find((x) => x.id === id);
    ok('a passed date reads as overdue WITHOUT anything being rewritten',
        r.state === 'overdue' && r.status === 'pending');

    await profileService.updateReminder(clientId, guestId, id, { status: 'done' });
    profile = await profileService.getProfile(clientId, guestId);
    r = profile.reminders.find((x) => x.id === id);
    ok('a finished reminder is not overdue', r.state === 'done');
    ok('and it is stamped', !!r.completed_at);

    await profileService.updateReminder(clientId, guestId, id, { status: 'pending' });
    profile = await profileService.getProfile(clientId, guestId);
    ok('reopening clears the completion stamp',
        profile.reminders.find((x) => x.id === id).completed_at === null);
};

/* ── The profile itself ──────────────────────────────────────────────────── */

const profileTests = async () => {
    console.log('\nProfile');

    const profile = await profileService.getProfile(clientId, guestId);

    ok('it says how it was assembled', profile.identity.linked_by === 'email');
    ok('and names the rows it used', profile.identity.guest_row_ids.length === 2);
    ok('two events for the same email count as two', profile.summary.events_invited === 2);
    ok('linked events include both', profile.linked_events.length === 2);
    ok('and mark which one you are looking at',
        profile.linked_events.filter((e) => e.is_current).length === 1);

    ok('an invitation not yet sent is distinguishable from one with no reply',
        profile.linked_events.some((e) => e.invitation_sent === false));

    // The weak point, said out loud rather than hidden.
    ok('the email caveat is in the payload for the screen to print',
        /email/i.test(profile.identity.note));

    const anon = await profileService.getProfile(clientId, noEmailId);
    ok('a guest with NO email links to nobody', anon.identity.linked_by === 'none');
    ok('and their profile is exactly one row', anon.identity.guest_row_ids.length === 1);
    ok('which is stated, not left blank', /no email address/i.test(anon.identity.note));

    ok('history spans every linked row', profile.response_history.length >= 4);
    ok('newest first', new Date(profile.response_history[0].changed_at)
        >= new Date(profile.response_history[1].changed_at));
    ok('the first-ever entry is flagged for the screen',
        profile.response_history.some((h) => h.is_first === true));

    ok('custom questions are STILL unavailable after phase 3',
        !!profile.unavailable.custom_questions);
    ok('but rsvp history no longer is', profile.unavailable.rsvp_history === undefined);
    ok('and neither are notes', profile.unavailable.notes === undefined);

    // No provider is connected, so these must read zero rather than pretending.
    ok('opened is counted from opened_at, so it is 0 with no provider',
        profile.summary.opened === 0);

    await rejects('another client\'s guest is not found',
        () => profileService.getProfile(clientId + 999999, guestId), 'not found');
    await rejects('a nonsense id is not found',
        () => profileService.getProfile(clientId, 'abc'), 'not found');
};

/* ── Profile writes ──────────────────────────────────────────────────────── */

const writeTests = async () => {
    console.log('\nProfile writes');

    await profileService.updateProfile(clientId, guestId, { relationship: 'Cousin' });
    let profile = await profileService.getProfile(clientId, guestId);
    ok('relationship is saved', profile.guest.relationship === 'Cousin');
    ok('and is separate from the group', profile.guest.relationship !== (profile.guest.group?.name));

    // The rule carried over from the RSVP edit screen.
    await profileService.updateProfile(clientId, guestId, {
        relationship: 'Cousin', name: 'Hacked Name', email: 'hacked@scratch.local',
    });
    profile = await profileService.getProfile(clientId, guestId);
    ok('name is NOT writable here', profile.guest.name === 'Neha Test');
    ok('email is NOT writable here', profile.guest.email === 'neha.test@scratch.local');

    await rejects('an empty update is refused',
        () => profileService.updateProfile(clientId, guestId, {}), 'nothing');
};

/* ── Run ─────────────────────────────────────────────────────────────────── */

(async () => {
    console.log('Guest Profile — service-level suite\n');
    try {
        await sequelize.authenticate();
        await setup();

        await historyTests();
        await accommodationTests();
        await noteTests();
        await tagTests();
        await reminderTests();
        await profileTests();
        await writeTests();
    } catch (err) {
        fail++;
        console.error('\n  ABORTED:', err.message);
        console.error(err.stack);
    } finally {
        // Always, so a failed run cannot make the next one fail differently.
        await teardown();
        await sequelize.close();
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
