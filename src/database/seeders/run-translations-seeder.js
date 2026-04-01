/**
 * Run this script to seed translation keys
 *
 * Usage: node src/database/seeders/run-translations-seeder.js
 *
 * This will:
 * 1. Create all translation keys defined in translations.seeder.js
 * 2. Auto-translate them to Tamil and Hindi using MyMemory API
 *
 * Note: The seeder skips keys that already exist, so it's safe to run multiple times.
 */

require('dotenv').config();
const { sequelize } = require('../../models');
const { seedTranslations } = require('./translations.seeder');

async function run() {
  console.log('Connecting to database...');

  try {
    await sequelize.authenticate();
    console.log('Database connected!\n');

    // Sync models (create tables if not exist)
    await sequelize.sync();
    console.log('Models synced!\n');

    // Run seeder
    await seedTranslations();

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
