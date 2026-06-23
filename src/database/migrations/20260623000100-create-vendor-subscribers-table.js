'use strict';

const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(
  __dirname,
  'sql',
  '20260623-vendor-subscribers.sql',
);

module.exports = {
  async up(queryInterface) {
    const raw = fs.readFileSync(SQL_FILE, 'utf8');

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
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS `vendor_subscribers`');
  },
};
