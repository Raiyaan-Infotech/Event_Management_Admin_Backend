#!/usr/bin/env node
/**
 * Contact person = the event's contact, not a client (Jamal, 2026-10-26).
 *
 *  1. Creates `contact_person_logins` (the sign-in code per contact mobile).
 *  2. Removes the client accounts that were made ONLY so a contact person could
 *     sign in (eventOrganizer.createFromEvent, 2026-10-13): no plan, no event
 *     of their own, not a participant anywhere, and linked as an event's
 *     organizer. Their sessions go with them. A number that is also a real
 *     client or a participant keeps its account.
 *  3. Clears events.organizer_client_id everywhere — access now comes from the
 *     event's contact mobile; the column is no longer read.
 *
 *   node src/database/tools/apply-contact-person-logins.js                  dry run, local
 *   node src/database/tools/apply-contact-person-logins.js --apply          local
 *   node src/database/tools/apply-contact-person-logins.js --prod           dry run, production
 *   node src/database/tools/apply-contact-person-logins.js --prod --apply   production
 *
 * ⚠ ORDER on production: run this BEFORE pushing the backend.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');
if (PROD) {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env.production'), override: true });
}
const SQL_FILE = path.join(__dirname, '..', 'migrations', 'sql', '20261026-contact-person-logins.sql');

const PURE_CONTACT_ACCOUNTS = `
SELECT c.id, c.name, c.mobile
  FROM website_clients c
 WHERE c.subscription_plan_id IS NULL
   AND EXISTS (SELECT 1 FROM events e WHERE e.organizer_client_id = c.id AND e.website_client_id <> c.id)
   AND NOT EXISTS (SELECT 1 FROM events o WHERE o.website_client_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM event_participants p WHERE p.participant_client_id = c.id)`;

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);
    try {
        const [[t]] = await conn.query(
            'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            [process.env.DB_NAME, 'contact_person_logins'],
        );
        console.log(t.n ? '  = contact_person_logins          already exists'
            : `  + contact_person_logins          ${APPLY ? 'creating' : 'WOULD CREATE'}`);
        if (!t.n && APPLY) {
            await conn.query(fs.readFileSync(SQL_FILE, 'utf8')
                .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'));
        }

        const [accounts] = await conn.query(PURE_CONTACT_ACCOUNTS);
        if (!accounts.length) console.log('  (no contact-person-only client accounts)');
        for (const a of accounts) {
            console.log(`  - client #${a.id} ${a.name} (${a.mobile})  ${APPLY ? 'DELETING' : 'WOULD DELETE'}`);
        }
        const [[linked]] = await conn.query('SELECT COUNT(*) AS n FROM events WHERE organizer_client_id IS NOT NULL');
        console.log(`  ~ events.organizer_client_id set on ${linked.n} event(s)  ${APPLY ? 'clearing' : 'WOULD CLEAR'}`);

        if (APPLY) {
            await conn.beginTransaction();
            try {
                await conn.query('UPDATE events SET organizer_client_id = NULL WHERE organizer_client_id IS NOT NULL');
                const ids = accounts.map((a) => a.id);
                if (ids.length) {
                    await conn.query('DELETE FROM client_sessions WHERE website_client_id IN (?)', [ids]);
                    await conn.query('DELETE FROM website_clients WHERE id IN (?)', [ids]);
                }
                await conn.commit();
                console.log('    done');
            } catch (e) {
                await conn.rollback();
                throw e;
            }
        } else {
            console.log('\nDry run — add --apply to write.');
        }
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        await conn.end();
    }
})();
