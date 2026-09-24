/**
 * Split the phone book out of `event_guests` into `guests` (§581).
 *
 * ── THE MODEL ────────────────────────────────────────────────────────────────
 *   guests          the client's phone book — the people they know, in groups.
 *                   An invitation is SHARED with them; sharing writes nothing.
 *   event_guests    PARTICIPANTS — people attending ONE event, mostly by
 *                   scanning its QR. `guest_id` links a participant to the
 *                   guest they are, when their mobile matches. A stranger who
 *                   scanned has none, and is no less a participant.
 *
 * `event_guests` keeps its ids: event_messages, the RSVP response log,
 * notifications and check-ins all point at them, which is why §501 refused to
 * move participants into a new table. It is the phone book that moves.
 *
 * Host notes, tags and reminders are about the PERSON, so they hang off
 * `guests`. Their old `guest_id` (which pointed at event_guests) is renamed
 * `participant_id` and kept — nothing is dropped, so no note is lost.
 *
 * ── RE-RUNNABLE, AND CONVERTS THE EARLIER LOCAL RUN ──────────────────────────
 * An earlier version named the table `client_contacts` and the link
 * `contact_id`. Every step checks before it acts, and a local database in that
 * state is renamed in place. Production has neither, and is created directly.
 *
 *   node src/database/tools/apply-guests-split.js                  local, dry run
 *   node src/database/tools/apply-guests-split.js --apply          local
 *   node src/database/tools/apply-guests-split.js --prod --apply   production
 *
 * On production the rows it moves are written to ../_prod_backups first.
 * Set-based statements throughout — production is ~374ms a round trip.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PROD = process.argv.includes('--prod');
const APPLY = process.argv.includes('--apply');
const target = PROD ? 'production' : 'local';

const parseEnv = (file) => {
    const out = {};
    if (!fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
};

const GUESTS_DDL = `
CREATE TABLE IF NOT EXISTS \`guests\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`website_client_id\` int unsigned NOT NULL,
  \`company_id\` int DEFAULT NULL,
  \`group_id\` int unsigned DEFAULT NULL,
  \`title\` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`first_name\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`last_name\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`name\` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  \`date_of_birth\` date DEFAULT NULL,
  \`gender\` enum('male','female','other') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`email\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`dial_code\` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT '+91',
  \`mobile\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`whatsapp\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`company\` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`relationship\` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`relationship_option_id\` int unsigned DEFAULT NULL,
  \`address_line1\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`address_line2\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`city\` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`state\` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`postal_code\` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`country\` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT 'India',
  \`dietary_preference\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`food_preference_option_id\` int unsigned DEFAULT NULL,
  \`special_requirements\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`notes\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`photo\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  \`source\` enum('manual','import') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  \`migrated_from_guest_id\` int unsigned DEFAULT NULL COMMENT 'event_guests.id this row was moved from (§581)',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`deleted_at\` datetime DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_guests_client\` (\`website_client_id\`,\`deleted_at\`),
  KEY \`idx_guests_mobile\` (\`website_client_id\`,\`mobile\`),
  KEY \`idx_guests_group\` (\`group_id\`,\`deleted_at\`),
  KEY \`idx_guests_migrated\` (\`migrated_from_guest_id\`),
  CONSTRAINT \`fk_guests_client\` FOREIGN KEY (\`website_client_id\`) REFERENCES \`website_clients\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_guests_group\` FOREIGN KEY (\`group_id\`) REFERENCES \`event_guest_groups\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT \`fk_guests_relationship_option\` FOREIGN KEY (\`relationship_option_id\`) REFERENCES \`guest_relationship_options\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT \`fk_guests_food_option\` FOREIGN KEY (\`food_preference_option_id\`) REFERENCES \`guest_food_preference_options\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='The client phone book (§581). Participants live in event_guests.'`;

// Columns copied from a phone-book event_guests row into guests.
const PERSON_COLUMNS = [
    'website_client_id', 'company_id', 'group_id', 'title', 'first_name', 'last_name', 'name',
    'date_of_birth', 'gender', 'email', 'dial_code', 'mobile', 'whatsapp', 'company',
    'relationship', 'relationship_option_id', 'address_line1', 'address_line2', 'city', 'state',
    'postal_code', 'country', 'dietary_preference', 'food_preference_option_id',
    'special_requirements', 'notes', 'photo', 'created_at', 'updated_at', 'deleted_at',
];

const CHILD_TABLES = ['event_guest_notes', 'event_guest_tags', 'event_guest_reminders'];

(async () => {
    const env = PROD
        ? parseEnv('.env.production')
        : {
            DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_USER: process.env.DB_USER,
            DB_PASSWORD: process.env.DB_PASS ?? process.env.DB_PASSWORD, DB_NAME: process.env.DB_NAME, DB_SSL: 'false',
        };

    const conn = await mysql.createConnection({
        host: env.DB_HOST, port: env.DB_PORT || 3306, user: env.DB_USER,
        password: env.DB_PASSWORD, database: env.DB_NAME,
        ssl: env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });
    const q = async (sql, params) => (await conn.query(sql, params))[0];
    const say = (msg) => console.log(`[${target}${APPLY ? '' : ' · dry run'}] ${msg}`);

    const tableExists = async (t) =>
        (await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [env.DB_NAME, t])).length > 0;
    const column = async (t, c) =>
        (await q('SELECT IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [env.DB_NAME, t, c]))[0];
    const fkExists = async (t, name) =>
        (await q(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`, [env.DB_NAME, t, name])).length > 0;
    const indexExists = async (t, name) =>
        (await q('SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?', [env.DB_NAME, t, name])).length > 0;
    const run = async (label, sql, params) => {
        if (!APPLY) { say(`would: ${label}`); return null; }
        const res = await q(sql, params);
        say(`${label}${res && res.affectedRows !== undefined ? ` — ${res.affectedRows} row(s)` : ''}`);
        return res;
    };

    /** Rename an FK: MySQL cannot rename a constraint in place, so drop and re-add. */
    const renameFk = async (table, from, to, addSql) => {
        if (await fkExists(table, to)) return;
        if (await fkExists(table, from)) await run(`${table}: drop ${from}`, `ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${from}\``);
        await run(`${table}: add ${to}`, `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${to}\` ${addSql}`);
    };
    const renameIndex = async (table, from, to) => {
        if (await indexExists(table, to) || !(await indexExists(table, from))) return;
        await run(`${table}: rename index ${from} → ${to}`, `ALTER TABLE \`${table}\` RENAME INDEX \`${from}\` TO \`${to}\``);
    };

    // ── 1. the guests table ─────────────────────────────────────────────────
    const legacy = await tableExists('client_contacts');
    if (await tableExists('guests')) say('guests already exists');
    else if (legacy) {
        await run('rename client_contacts → guests', 'RENAME TABLE `client_contacts` TO `guests`');
    } else {
        await run('create guests', GUESTS_DDL);
    }
    if (APPLY || (await tableExists('guests'))) {
        for (const [from, to] of [
            ['idx_client_contacts_client', 'idx_guests_client'], ['idx_client_contacts_mobile', 'idx_guests_mobile'],
            ['idx_client_contacts_group', 'idx_guests_group'], ['idx_client_contacts_migrated', 'idx_guests_migrated'],
        ]) await renameIndex('guests', from, to);
        const fks = [
            ['fk_client_contacts_client', 'fk_guests_client', 'FOREIGN KEY (`website_client_id`) REFERENCES `website_clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE'],
            ['fk_client_contacts_group', 'fk_guests_group', 'FOREIGN KEY (`group_id`) REFERENCES `event_guest_groups` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'],
            ['fk_client_contacts_relationship_option', 'fk_guests_relationship_option', 'FOREIGN KEY (`relationship_option_id`) REFERENCES `guest_relationship_options` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'],
            ['fk_client_contacts_food_option', 'fk_guests_food_option', 'FOREIGN KEY (`food_preference_option_id`) REFERENCES `guest_food_preference_options` (`id`) ON DELETE SET NULL ON UPDATE CASCADE'],
        ];
        for (const [from, to, sql] of fks) if (APPLY) await renameFk('guests', from, to, sql);
    }

    // ── 2. event_guests.guest_id — the guest a participant is ───────────────
    if (await column('event_guests', 'guest_id')) say('event_guests.guest_id already exists');
    else if (await column('event_guests', 'contact_id')) {
        if (APPLY && await fkExists('event_guests', 'fk_event_guests_contact')) {
            await run('event_guests: drop fk_event_guests_contact', 'ALTER TABLE `event_guests` DROP FOREIGN KEY `fk_event_guests_contact`');
        }
        await run('event_guests.contact_id → guest_id', "ALTER TABLE `event_guests` RENAME COLUMN `contact_id` TO `guest_id`");
    } else {
        await run('add event_guests.guest_id',
            "ALTER TABLE `event_guests` ADD COLUMN `guest_id` int unsigned DEFAULT NULL COMMENT 'The phone-book guest this participant is (§581)' AFTER `website_client_id`");
    }
    await renameIndex('event_guests', 'idx_event_guests_contact', 'idx_event_guests_guest');
    if (APPLY && !(await indexExists('event_guests', 'idx_event_guests_guest'))) {
        await run('event_guests: index guest_id', 'ALTER TABLE `event_guests` ADD KEY `idx_event_guests_guest` (`guest_id`,`deleted_at`)');
    }
    if (APPLY) {
        await renameFk('event_guests', 'fk_event_guests_contact', 'fk_event_guests_guest',
            'FOREIGN KEY (`guest_id`) REFERENCES `guests` (`id`) ON DELETE SET NULL ON UPDATE CASCADE');
        await run('event_guests.guest_id comment',
            "ALTER TABLE `event_guests` MODIFY `guest_id` int unsigned DEFAULT NULL COMMENT 'The phone-book guest this participant is (§581)'");
    }

    // ── 3. host notes / tags / reminders belong to the guest ────────────────
    // Their old `guest_id` pointed at event_guests: it becomes `participant_id`
    // and is KEPT. Then `guest_id` is the phone-book guest.
    for (const t of CHILD_TABLES) {
        // 1) the OLD guest_id (→ event_guests) becomes participant_id
        if (!(await column(t, 'participant_id')) && (await column(t, 'guest_id'))) {
            await run(`${t}.guest_id → participant_id`,
                `ALTER TABLE \`${t}\` RENAME COLUMN \`guest_id\` TO \`participant_id\``);
        }
        // 2) guest_id is the phone-book guest: the earlier local run called it
        //    contact_id; production has neither yet.
        if (await column(t, 'contact_id')) {
            await run(`${t}.contact_id → guest_id`, `ALTER TABLE \`${t}\` RENAME COLUMN \`contact_id\` TO \`guest_id\``);
        } else if (APPLY && !(await column(t, 'guest_id'))) {
            await run(`add ${t}.guest_id`,
                `ALTER TABLE \`${t}\` ADD COLUMN \`guest_id\` int unsigned DEFAULT NULL AFTER \`participant_id\``);
        }
        const p = await column(t, 'participant_id');
        if (p && p.IS_NULLABLE === 'NO') {
            await run(`${t}.participant_id nullable`, `ALTER TABLE \`${t}\` MODIFY \`participant_id\` int unsigned NULL`);
        }
    }

    if (APPLY) {
        // Tidy names + the indexes each table needs on its new guest_id.
        await renameIndex('event_guest_notes', 'idx_guest_notes_guest', 'idx_guest_notes_participant');
        await renameIndex('event_guest_notes', 'idx_guest_notes_pinned', 'idx_guest_notes_participant_pinned');
        await renameIndex('event_guest_notes', 'idx_event_guest_notes_contact', 'idx_guest_notes_guest');
        await renameIndex('event_guest_reminders', 'idx_guest_reminders_guest', 'idx_guest_reminders_participant');
        await renameIndex('event_guest_reminders', 'idx_event_guest_reminders_contact', 'idx_guest_reminders_guest');
        await renameIndex('event_guest_tags', 'idx_event_guest_tags_contact', 'idx_guest_tags_guest');
        await renameIndex('event_guest_tags', 'uniq_guest_tag', 'uniq_participant_tag');

        const addKey = async (t, name, cols) => {
            if (!(await indexExists(t, name))) await run(`${t}: index ${name}`, `ALTER TABLE \`${t}\` ADD KEY \`${name}\` (${cols})`);
        };
        await addKey('event_guest_notes', 'idx_guest_notes_guest', '`guest_id`,`deleted_at`');
        await addKey('event_guest_notes', 'idx_guest_notes_pinned', '`guest_id`,`is_pinned`,`created_at`');
        await addKey('event_guest_reminders', 'idx_guest_reminders_guest', '`guest_id`,`deleted_at`');
        await addKey('event_guest_tags', 'idx_guest_tags_guest', '`guest_id`');
        if (!(await indexExists('event_guest_tags', 'uniq_guest_tag'))) {
            await run('event_guest_tags: unique (guest_id,label,deleted_at)',
                'ALTER TABLE `event_guest_tags` ADD UNIQUE KEY `uniq_guest_tag` (`guest_id`,`label`,`deleted_at`)');
        }

        for (const [t, short] of [['event_guest_notes', 'guest_notes'], ['event_guest_tags', 'guest_tags'], ['event_guest_reminders', 'guest_reminders']]) {
            // The OLD constraint (participant_id → event_guests) is still called
            // fk_<short>_guest. Rename it out of the way, then name the new one.
            const oldName = `fk_${short}_guest`;
            const partName = `fk_${short}_participant`;
            const legacyName = `fk_event_${short}_contact`;
            if (!(await fkExists(t, partName)) && await fkExists(t, oldName)) {
                await run(`${t}: drop ${oldName}`, `ALTER TABLE \`${t}\` DROP FOREIGN KEY \`${oldName}\``);
                await run(`${t}: add ${partName}`,
                    `ALTER TABLE \`${t}\` ADD CONSTRAINT \`${partName}\` FOREIGN KEY (\`participant_id\`) REFERENCES \`event_guests\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
            }
            if (await fkExists(t, legacyName)) {
                await run(`${t}: drop ${legacyName}`, `ALTER TABLE \`${t}\` DROP FOREIGN KEY \`${legacyName}\``);
            }
            if (!(await fkExists(t, oldName))) {
                await run(`${t}: add ${oldName} (guest_id → guests)`,
                    `ALTER TABLE \`${t}\` ADD CONSTRAINT \`${oldName}\` FOREIGN KEY (\`guest_id\`) REFERENCES \`guests\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`);
            }
        }
    }

    // ── 4. move phone-book rows out of event_guests ─────────────────────────
    const phoneBook = await q('SELECT * FROM `event_guests` WHERE `event_id` IS NULL');
    say(`phone-book rows still in event_guests: ${phoneBook.length}`);

    if (phoneBook.length && APPLY) {
        if (PROD) {
            const dir = path.resolve(__dirname, '../../../../_prod_backups');
            fs.mkdirSync(dir, { recursive: true });
            const ids = phoneBook.map((r) => r.id);
            const file = path.join(dir, `prod-guests-split-${Date.now()}.json`);
            fs.writeFileSync(file, JSON.stringify({
                taken_at: new Date().toISOString(),
                event_guests: phoneBook,
                ...Object.fromEntries(await Promise.all(CHILD_TABLES.map(async (t) =>
                    [t, await q(`SELECT * FROM \`${t}\` WHERE participant_id IN (?)`, [ids])]))),
            }, null, 1));
            say(`backup written: ${file}`);
        }

        await conn.beginTransaction();
        try {
            const cols = PERSON_COLUMNS.map((c) => `\`${c}\``).join(', ');
            await run('copy phone-book rows into guests',
                `INSERT INTO \`guests\` (${cols}, \`source\`, \`migrated_from_guest_id\`)
                 SELECT ${cols}, IF(\`invite_source\` = 'import', 'import', 'manual'), \`id\`
                 FROM \`event_guests\` e
                 WHERE e.\`event_id\` IS NULL
                   AND NOT EXISTS (SELECT 1 FROM \`guests\` g WHERE g.\`migrated_from_guest_id\` = e.\`id\`)`);
            for (const t of CHILD_TABLES) {
                await run(`re-point ${t} to the guest`,
                    `UPDATE \`${t}\` x JOIN \`guests\` g ON g.\`migrated_from_guest_id\` = x.\`participant_id\`
                     SET x.\`guest_id\` = g.\`id\`, x.\`participant_id\` = NULL`);
            }
            await run('remove moved rows from event_guests',
                'DELETE e FROM `event_guests` e JOIN `guests` g ON g.`migrated_from_guest_id` = e.`id` WHERE e.`event_id` IS NULL');
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        }
    }

    // ── 5. link participants to the guest they are (last 10 digits of mobile)
    if (await tableExists('guests') && await column('event_guests', 'guest_id')) {
        const match = `\`guests\` g ON g.\`website_client_id\` = p.\`website_client_id\` AND g.\`deleted_at\` IS NULL
              AND RIGHT(REGEXP_REPLACE(g.\`mobile\`, '[^0-9]', ''), 10) = RIGHT(REGEXP_REPLACE(p.\`mobile\`, '[^0-9]', ''), 10)`;
        const [{ n }] = await q(
            `SELECT COUNT(*) n FROM \`event_guests\` p JOIN ${match}
              WHERE p.\`guest_id\` IS NULL AND p.\`mobile\` IS NOT NULL AND g.\`mobile\` IS NOT NULL`);
        say(`participants that match a guest by mobile: ${n}`);
        if (Number(n) > 0) {
            await run('link participants to guests',
                `UPDATE \`event_guests\` p JOIN ${match} SET p.\`guest_id\` = g.\`id\`
                  WHERE p.\`guest_id\` IS NULL AND p.\`mobile\` IS NOT NULL AND g.\`mobile\` IS NOT NULL`);
        }
    }

    // ── 6. a participant always has an event ────────────────────────────────
    const ev = await column('event_guests', 'event_id');
    const [{ left }] = await q('SELECT COUNT(*) `left` FROM `event_guests` WHERE `event_id` IS NULL');
    if (ev.IS_NULLABLE === 'NO') say('event_guests.event_id already NOT NULL');
    else if (Number(left) > 0 && APPLY) say(`⚠ ${left} row(s) still have no event — event_id left nullable`);
    else {
        await run('event_guests.event_id NOT NULL',
            "ALTER TABLE `event_guests` MODIFY `event_id` int unsigned NOT NULL COMMENT 'The event this participant joined (§581)'");
    }

    if (await tableExists('guests')) {
        const [c] = await q('SELECT COUNT(*) guests, SUM(deleted_at IS NULL) live FROM `guests`');
        // Tolerates a dry run on a database still using the earlier column name.
        const link = (await column('event_guests', 'guest_id')) ? 'guest_id' : 'contact_id';
        const [g] = await q(`SELECT COUNT(*) participants, SUM(${link} IS NOT NULL) linked FROM \`event_guests\``);
        say(`now: guests ${c.guests} (live ${c.live || 0}) · participants ${g.participants} (linked to a guest ${g.linked || 0})`);
    }
    await conn.end();
})().catch((err) => { console.error(err.message); process.exit(1); });
