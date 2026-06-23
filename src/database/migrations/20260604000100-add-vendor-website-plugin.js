module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('vendors');
    if (!table.website_enabled) {
      await queryInterface.addColumn('vendors', 'website_enabled', {
        type: Sequelize.TINYINT,
        allowNull: false,
        defaultValue: 0,
        after: 'membership',
      });
    }

    await queryInterface.sequelize.query(`
      INSERT INTO plugins (slug, name, description, category, icon, is_active, config_group, config_route, company_id, created_at, updated_at)
      SELECT 'website-management', 'Website Management',
             'Enable vendor website pages, header, footer, sliders, and public website builder access.',
             'content', 'globe', 0, NULL, NULL, c.id, NOW(), NOW()
      FROM companies c
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        description = VALUES(description),
        category = VALUES(category),
        icon = VALUES(icon),
        config_group = VALUES(config_group),
        config_route = VALUES(config_route),
        updated_at = NOW()
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vendors', 'website_enabled');
    await queryInterface.sequelize.query("DELETE FROM plugins WHERE slug = 'website-management'");
  },
};
