#!/usr/bin/env node
/**
 * RBAC rows for the two guest-registration option screens.
 *
 *   modules            guest_relationship_options, guest_food_preference_options
 *   permissions        .view / .create / .edit / .delete for each
 *   role_permissions   granted to the roles that already hold event_categories.*
 *
 * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────────
 * Every route on both resources sits behind `hasPermission('<slug>.<action>')`,
 * and the admin sidebar hides an entry whose `.view` permission is missing. So
 * without these rows the screens are not merely unauthorised — they are
 * invisible, and the API answers 403 to the person who owns the system.
 *
 * ── ROLES ARE MIRRORED, NOT HARDCODED ───────────────────────────────────────
 * The grant follows whichever roles currently hold the matching
 * `event_categories.<action>` permission rather than naming role ids. Those two
 * lists should not drift: somebody who may edit the event taxonomy is exactly
 * who may edit the dropdowns hanging off it, and a hardcoded id would be wrong
 * the moment a role is added or renamed. (Locally: Super Admin and Admin.)
 *
 * ── ⚠ `requires_approval` IS COPIED PER ACTION, NOT DEFAULTED ───────────────
 * The two roles are deliberately not alike:
 *
 *   role 2  Super Admin   all four actions, requires_approval = 0
 *   role 3  Admin         view = 0, create/edit/delete = 1 -> approval queue
 *
 * So the flag is read from the event_categories row for the SAME action and
 * copied. Defaulting it to 0 would hand Admin unreviewed write access to a
 * module its sibling gates — a hole, not a convenience — and it would do so
 * silently, because nothing fails when an approval step is simply absent.
 *
 * The Developer role is deliberately not special-cased — it is level 1000 and
 * bypasses permission checks, so granting it rows would be noise.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/seeders/guest-option-permissions.seeder.js
 *   node src/database/seeders/guest-option-permissions.seeder.js --prod
 *
 * Re-runnable: everything is matched before it is inserted, so a second run
 * reports zeros rather than duplicating a grant.
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

const MODULES = [
    {
        slug: 'guest_relationship_options',
        name: 'Guest Relationships',
        description: 'Manage the "Relationship with Invitor" dropdown',
        label: 'Guest Relationships',
    },
    {
        slug: 'guest_food_preference_options',
        name: 'Guest Food Preferences',
        description: 'Manage the "Food Preference" dropdown',
        label: 'Guest Food Preferences',
    },
];

const ACTIONS = [
    { action: 'view', verb: 'View', desc: 'View' },
    { action: 'create', verb: 'Create', desc: 'Create new' },
    { action: 'edit', verb: 'Edit', desc: 'Edit existing' },
    { action: 'delete', verb: 'Delete', desc: 'Delete' },
];

const one = async (sql, replacements = []) => {
    const [rows] = await sequelize.query(sql, { replacements });
    return rows[0] ?? null;
};

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}\n`);

    let modulesAdded = 0;
    let permsAdded = 0;
    let grantsAdded = 0;

    try {
        /**
         * The template: every event_categories grant, keyed by action, carrying
         * its own `requires_approval`. Read live rather than assumed — see the
         * header for why the flag must not be defaulted.
         */
        const [templateRows] = await sequelize.query(
            `SELECT SUBSTRING_INDEX(p.slug, '.', -1) AS action,
                    rp.role_id,
                    rp.requires_approval
               FROM role_permissions rp
               JOIN permissions p ON p.id = rp.permission_id
              WHERE p.slug LIKE 'event_categories.%' AND rp.deleted_at IS NULL`,
        );

        const template = templateRows.reduce((acc, r) => {
            (acc[r.action] ||= []).push({ roleId: r.role_id, requiresApproval: r.requires_approval });
            return acc;
        }, {});

        if (!templateRows.length) {
            console.log('  ! No event_categories grants found — permissions will be created');
            console.log('    but granted to nobody. Check this database is seeded.\n');
        } else {
            console.log('  Mirroring event_categories grants:');
            for (const act of ACTIONS) {
                const t = template[act.action] ?? [];
                console.log(
                    `    ${act.action.padEnd(7)} ${t.map((x) => `role ${x.roleId}(approval=${x.requiresApproval})`).join(', ') || '(none)'}`,
                );
            }
            console.log('');
        }

        for (const mod of MODULES) {
            let module = await one(
                'SELECT id FROM modules WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
                [mod.slug],
            );

            if (module) {
                console.log(`  = module  ${mod.slug} (id ${module.id})`);
            } else {
                const [res] = await sequelize.query(
                    `INSERT INTO modules (name, slug, description, company_id, is_active, created_at, updated_at)
                     VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
                    { replacements: [mod.name, mod.slug, mod.description, COMPANY_ID] },
                );
                module = { id: res.insertId ?? res };
                modulesAdded += 1;
                console.log(`  + module  ${mod.slug} (id ${module.id})`);
            }

            for (const act of ACTIONS) {
                const slug = `${mod.slug}.${act.action}`;

                let perm = await one(
                    'SELECT id FROM permissions WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
                    [slug],
                );

                if (perm) {
                    console.log(`    = perm  ${slug} (id ${perm.id})`);
                } else {
                    const [res] = await sequelize.query(
                        `INSERT INTO permissions
                           (name, slug, company_id, module_id, module, description, is_active, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
                        {
                            replacements: [
                                `${act.verb} ${mod.label}`,
                                slug,
                                COMPANY_ID,
                                module.id,
                                mod.slug,
                                `${act.desc} ${mod.label.toLowerCase()}`,
                            ],
                        },
                    );
                    perm = { id: res.insertId ?? res };
                    permsAdded += 1;
                    console.log(`    + perm  ${slug} (id ${perm.id})`);
                }

                for (const { roleId, requiresApproval } of template[act.action] ?? []) {
                    const existing = await one(
                        `SELECT id FROM role_permissions
                          WHERE role_id = ? AND permission_id = ? AND deleted_at IS NULL LIMIT 1`,
                        [roleId, perm.id],
                    );
                    if (existing) continue;

                    await sequelize.query(
                        `INSERT INTO role_permissions
                           (role_id, permission_id, company_id, requires_approval, created_at, updated_at)
                         VALUES (?, ?, ?, ?, NOW(), NOW())`,
                        { replacements: [roleId, perm.id, COMPANY_ID, requiresApproval] },
                    );
                    grantsAdded += 1;
                }
            }
        }

        console.log(`\n  ${modulesAdded} modules, ${permsAdded} permissions, ${grantsAdded} grants added.`);
        console.log('  (a second run should report 0, 0, 0)\n');
    } catch (err) {
        console.error('\nFAILED:', err.message, '\n');
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
