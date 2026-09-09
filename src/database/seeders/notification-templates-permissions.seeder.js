#!/usr/bin/env node
/**
 * RBAC rows for the Notification Templates admin screen.
 *
 *   modules            notification_templates
 *   permissions        .view / .create / .edit / .delete
 *   role_permissions   granted to whichever roles hold event_categories.*
 *
 * Every route in `notificationTemplate.routes.js` sits behind
 * `hasPermission('notification_templates.<action>')`, and the admin sidebar
 * hides an entry whose `.view` permission is missing — so without these rows
 * the screen is invisible and the API answers 403 to the person who owns the
 * system. See guest-option-permissions.seeder.js for the pattern this copies:
 * `requires_approval` is read from the matching event_categories grant and
 * copied per action rather than defaulted, so Admin doesn't silently gain
 * unreviewed write access to a module its sibling gates.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node src/database/seeders/notification-templates-permissions.seeder.js
 *   node src/database/seeders/notification-templates-permissions.seeder.js --prod
 *
 * Re-runnable: everything is matched before it is inserted.
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

const MODULE = {
    slug: 'notification_templates',
    name: 'Notification Templates',
    description: 'Manage transactional notification templates',
    label: 'Notification Templates',
};

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

        let module = await one(
            'SELECT id FROM modules WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
            [MODULE.slug],
        );

        if (module) {
            console.log(`  = module  ${MODULE.slug} (id ${module.id})`);
        } else {
            const [res] = await sequelize.query(
                `INSERT INTO modules (name, slug, description, company_id, is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
                { replacements: [MODULE.name, MODULE.slug, MODULE.description, COMPANY_ID] },
            );
            module = { id: res.insertId ?? res };
            modulesAdded += 1;
            console.log(`  + module  ${MODULE.slug} (id ${module.id})`);
        }

        for (const act of ACTIONS) {
            const slug = `${MODULE.slug}.${act.action}`;

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
                            `${act.verb} ${MODULE.label}`,
                            slug,
                            COMPANY_ID,
                            module.id,
                            MODULE.slug,
                            `${act.desc} ${MODULE.label.toLowerCase()}`,
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

        console.log(`\n  ${modulesAdded} modules, ${permsAdded} permissions, ${grantsAdded} grants added.`);
        console.log('  (a second run should report 0, 0, 0)\n');
    } catch (err) {
        console.error('\nFAILED:', err.message, '\n');
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
