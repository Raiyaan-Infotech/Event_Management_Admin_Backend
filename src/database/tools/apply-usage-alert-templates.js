#!/usr/bin/env node
/**
 * Creates the nine plan-usage alert templates (2026-10-19) so they show on the
 * admin's Transactional Templates list, ready to edit:
 *
 *   Storage / Photos / Videos  ×  50% Full / 75% Full / Full
 *
 * Each row is tied to its system trigger (`trigger_key`, e.g. `photos_75_full`)
 * — notificationTrigger.triggerUsageAlert sends it when an upload crosses that
 * line. Without a row the built-in wording is sent; with a row the admin's
 * title / content / channels / image are used, and an inactive row silences it.
 *
 * Re-runnable: a trigger that already has a template (even one the admin
 * edited) is left alone — this only fills the gaps. No schema change.
 *
 * Category: the notification category named "System" (else "Alert" /
 * "Alerts", else the first one) — the admin can move them afterwards.
 *
 *   node src/database/tools/apply-usage-alert-templates.js                  dry run, local
 *   node src/database/tools/apply-usage-alert-templates.js --apply          local
 *   node src/database/tools/apply-usage-alert-templates.js --prod           dry run, production
 *   node src/database/tools/apply-usage-alert-templates.js --prod --apply   production
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

const KINDS = [
    { kind: 'storage', label: 'Storage' },
    { kind: 'photos', label: 'Photos' },
    { kind: 'videos', label: 'Videos' },
];
const LEVELS = [
    { suffix: 'half_full', label: '50% Full' },
    { suffix: '75_full', label: '75% Full' },
    { suffix: 'full', label: 'Full' },
];

/** Same wording as notificationTrigger.service's built-in defaults. */
const wording = (kind, suffix) => {
    const full = suffix === 'full';
    if (kind === 'storage') {
        return full
            ? {
                title: 'Your storage is full',
                content: 'You have used all {{storage_limit}} of your storage, so new photos and videos cannot be added. Delete some media or upgrade your plan.',
            }
            : {
                title: 'Your storage is {{storage_percent}}% full',
                content: 'You have used {{storage_used}} of your {{storage_limit}} storage. Delete some media or upgrade your plan before it runs out.',
            };
    }
    return full
        ? {
            title: `Your ${kind} limit is full`,
            content: `"{{event_name}}" has used all {{usage_limit}} ${kind} on your plan, so no more can be added. Delete some or upgrade your plan.`,
        }
        : {
            title: `Your ${kind} limit is {{usage_percent}}% full`,
            content: `"{{event_name}}" has used {{usage_used}} of {{usage_limit}} ${kind} on your plan. Delete some or upgrade your plan before it runs out.`,
        };
};

const variablesIn = (title, content) => {
    const found = new Set();
    const re = /\{\{\s*(\w+)\s*\}\}/g;
    let m;
    while ((m = re.exec(`${title} ${content}`)) !== null) found.add(m[1]);
    return Array.from(found);
};

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...(PROD ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}  ${APPLY ? '(APPLY)' : '(dry run)'}\n`);

    try {
        const [cats] = await conn.query(
            'SELECT id, name, company_id FROM notification_categories WHERE deleted_at IS NULL ORDER BY id',
        );
        console.log('Notification categories:', cats.map((c) => `#${c.id} ${c.name}`).join(', ') || '(none)');
        const byName = (n) => cats.find((c) => String(c.name).trim().toLowerCase() === n);
        const category = byName('system') || byName('alert') || byName('alerts') || cats[0];
        if (!category) {
            console.log('\n✗ No notification category exists — create one in the admin first.');
            process.exitCode = 1;
            return;
        }
        console.log(`Using category #${category.id} "${category.name}"\n`);

        const [existing] = await conn.query(
            'SELECT id, name, trigger_key, deleted_at FROM notification_templates WHERE trigger_key IS NOT NULL',
        );
        const [[{ maxSort }]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) AS maxSort FROM notification_templates');

        let sort = Number(maxSort) || 0;
        let added = 0;
        for (const k of KINDS) {
            for (const l of LEVELS) {
                const key = `${k.kind}_${l.suffix}`;
                const name = `${k.label} ${l.label}`;
                const have = existing.find((r) => r.trigger_key === key);
                if (have) {
                    console.log(`  = ${key.padEnd(18)} already has #${have.id} "${have.name}"${have.deleted_at ? ' (DELETED — restore or clear its trigger in the admin)' : ''}`);
                    continue;
                }
                const { title, content } = wording(k.kind, l.suffix);
                sort += 1;
                if (!APPLY) {
                    console.log(`  + ${key.padEnd(18)} WOULD ADD "${name}" — ${title}`);
                    added += 1;
                    continue;
                }
                await conn.query(
                    `INSERT INTO notification_templates
                        (name, trigger_key, notification_category_id, event_category_id, title, content,
                         variables_used, image_url, channels, is_active, sort_order, company_id, created_at, updated_at)
                     VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, 1, ?, ?, NOW(), NOW())`,
                    [
                        name, key, category.id, title, content,
                        JSON.stringify(variablesIn(title, content)),
                        JSON.stringify(['in_app', 'push']),
                        sort,
                        category.company_id ?? 1,
                    ],
                );
                console.log(`  + ${key.padEnd(18)} added "${name}"`);
                added += 1;
            }
        }
        console.log(`\n${added} template(s) ${APPLY ? 'added' : 'would be added'}.`);
        if (!APPLY && added) console.log('Re-run with --apply to write them.');
    } finally {
        await conn.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
