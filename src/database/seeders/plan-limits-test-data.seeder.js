/**
 * Test data for checking the plan limits (§587, §588).
 *
 * Fills each client's phone book and first event to ONE BELOW its plan limit,
 * so one more add succeeds and the next is refused:
 *
 *   client          guests (limit)   participants on first event (limit)
 *   #26 Jamal       +4   (5)         event 27: +9   (10)
 *   #27 Ismail      +0   (10)        event 20: +22  (25)   already 50 guests
 *   #28 Arsath      +19  (20)        event 21: +39  (40)
 *   #29 Najeeb      +49  (50)        event 22: +59  (60)
 *
 * Participants alternate: even rows are linked to a phone-book guest (same
 * mobile, guest_id set), odd rows are strangers (guest_id NULL). Answers cycle
 * accepted / declined / maybe / no response. Events and gallery items are not
 * created; events need QR secrets, and media needs real uploads.
 *
 * Every row carries notes = 'TEST DATA §588', which is how --remove finds them.
 * Refuses to run twice. Set-based inserts in one transaction (prod ~374ms/query).
 *
 *   node src/database/seeders/plan-limits-test-data.seeder.js                 production, dry run
 *   node src/database/seeders/plan-limits-test-data.seeder.js --apply         production, insert
 *   node src/database/seeders/plan-limits-test-data.seeder.js --remove        production, delete the test rows
 *
 * The client/event ids below are PRODUCTION's; it always targets .env.production.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');
const TAG = 'TEST DATA §588';

const PLAN = [
    { c: 26, guests: 4, group: 4, event: 27, parts: 9 },
    { c: 27, guests: 0, group: null, event: 20, parts: 22 },
    { c: 28, guests: 19, group: null, event: 21, parts: 39 },
    { c: 29, guests: 49, group: null, event: 22, parts: 59 },
];

const FIRST = ['Aamir', 'Bushra', 'Faisal', 'Hina', 'Imran', 'Javeria', 'Kashif', 'Lubna', 'Mohsin', 'Nazia',
    'Owais', 'Parveen', 'Qasim', 'Rehana', 'Salman', 'Tahira', 'Umar', 'Wasim', 'Yasmin', 'Zubair'];
const LAST = ['Khan', 'Shaikh', 'Ansari', 'Qureshi', 'Siddiqui', 'Pathan', 'Baig', 'Syed', 'Mirza', 'Hashmi'];
const nameAt = (i) => [FIRST[i % FIRST.length], LAST[Math.floor(i / FIRST.length) % LAST.length]];
const ANSWERS = [['accepted', 'yes'], ['declined', 'no'], ['pending', 'maybe'], ['not_responded', 'none']];

const parseEnv = (file) => {
    const out = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

(async () => {
    const env = parseEnv(path.join(__dirname, '..', '..', '..', '.env.production'));
    const conn = await mysql.createConnection({
        host: env.DB_HOST, port: env.DB_PORT || 3306, user: env.DB_USER,
        password: env.DB_PASSWORD, database: env.DB_NAME, ssl: { rejectUnauthorized: false },
    });
    const q = async (sql, params) => (await conn.query(sql, params))[0];
    const mode = REMOVE ? 'remove' : APPLY ? 'apply' : 'dry run';
    const say = (msg) => console.log(`[production · ${mode}] ${msg}`);

    try {
        const [have] = await q('SELECT (SELECT COUNT(*) FROM guests WHERE notes=?) g, (SELECT COUNT(*) FROM event_participants WHERE notes=?) p', [TAG, TAG]);

        if (REMOVE) {
            // Participants first: event_participants.guest_id points at guests.
            const p = await q('DELETE FROM event_participants WHERE notes=?', [TAG]);
            const g = await q('DELETE FROM guests WHERE notes=?', [TAG]);
            say(`removed ${p.affectedRows} participant(s), ${g.affectedRows} guest(s)`);
            return;
        }
        if (Number(have.g) || Number(have.p)) {
            say(`test data already present (${have.g} guests, ${have.p} participants) — nothing done. Use --remove first.`);
            return;
        }
        if (!APPLY) {
            for (const p of PLAN) say(`would add client #${p.c}: ${p.guests} guest(s), ${p.parts} participant(s) on event ${p.event}`);
            return;
        }

        await conn.beginTransaction();
        try {
            const now = new Date();
            for (const p of PLAN) {
                const gRows = [];
                for (let i = 0; i < p.guests; i++) {
                    const [f, l] = nameAt(i + p.c);
                    gRows.push([p.c, 1, p.group, f, l, `${f} ${l}`, '+91', `70${p.c}${String(i + 1).padStart(6, '0')}`, 'manual', TAG]);
                }
                if (gRows.length) {
                    await q('INSERT INTO guests (website_client_id, company_id, group_id, first_name, last_name, name, dial_code, mobile, source, notes) VALUES ?', [gRows]);
                }

                const book = await q('SELECT id, first_name, last_name, name, mobile FROM guests WHERE website_client_id=? AND deleted_at IS NULL ORDER BY id', [p.c]);
                const pRows = [];
                for (let i = 0; i < p.parts; i++) {
                    const [status, response] = ANSWERS[i % 4];
                    const linked = i % 2 === 0 ? book[Math.floor(i / 2)] : null;
                    const [f, l] = linked ? [linked.first_name, linked.last_name] : nameAt(i + 7 + p.c);
                    pRows.push([
                        p.event, p.c, linked ? linked.id : null, 1, f, l, linked ? linked.name : `${f} ${l}`, '+91',
                        linked ? linked.mobile : `71${p.c}${String(i + 1).padStart(6, '0')}`,
                        1 + (i % 3), status, response, 'manual', response === 'none' ? null : now, TAG,
                    ]);
                }
                if (pRows.length) {
                    await q('INSERT INTO event_participants (event_id, website_client_id, guest_id, company_id, first_name, last_name, name, dial_code, mobile, party_size, rsvp_status, response_type, invite_source, responded_at, notes) VALUES ?', [pRows]);
                }
                say(`client #${p.c}: +${gRows.length} guest(s), +${pRows.length} participant(s) on event ${p.event}`);
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }

        const rows = await q(`SELECT wc.id c, wc.name, sp.name plan,
            (SELECT COUNT(*) FROM guests g WHERE g.website_client_id=wc.id AND g.deleted_at IS NULL) guests, sp.max_guests_per_event guest_limit,
            (SELECT MAX(n) FROM (SELECT COUNT(*) n FROM event_participants x WHERE x.website_client_id=wc.id AND x.deleted_at IS NULL GROUP BY x.event_id) t) participants, sp.max_rsvp_per_event rsvp_limit
            FROM website_clients wc JOIN subscription_plans sp ON sp.id=wc.subscription_plan_id WHERE wc.id IN (?) ORDER BY wc.id`, [PLAN.map((p) => p.c)]);
        console.table(rows);
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('FAILED (nothing committed):', err.message);
    process.exit(1);
});
