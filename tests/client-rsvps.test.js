/*
 * RSVPs — over HTTP, against a live server.
 *
 * ── WHAT THIS FILE IS REALLY GUARDING ───────────────────────────────────────
 * There is no RSVP table. An RSVP is the response COLUMNS on a guest, and every
 * assertion here follows from that:
 *
 *   · "Delete RSVP" CLEARS the response and keeps the guest — the row must
 *     still exist afterwards, still be in its group, still be counted
 *   · `rsvp_status` is DERIVED from `response_type`, never accepted alongside
 *     it, so a row can never say "accepted" and "no" at once
 *   · `responded_at` is cleared when an answer is taken back — it must not name
 *     a moment the client has since undone
 *   · the tiles ignore the STATUS filter, or clicking "Accepted" makes every
 *     other tile read zero and the summary becomes a restatement of the tab
 *   · moving a guest between groups must not touch their RSVP
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/client-rsvps.test.js
 * Requires the backend running on :5001 and the seeded test client.
 */
require('dotenv').config();

const { sequelize } = require('../src/models');

const BASE = process.env.TEST_API_URL || 'http://localhost:5001/api/v1';
const CREDENTIALS = { email: 'test@example.com', password: 'Test@123' };

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

let cookies = '';
const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(cookies ? { Cookie: cookies } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, body: json };
};

