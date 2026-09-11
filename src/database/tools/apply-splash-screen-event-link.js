#!/usr/bin/env node
/**
 * `splash_screens` grows `event_id` — the real link between a saved splash and
 * the event it belongs to.
 *
 * ── WHY THIS REPLACES THE TYPED EVENT NAME ───────────────────────────────────
 * The module shipped with `event_name` as free text a client types, on the
 * explicit understanding that linking to a real `events` row was a later phase
 * (see the SplashScreen model header and splash-form.tsx). That phase is this
 * one: the mobile app has to answer "which splash do I show for THIS event?",
 * and a typed string cannot answer it. None of the existing rows' names match
 * a real event, so there is nothing to match on — the link has to be explicit.
 *
 * ── ONE EVENT, ONE SPLASH ───────────────────────────────────────────────────
 * UNIQUE on `event_id`, chosen deliberately: the app's read is then a single
 * unambiguous lookup with no "which one wins?" rule to keep in sync between
 * the portal and the app. The `status` enum ('draft','active') still decides
 * whether guests see it, so a client can build one without publishing it.
 *
 * ── NULLABLE, AND WHY THAT IS NOT A LOOSE END ───────────────────────────────
 * The column is NULL-able even though the portal form will require it from now
 * on. The rows already saved have no event to point at, and MySQL's UNIQUE
 * index permits many NULLs — so they survive as unlinked drafts instead of
 * being deleted or, worse, guessed into the wrong event.
 *
 * `event_name` is deliberately LEFT IN PLACE. It is NOT NULL today, the
 * service populates it from the chosen event going forward, and dropping it
 * would break every existing row for no gain.
 *
 * ON DELETE SET NULL, not CASCADE: deleting an event should not silently take
 * a design the client built with it. The splash reverts to unlinked, and they
 * can point it at another event or delete it themselves.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/tools/apply-splash-screen-event-link.js
 *   node src/database/tools/apply-splash-screen-event-link.js --apply
 *   node src/database/tools/apply-splash-screen-event-link.js --prod --apply
 *
 * Dry runs by default; `--prod` dry-runs too until `--apply` is added.
 */

require('dotenv').config();
const path = require('path');
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod') || args.includes('prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const TABLE = 'splash_screens';
const COLUMN = 'event_id';
const INDEX = 'uq_splash_screens_event_id';
const FK = 'fk_splash_screens_event';

async function hasColumn(conn) {
    const [rows] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [process.env.DB_NAME, TABLE, COLUMN],
    );
    return rows.length > 0;
}

async function hasIndex(conn, name) {
    const [rows] = await conn.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [process.env.DB_NAME, TABLE, name],
    );
    return rows.length > 0;
}

