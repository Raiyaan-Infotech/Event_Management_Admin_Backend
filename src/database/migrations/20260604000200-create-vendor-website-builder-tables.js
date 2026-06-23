'use strict';

const fs = require('fs');
const path = require('path');

// Tables are listed parent-first so the DROP in down() can run child-first.
const BUILDER_TABLES = [
  'vendor_websites',
  'vendor_website_basic_information',
  'vendor_website_social_links',
  'vendor_website_pages',
  'vendor_website_menu_items',
  'vendor_website_ui_blocks',
  'vendor_website_hero_sections',
  'vendor_website_sliders',
  'vendor_website_slider_items',
  'vendor_website_gallery_categories',
  'vendor_website_gallery_items',
  'vendor_website_contact_settings',
  'vendor_website_contact_social_links',
  'vendor_website_contact_categories',
  'vendor_website_contact_messages',
  'vendor_website_testimonials',
  'vendor_website_clients',
  'vendor_website_sponsors',
  'vendor_website_footer_settings',
  'vendor_website_seo_settings',
  'vendor_website_publish_snapshots',
];

const SQL_FILE = path.join(
  __dirname,
  'sql',
  '20260604000200-vendor-website-builder-tables.sql',
);

module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(SQL_FILE, 'utf8');

    // Strip line comments, then split on statement terminators.
    const statements = raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await queryInterface.sequelize.query(statement);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of [...BUILDER_TABLES].reverse()) {
        await queryInterface.sequelize.query(
          `DROP TABLE IF EXISTS \`${table}\``,
        );
      }
    } finally {
      await queryInterface.sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  },
};
