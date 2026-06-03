'use strict';

const HERO_VARIANT_LABELS = [
  'Classic Premium',
  'EventPress Center',
  'Smart Study Layout',
  'Dark Luxury Stats Layout',
  'Stress-Free Events Layout',
  'Widescreen Left-Aligned Layout',
  'Widescreen Center-Aligned Layout',
  'Widescreen Right-Aligned Layout',
  'Widescreen Left-Aligned (with Button)',
  'Widescreen Center-Aligned (with Button)',
  'Widescreen Right-Aligned (with Button)',
  'Widescreen Left-Aligned (with 2 Buttons)',
  'Widescreen Center-Aligned (with 2 Buttons)',
  'Widescreen Right-Aligned (with 2 Buttons)',
  'Widescreen Left-Aligned Layout (No Title)',
  'Widescreen Center-Aligned Layout (No Title)',
  'Widescreen Right-Aligned Layout (No Title)',
  'Widescreen Left-Aligned (No Title, with Button)',
  'Widescreen Center-Aligned (No Title, with Button)',
  'Widescreen Right-Aligned (No Title, with Button)',
  'Widescreen Left-Aligned (No Title, with 2 Buttons)',
  'Widescreen Center-Aligned (No Title, with 2 Buttons)',
  'Widescreen Right-Aligned (No Title, with 2 Buttons)',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS vendor_hero_sections (
        id BIGINT NOT NULL AUTO_INCREMENT,
        vendor_id INT NOT NULL,
        company_id INT DEFAULT NULL,
        title VARCHAR(255) DEFAULT NULL,
        heading VARCHAR(255) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        button VARCHAR(100) DEFAULT NULL,
        button2 VARCHAR(100) DEFAULT NULL,
        image_url VARCHAR(500) DEFAULT NULL,
        bg_image_url VARCHAR(500) DEFAULT NULL,
        page_id INT DEFAULT NULL,
        page_id2 INT DEFAULT NULL,
        variant VARCHAR(50) NOT NULL DEFAULT 'variant_1',
        stat1_val VARCHAR(100) DEFAULT NULL,
        stat1_lbl VARCHAR(150) DEFAULT NULL,
        stat1_sub VARCHAR(150) DEFAULT NULL,
        stat2_val VARCHAR(100) DEFAULT NULL,
        stat2_lbl VARCHAR(150) DEFAULT NULL,
        stat2_sub VARCHAR(150) DEFAULT NULL,
        stat3_val VARCHAR(100) DEFAULT NULL,
        stat3_lbl VARCHAR(150) DEFAULT NULL,
        stat3_sub VARCHAR(150) DEFAULT NULL,
        is_active TINYINT NOT NULL DEFAULT 1,
        created_by INT DEFAULT NULL,
        updated_by INT DEFAULT NULL,
        deleted_by INT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY vendor_hero_sections_vendor_unique (vendor_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [existing] = await queryInterface.sequelize.query(`
      SELECT id FROM ui_blocks WHERE block_type = 'hero_section' LIMIT 1
    `);
    const values = {
      label: 'Hero Section',
      icon: 'Sparkles',
      category_id: 2,
      description: 'Configurable hero banner with text, images, page buttons, and layout variants.',
      variants: JSON.stringify(HERO_VARIANT_LABELS.map((label, index) => ({ key: `variant_${index + 1}`, label }))),
      plan_ids: JSON.stringify([1, 2, 3]),
      is_active: 1,
      updated_at: new Date(),
    };

    if (existing.length) {
      await queryInterface.bulkUpdate('ui_blocks', values, { id: existing[0].id });
    } else {
      await queryInterface.bulkInsert('ui_blocks', [{
        block_type: 'hero_section',
        ...values,
        created_at: new Date(),
      }]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('ui_blocks', { block_type: 'hero_section' });
    await queryInterface.dropTable('vendor_hero_sections');
  },
};