async function hasConstraint(conn, name) {
    const [rows] = await conn.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [process.env.DB_NAME, TABLE, name],
    );
    return rows.length > 0;
}

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    try {
        // ── The column ──────────────────────────────────────────────────────
        // INT UNSIGNED to match `events.id` exactly. A signedness mismatch is
        // what makes MySQL refuse the foreign key with errno 150 and no
        // useful explanation.
        let columnExists = await hasColumn(conn);
        if (columnExists) {
            console.log(`  = ${COLUMN.padEnd(32)} already present`);
        } else if (!APPLY) {
            console.log(`  + ${COLUMN.padEnd(32)} WOULD ADD  (int unsigned NULL, after event_name)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD COLUMN \`${COLUMN}\` INT UNSIGNED NULL AFTER \`event_name\``,
            );
            console.log(`  + ${COLUMN.padEnd(32)} added`);
            columnExists = true;
        }

        // ── Duplicate check, BEFORE the unique index ────────────────────────
        // Nothing can be duplicated on a column that was just created, but on
        // a re-run against a DB where rows were already linked by hand, adding
        // UNIQUE would fail with a bare "Duplicate entry". Naming the offending
        // events is far more useful than that error.
        if (columnExists && !(await hasIndex(conn, INDEX))) {
            const [dupes] = await conn.query(
                `SELECT \`${COLUMN}\` AS event_id, COUNT(*) AS n
                   FROM \`${TABLE}\`
                  WHERE \`${COLUMN}\` IS NOT NULL AND deleted_at IS NULL
                  GROUP BY \`${COLUMN}\` HAVING n > 1`,
            );
            if (dupes.length) {
                console.log('\n  ! Cannot add the UNIQUE index — these events have more than one splash:');
                dupes.forEach((d) => console.log(`      event_id=${d.event_id}  ${d.n} rows`));
                console.log('    Resolve those first (keep one, unlink or delete the rest).\n');
                return;
            }
        }

        // ── One event, one splash ───────────────────────────────────────────
        if (await hasIndex(conn, INDEX)) {
            console.log(`  = ${INDEX.padEnd(32)} already present`);
        } else if (!columnExists) {
            console.log(`  · ${INDEX.padEnd(32)} needs the column first (dry run)`);
        } else if (!APPLY) {
            console.log(`  + ${INDEX.padEnd(32)} WOULD ADD  (unique)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\` ADD UNIQUE KEY \`${INDEX}\` (\`${COLUMN}\`)`,
            );
            console.log(`  + ${INDEX.padEnd(32)} added`);
        }

        // ── The foreign key ────────────────────────────────────────────────
        if (await hasConstraint(conn, FK)) {
            console.log(`  = ${FK.padEnd(32)} already present`);
        } else if (!columnExists) {
            console.log(`  · ${FK.padEnd(32)} needs the column first (dry run)`);
        } else if (!APPLY) {
            console.log(`  + ${FK.padEnd(32)} WOULD ADD  (-> events.id, ON DELETE SET NULL)`);
        } else {
            await conn.query(
                `ALTER TABLE \`${TABLE}\`
                   ADD CONSTRAINT \`${FK}\` FOREIGN KEY (\`${COLUMN}\`)
                   REFERENCES \`events\` (\`id\`)
                   ON DELETE SET NULL ON UPDATE CASCADE`,
            );
            console.log(`  + ${FK.padEnd(32)} added`);
        }

        // ── Soft-deleted rows still holding an event ───────────────────────
        // `splash_screens` is paranoid, so a deleted splash keeps its row —
        // and its `event_id` under the UNIQUE index, which blocks that event
        // from ever getting a new splash. The service now unlinks on delete;
        // this clears the rows deleted before it did.
        if (columnExists) {
            const [[{ n: held }]] = await conn.query(
                `SELECT COUNT(*) AS n FROM \`${TABLE}\`
                  WHERE \`${COLUMN}\` IS NOT NULL AND deleted_at IS NOT NULL`,
            );
            if (!held) {
                console.log(`  = ${'deleted rows unlinked'.padEnd(32)} none holding an event`);
            } else if (!APPLY) {
                console.log(`  + ${'deleted rows unlinked'.padEnd(32)} WOULD CLEAR event_id on ${held}`);
            } else {
                await conn.query(
                    `UPDATE \`${TABLE}\` SET \`${COLUMN}\` = NULL
                      WHERE \`${COLUMN}\` IS NOT NULL AND deleted_at IS NOT NULL`,
                );
                console.log(`  + ${'deleted rows unlinked'.padEnd(32)} cleared event_id on ${held}`);
            }
        }

        // ── What is left unlinked ──────────────────────────────────────────
        if (columnExists) {
            const [[{ n }]] = await conn.query(
                `SELECT COUNT(*) AS n FROM \`${TABLE}\`
                  WHERE \`${COLUMN}\` IS NULL AND deleted_at IS NULL`,
            );
            console.log(`\n  ${n} existing splash ${n === 1 ? 'row is' : 'rows are'} unlinked (event_id IS NULL).`);
            console.log('  Left alone on purpose — their typed event names match no real event,');
            console.log('  so assigning them would be guesswork. Attach or delete them in the portal.');
        }

        console.log('');
    } finally {
        await conn.end();
    }
})().catch((err) => {
    console.error('\nFAILED:', err.message, '\n');
    process.exit(1);
});