(async () => {
    console.log(`\nRSVPs against ${BASE}\n`);
    let clientId = null;
    let eventId = null;
    let rsvpId = null;
    let original = null;

    try {
        console.log('── unauthenticated ───────────────────────────────');
        {
            const res = await call('GET', '/client/rsvps');
            ok('GET /rsvps without a session -> 401', res.status === 401, `got ${res.status}`);
        }

        const login = await call('POST', '/public/website-clients/login', CREDENTIALS);
        ok('signs in', login.status === 200, `got ${login.status}`);
        clientId = login.body?.data?.client?.id;

        // The event with a guest list on it.
        const [ev] = await sequelize.query(
            `SELECT event_id, COUNT(*) n FROM event_guests
              WHERE website_client_id = ? AND deleted_at IS NULL
              GROUP BY event_id ORDER BY n DESC LIMIT 1`,
            { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
        );
        eventId = ev?.event_id ?? null;
        ok('the test account has an event with guests', Boolean(eventId), String(eventId));

        if (!eventId) {
            console.log('\n  no guests on the test account — skipping\n');
            return;
        }

        console.log('\n── the list and its tiles ────────────────────────');
        let stats = null;
        {
            const res = await call('GET', `/client/rsvps?event_id=${eventId}`);
            ok('the list loads', res.status === 200, `got ${res.status}`);
            stats = res.body?.data?.stats;
            rsvpId = res.body?.data?.rsvps?.[0]?.id;

            /*
              Four buckets over five stored statuses: `not_responded` and
              `invited` both mean "still waiting". The tile and the tab must
              agree or they contradict each other on the same screen.
            */
            const sum = stats.accepted + stats.maybe + stats.declined + stats.no_response;
            ok('the four buckets account for every invitation',
                sum === stats.total_invitations, `${sum} vs ${stats.total_invitations}`);

            // Rows, not heads — one invitation per guest however many it covers.
            ok('total_invitations is ROWS, and heads is reported separately',
                stats.heads >= stats.total_invitations,
                `${stats.heads} heads / ${stats.total_invitations} rows`);

            ok('every row carries a bucket the tabs can filter on',
                (res.body?.data?.rsvps ?? []).every((r) =>
                    ['accepted', 'maybe', 'declined', 'no_response'].includes(r.bucket)));

            // Unanswered rows must not head the list with an empty date column.
            const rows = res.body?.data?.rsvps ?? [];
            const firstUnanswered = rows.findIndex((r) => !r.responded_at);
            const lastAnswered = rows.map((r) => Boolean(r.responded_at)).lastIndexOf(true);
            ok('answered rows sort above unanswered ones',
                firstUnanswered === -1 || lastAnswered === -1 || lastAnswered < firstUnanswered,
                `lastAnswered ${lastAnswered}, firstUnanswered ${firstUnanswered}`);
        }

        {
            /*
              THE tile rule: the summary counts everything the other filters
              select, but NOT the status filter — otherwise clicking a tab makes
              every other tile read zero.
            */
            const filtered = await call('GET', `/client/rsvps?event_id=${eventId}&status=accepted`);
            ok('filtering by status narrows the ROWS',
                filtered.body?.data?.pagination?.totalItems === stats.accepted,
                `${filtered.body?.data?.pagination?.totalItems} vs ${stats.accepted}`);
            ok('but the TILES still describe the whole event',
                filtered.body?.data?.stats?.total_invitations === stats.total_invitations,
                `${filtered.body?.data?.stats?.total_invitations} vs ${stats.total_invitations}`);
            ok('so the declined tile is unchanged by an "accepted" filter',
                filtered.body?.data?.stats?.declined === stats.declined);
        }

        console.log('\n── one RSVP ──────────────────────────────────────');
        {
            const res = await call('GET', `/client/rsvps/${rsvpId}`);
            ok('the detail loads', res.status === 200, `got ${res.status}`);
            original = res.body?.data?.rsvp;

            const keys = (res.body?.data?.timeline ?? []).map((t) => t.key);
            ok('the timeline is derived and starts at creation',
                keys[0] === 'created', keys.join(','));

            /*
              Strictly chronological. The seeder once wrote guests with
              created_at = NOW and messages dated in the past, which made
              "added to the guest list" sort AFTER the messages sent to them —
              an impossible order this assertion now catches.
            */
            const times = (res.body?.data?.timeline ?? []).map((t) => new Date(t.at).getTime());
            ok('and is strictly chronological',
                times.every((t, i) => i === 0 || t >= times[i - 1]));

            /*
              ⚠ This list SHRANK in Phase 3, and that is the point of asserting
              on it. `rsvp_history` and `notes` were here because nothing stored
              them; both now have tables, so naming them as unavailable would be
              the screen apologising for a feature it has. Custom questions
              stay: `custom_answers` holds JSON but nothing defines what the
              QUESTIONS are, which is a missing definition rather than a missing
              column, and no table added here fixes it.
            */
            ok('what this system does not record is NAMED, not left blank',
                typeof res.body?.data?.unavailable?.custom_questions === 'string');
            ok('and what it NOW records has left that list',
                res.body?.data?.unavailable?.rsvp_history === undefined
                && res.body?.data?.unavailable?.notes === undefined);

            // Phase 3: the detail carries the history the tab renders.
            ok('the response history is on the payload',
                Array.isArray(res.body?.data?.response_history));

            const other = await call('GET', '/client/rsvps/99999999');
            ok("somebody else's rsvp id -> 404", other.status === 404, `got ${other.status}`);
            const nan = await call('GET', '/client/rsvps/abc');
            ok('/rsvps/abc -> 404, not queried as NaN', nan.status === 404, `got ${nan.status}`);
        }

        console.log('\n── editing a response ────────────────────────────');
        {
            const res = await call('PUT', `/client/rsvps/${rsvpId}`, {
                response_type: 'yes', party_size: 3, dietary_preference: 'Vegetarian',
            });
            ok('the response updates', res.status === 200, `got ${res.status}`);
            const r = res.body?.data?.rsvp;

            /*
              Derived, never accepted alongside. Allowing both means a row can
              say "accepted" and "no" at once and nothing can decide which wins.
            */
            ok('rsvp_status is DERIVED from response_type',
                r?.response_type === 'yes' && r?.rsvp_status === 'accepted' && r?.bucket === 'accepted',
                JSON.stringify([r?.response_type, r?.rsvp_status, r?.bucket]));
            ok('and responded_at is stamped', Boolean(r?.responded_at));
            ok('the other fields saved', r?.party_size === 3 && r?.dietary_preference === 'Vegetarian');

            const bad = await call('PUT', `/client/rsvps/${rsvpId}`, { response_type: 'sure' });
            ok('an invalid response -> 400', bad.status === 400, `got ${bad.status}`);
            const big = await call('PUT', `/client/rsvps/${rsvpId}`, { party_size: 0 });
            ok('a party size of 0 -> 400', big.status === 400, `got ${big.status}`);

            /*
              A crafted rsvp_status must not get through — it is not a writable
              field, so sending one changes nothing rather than desyncing the row.
            */
            await call('PUT', `/client/rsvps/${rsvpId}`, { rsvp_status: 'declined', party_size: 3 });
            const after = await call('GET', `/client/rsvps/${rsvpId}`);
            ok('a crafted rsvp_status is IGNORED, so the row cannot desync',
                after.body?.data?.rsvp?.rsvp_status === 'accepted',
                after.body?.data?.rsvp?.rsvp_status);
        }

        console.log('\n── clearing a response is NOT deleting a guest ───');
        {
            const before = await sequelize.query(
                'SELECT group_id, name FROM event_guests WHERE id = ?',
                { replacements: [rsvpId], type: sequelize.QueryTypes.SELECT },
            );

            const res = await call('PUT', `/client/rsvps/${rsvpId}/reset`);
            ok('the reset succeeds', res.status === 200, `got ${res.status}`);
            ok('and the message says CLEARED, never deleted',
                /cleared/i.test(res.body?.message || '') && !/delet/i.test(res.body?.message || ''),
                res.body?.message);

            const r = res.body?.data?.rsvp;
            ok('the response is gone', r?.response_type === 'none' && r?.bucket === 'no_response');
            // Must not name a moment the client has since undone.
            ok('responded_at is cleared', r?.responded_at === null);
            /*
              'invited', not 'not_responded' — the invitation WAS sent, and
              saying otherwise puts them back in the never-contacted bucket and
              hides that they have already been asked.
            */
            ok('the status returns to INVITED, not "never contacted"',
                r?.rsvp_status === 'invited', r?.rsvp_status);

            // The whole point: the guest survives.
            const [row] = await sequelize.query(
                'SELECT id, group_id, deleted_at FROM event_guests WHERE id = ?',
                { replacements: [rsvpId], type: sequelize.QueryTypes.SELECT },
            );
            ok('THE GUEST STILL EXISTS', Boolean(row) && row.deleted_at === null, JSON.stringify(row));
            ok('and is still in their group', row?.group_id === before[0]?.group_id);

            const still = await call('GET', `/client/rsvps?event_id=${eventId}`);
            ok('and is still counted in the tiles',
                still.body?.data?.stats?.total_invitations === stats.total_invitations);

            // There is no DELETE on this router at all — deleting the person is
            // a different route with a different verb.
            const del = await call('DELETE', `/client/rsvps/${rsvpId}`);
            ok('DELETE /rsvps/:id is not a route', del.status === 404 || del.status === 405,
                `got ${del.status}`);
        }

        console.log('\n── groups ────────────────────────────────────────');
        {
            const [grp] = await sequelize.query(
                `SELECT g.id, g.name FROM event_guest_groups g
                  WHERE g.website_client_id = ? AND g.deleted_at IS NULL LIMIT 1`,
                { replacements: [clientId], type: sequelize.QueryTypes.SELECT },
            );

            const res = await call('GET', `/client/rsvps/groups/${grp.id}?event_id=${eventId}`);
            ok('the group loads', res.status === 200, `got ${res.status}`);
            const s = res.body?.data?.stats;
            ok('its buckets account for every member',
                s.accepted + s.maybe + s.declined + s.no_response === s.total_members,
                JSON.stringify(s));
            ok('members are returned', (res.body?.data?.members ?? []).length === s.total_members);
            // Activity is real responses only — a group where nobody replied
            // shows nothing rather than a list of "no response" rows.
            ok('activity contains only guests who actually answered',
                (res.body?.data?.activity ?? []).every((a) => a.at));

            const other = await call('GET', '/client/rsvps/groups/99999999');
            ok("somebody else's group id -> 404", other.status === 404, `got ${other.status}`);
        }

        console.log('\n── moving a guest must not touch their RSVP ──────');
        {
            await call('PUT', `/client/rsvps/${rsvpId}`, { response_type: 'yes' });
            const before = (await call('GET', `/client/rsvps/${rsvpId}`)).body?.data?.rsvp;

            const [target] = await sequelize.query(
                `SELECT id, name FROM event_guest_groups
                  WHERE website_client_id = ? AND deleted_at IS NULL AND id <> ? LIMIT 1`,
                { replacements: [clientId, before.group?.id ?? 0], type: sequelize.QueryTypes.SELECT },
            );

            if (target) {
                const res = await call('PUT', `/client/rsvps/${rsvpId}/group`, { group_id: target.id });
                ok('the move succeeds', res.status === 200, `got ${res.status}`);
                ok('the guest is in the new group', res.body?.data?.rsvp?.group?.id === target.id);
                // Exactly what the confirm dialog promises.
                ok('and their RSVP is UNCHANGED',
                    res.body?.data?.rsvp?.response_type === before.response_type
                    && res.body?.data?.rsvp?.bucket === before.bucket,
                    JSON.stringify([res.body?.data?.rsvp?.bucket, before.bucket]));
                await call('PUT', `/client/rsvps/${rsvpId}/group`, { group_id: before.group?.id ?? null });
            }

            const bad = await call('PUT', `/client/rsvps/${rsvpId}/group`, { group_id: 99999999 });
            ok("a group that is not yours -> 400", bad.status === 400, `got ${bad.status}`);
        }

        console.log('\n── export ────────────────────────────────────────');
        {
            const res = await call('GET', `/client/rsvps/export?event_id=${eventId}`);
            ok('the export loads', res.status === 200, `got ${res.status}`);
            ok('it returns rows, not a file — the CSV is built in the browser',
                Array.isArray(res.body?.data?.rows));
            ok('and it says whether it was truncated',
                typeof res.body?.data?.truncated === 'boolean');
            ok('it honours the same filters as the list',
                res.body?.data?.count === stats.total_invitations,
                `${res.body?.data?.count} vs ${stats.total_invitations}`);

            /*
              Re-read the tiles rather than reusing the ones captured at the top:
              the tests above deliberately changed this row's response, so the
              opening snapshot is stale by design. Comparing against it would
              fail for a reason that has nothing to do with the export.
            */
            const now = (await call('GET', `/client/rsvps/stats?event_id=${eventId}`)).body?.data;
            const filtered = await call('GET', `/client/rsvps/export?event_id=${eventId}&status=accepted`);
            ok('a filtered export is narrower, and matches the tile',
                filtered.body?.data?.count === now.accepted
                && filtered.body?.data?.count < now.total_invitations,
                `${filtered.body?.data?.count} vs ${now.accepted} of ${now.total_invitations}`);
        }
    } finally {
        console.log('\n── restore ───────────────────────────────────────');
        if (rsvpId && original) {
            // Put the row back exactly as it was found.
            await call('PUT', `/client/rsvps/${rsvpId}`, {
                response_type: original.response_type,
                party_size: original.party_size,
                dietary_preference: original.dietary_preference,
                notes: original.notes,
            });
            if (original.response_type === 'none') {
                await call('PUT', `/client/rsvps/${rsvpId}/reset`);
            }
            const [row] = await sequelize.query(
                'SELECT response_type, party_size FROM event_guests WHERE id = ?',
                { replacements: [rsvpId], type: sequelize.QueryTypes.SELECT },
            );
            ok('the test row was restored',
                row?.response_type === original.response_type
                && Number(row?.party_size) === original.party_size,
                JSON.stringify(row));
        }
        await sequelize.close();
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
