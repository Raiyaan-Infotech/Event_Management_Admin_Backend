// Runs once before all test suites — verifies DB connection
require('dotenv').config({ path: '.env.test' });

module.exports = async () => {
  process.env.NODE_ENV = 'test';
  const { sequelize } = require('../models');
  await sequelize.authenticate();
  await sequelize.close();
};
