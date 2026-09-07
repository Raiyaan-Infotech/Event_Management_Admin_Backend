#!/usr/bin/env node
/**
 * Sidebar labels for the two guest-registration screens.
 *
 *   nav.guest_relationships       -> "Guest Relationships"
 *   nav.guest_food_preferences    -> "Guest Food Preferences"
 *
 * The admin sidebar renders `t(labelKey)`, and `t()` falls back to **the key
 * itself** when it has no row. Without these the menu would literally read
 * "nav.guest_relationships", so this is not decoration — it is the difference
 * between a finished menu entry and a visible bug.
 *
 * ── ENGLISH ONLY, DELIBERATELY ──────────────────────────────────────────────
 * `nav.religions` was checked first and carries exactly one row, `language_id
 * 1`. Seeding invented values for the other languages would put untranslated
 * English into a Tamil menu while REPORTING itself as translated (`status:
 * reviewed`). Left absent instead, so the Translations screen still lists them
 * as outstanding and can fill them properly.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/seeders/guest-option-nav-keys.seeder.js
 *   node src/database/seeders/guest-option-nav-keys.seeder.js --prod
 */

require('dotenv').config();
const path = require('path');

const args = process.argv.slice(2);
const PROD = args.includes('--prod') || args.includes('prod');

if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const { sequelize } = require('../../models');

const COMPANY_ID = 1;
/** English. The only language `nav.*` is populated in today — see the header. */
const LANGUAGE_ID = 1;

const KEYS = [
    { key: 'nav.guest_relationships', value: 'Guest Relationships' },
    { key: 'nav.guest_food_preferences', value: 'Guest Food Preferences' },
];

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

    let keysAdded = 0;
    let valuesAdded = 0;

    try {
        for (const { key, value } of KEYS) {
            const [found] = await sequelize.query(
                'SELECT id FROM translation_keys WHERE `key` = ? AND company_id = ? AND deleted_at IS NULL LIMIT 1',
                { replacements: [key, COMPANY_ID] },
            );

            let keyId;
            if (found.length) {
                keyId = found[0].id;
                console.log(`  = key    ${key} (id ${keyId})`);
            } else {
                const [res] = await sequelize.query(
                    `INSERT INTO translation_keys (\`key\`, company_id, default_value, \`group\`, created_at, updated_at)
                     VALUES (?, ?, ?, 'nav', NOW(), NOW())`,
                    { replacements: [key, COMPANY_ID, value] },
                );
                keyId = res.insertId ?? res;
                keysAdded += 1;
                console.log(`  + key    ${key} (id ${keyId})`);
            }

            const [hasValue] = await sequelize.query(
                `SELECT id FROM translations
                  WHERE translation_key_id = ? AND language_id = ? AND deleted_at IS NULL LIMIT 1`,
                { replacements: [keyId, LANGUAGE_ID] },
            );

            if (hasValue.length) {
                console.log(`    = value  "${value}"`);
            } else {
                await sequelize.query(
                    `INSERT INTO translations
                       (company_id, translation_key_id, language_id, value, status, is_active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 'reviewed', 1, NOW(), NOW())`,
                    { replacements: [COMPANY_ID, keyId, LANGUAGE_ID, value] },
                );
                valuesAdded += 1;
                console.log(`    + value  "${value}"`);
            }
        }

        console.log(`\n  ${keysAdded} keys, ${valuesAdded} values added.`);
        console.log('  (a second run should report 0, 0)\n');
    } catch (err) {
        console.error('\nFAILED:', err.message, '\n');
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
