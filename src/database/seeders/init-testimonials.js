/**
 * Initialize Testimonials module permissions and translations
 * Usage: node src/database/seeders/init-testimonials.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');

async function init() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'admin_dashboard',
  });

  console.log('Connected to database!\n');

  try {
    // 1. Get all companies
    const [companies] = await conn.execute('SELECT id FROM companies');
    console.log(`Processing ${companies.length} companies...`);

    for (const company of companies) {
      const companyId = company.id;
      console.log(`\nCompany ID: ${companyId}`);

      // 2. Ensure Testimonials module exists
      const [modules] = await conn.execute(
        'SELECT id FROM modules WHERE slug = ? AND company_id = ?',
        ['testimonials', companyId]
      );
      
      let moduleId;
      if (modules.length === 0) {
        const [result] = await conn.execute(
          'INSERT INTO modules (name, slug, description, company_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(), NOW())',
          ['Testimonials', 'testimonials', 'Testimonial management', companyId]
        );
        moduleId = result.insertId;
        console.log('  Created module: testimonials');
      } else {
        moduleId = modules[0].id;
        console.log('  Module testimonials already exists');
      }

      // 3. Ensure permissions exist
      const perms = [
        ['View Testimonials', 'testimonials.view', 'testimonials', 'View testimonials'],
        ['Create Testimonial', 'testimonials.create', 'testimonials', 'Create testimonials'],
        ['Edit Testimonial', 'testimonials.edit', 'testimonials', 'Edit testimonials'],
        ['Delete Testimonial', 'testimonials.delete', 'testimonials', 'Delete testimonials'],
      ];

      for (const [name, slug, moduleSlug, desc] of perms) {
        const [existing] = await conn.execute(
          'SELECT id FROM permissions WHERE slug = ? AND company_id = ?',
          [slug, companyId]
        );

        if (existing.length === 0) {
          await conn.execute(
            'INSERT INTO permissions (name, slug, module, module_id, company_id, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())',
            [name, slug, moduleSlug, moduleId, companyId, desc]
          );
          console.log(`  Created permission: ${slug}`);
        } else {
          console.log(`  Permission ${slug} already exists`);
        }
      }

      // 4. Assign permissions to Super Admin role
      const [roles] = await conn.execute(
        'SELECT id FROM roles WHERE slug = ? AND company_id = ?',
        ['super_admin', companyId]
      );

      if (roles.length > 0) {
        const superAdminRoleId = roles[0].id;
        await conn.execute(
          `INSERT INTO role_permissions (role_id, permission_id, created_at, updated_at)
           SELECT ?, id, NOW(), NOW()
           FROM permissions
           WHERE company_id = ? AND slug LIKE 'testimonials%'
           ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [superAdminRoleId, companyId]
        );
        console.log('  Assigned permissions to Super Admin');
      }
    }

    // 5. Add translations
    const testimonialKeys = [
      { key: 'nav.testimonials', value: 'Testimonials', group: 'nav' },
      { key: 'testimonial.title', value: 'Testimonials', group: 'testimonial' },
      { key: 'testimonial.desc', value: 'Manage customer reviews and feedback', group: 'testimonial' },
      { key: 'testimonial.add', value: 'Add Testimonial', group: 'testimonial' },
      { key: 'testimonial.edit', value: 'Edit Testimonial', group: 'testimonial' },
      { key: 'testimonial.create', value: 'Create Testimonial', group: 'testimonial' },
      { key: 'testimonial.form_desc', value: 'Fill in the information for the testimonial.', group: 'testimonial' },
      { key: 'testimonial.designation', value: 'Designation / Company', group: 'testimonial' },
    ];

    const [languages] = await conn.execute('SELECT id, code FROM languages');

    for (const k of testimonialKeys) {
      const [existingKey] = await conn.execute('SELECT id FROM translation_keys WHERE `key` = ?', [k.key]);
      let keyId;
      if (existingKey.length === 0) {
        const [result] = await conn.execute(
          'INSERT INTO translation_keys (`key`, default_value, `group`, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
          [k.key, k.value, k.group]
        );
        keyId = result.insertId;
        console.log(`Created translation key: ${k.key}`);
      } else {
        keyId = existingKey[0].id;
        console.log(`Translation key ${k.key} already exists`);
      }

      for (const lang of languages) {
        const [existingTrans] = await conn.execute(
          'SELECT id FROM translations WHERE translation_key_id = ? AND language_id = ?',
          [keyId, lang.id]
        );

        if (existingTrans.length === 0) {
          await conn.execute(
            'INSERT INTO translations (translation_key_id, language_id, value, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
            [keyId, lang.id, k.value, lang.code === 'en' ? 'reviewed' : 'auto']
          );
        }
      }
    }

    console.log('\nSuccess! All testimonials related data initialized.');

  } catch (err) {
    console.error('Initialisation failed:', err);
  } finally {
    await conn.end();
  }
}

init();
