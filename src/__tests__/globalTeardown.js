// Runs once after all test suites — just close the DB connection
require('dotenv').config({ path: '.env.test' });

module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const { sequelize } = require('../models');
  await sequelize.close();
};
