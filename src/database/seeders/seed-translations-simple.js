/**
 * Simple translation seeder - directly inserts data without model sync
 * Usage: node src/database/seeders/seed-translations-simple.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');

// MyMemory API for translation
async function translateText(text, fromLang, toLang) {
  try {
    if (fromLang === toLang) return text;
    if (!text || text.trim() === '') return text;

    const response = await axios.get('https://api.mymemory.translated.net/get', {
      params: {
        q: text,
        langpair: `${fromLang}|${toLang}`,
      },
      timeout: 10000,
    });

    if (response.data && response.data.responseStatus === 200) {
      return response.data.responseData.translatedText;
    }
    return text;
  } catch (error) {
    console.error(`Translation failed for "${text}": ${error.message}`);
    return text;
  }
}

// Initial translation keys
const translationKeys = [
  // COMMON
  { key: 'common.save', default_value: 'Save', group: 'common' },
  { key: 'common.cancel', default_value: 'Cancel', group: 'common' },
  { key: 'common.delete', default_value: 'Delete', group: 'common' },
  { key: 'common.edit', default_value: 'Edit', group: 'common' },
  { key: 'common.create', default_value: 'Create', group: 'common' },
  { key: 'common.update', default_value: 'Update', group: 'common' },
  { key: 'common.search', default_value: 'Search', group: 'common' },
  { key: 'common.loading', default_value: 'Loading...', group: 'common' },
  { key: 'common.actions', default_value: 'Actions', group: 'common' },
  { key: 'common.status', default_value: 'Status', group: 'common' },
  { key: 'common.active', default_value: 'Active', group: 'common' },
  { key: 'common.inactive', default_value: 'Inactive', group: 'common' },
  { key: 'common.name', default_value: 'Name', group: 'common' },
  { key: 'common.email', default_value: 'Email', group: 'common' },
  { key: 'common.previous', default_value: 'Previous', group: 'common' },
  { key: 'common.next', default_value: 'Next', group: 'common' },
  { key: 'common.yes', default_value: 'Yes', group: 'common' },
  { key: 'common.no', default_value: 'No', group: 'common' },
  { key: 'common.confirm', default_value: 'Confirm', group: 'common' },
  { key: 'common.close', default_value: 'Close', group: 'common' },

  // AUTH
  { key: 'auth.login', default_value: 'Login', group: 'auth' },
  { key: 'auth.logout', default_value: 'Logout', group: 'auth' },
  { key: 'auth.register', default_value: 'Register', group: 'auth' },
  { key: 'auth.password', default_value: 'Password', group: 'auth' },
  { key: 'auth.forgot_password', default_value: 'Forgot Password?', group: 'auth' },
  { key: 'auth.reset_password', default_value: 'Reset Password', group: 'auth' },
  { key: 'auth.sign_in', default_value: 'Sign In', group: 'auth' },
  { key: 'auth.welcome_back', default_value: 'Welcome Back', group: 'auth' },
  { key: 'auth.full_name', default_value: 'Full Name', group: 'auth' },

  // DASHBOARD
  { key: 'dashboard.title', default_value: 'Dashboard', group: 'dashboard' },
  { key: 'dashboard.users', default_value: 'Users', group: 'dashboard' },
  { key: 'dashboard.total_users', default_value: 'Total Users', group: 'dashboard' },
  { key: 'dashboard.settings', default_value: 'Settings', group: 'dashboard' },

  // NAVIGATION
  { key: 'nav.dashboard', default_value: 'Dashboard', group: 'navigation' },
  { key: 'nav.users', default_value: 'Users', group: 'navigation' },
  { key: 'nav.roles', default_value: 'Roles', group: 'navigation' },
  { key: 'nav.settings', default_value: 'Settings', group: 'navigation' },
  { key: 'nav.languages', default_value: 'Languages', group: 'navigation' },
  { key: 'nav.translations', default_value: 'Translations', group: 'navigation' },
  { key: 'nav.profile', default_value: 'Profile', group: 'navigation' },

  // USERS
  { key: 'users.add_user', default_value: 'Add User', group: 'users' },
  { key: 'users.edit_user', default_value: 'Edit User', group: 'users' },
  { key: 'users.delete_confirm', default_value: 'Are you sure you want to delete this user?', group: 'users' },
  { key: 'users.no_users_found', default_value: 'No users found', group: 'users' },

  // SETTINGS
  { key: 'settings.title', default_value: 'Settings', group: 'settings' },
  { key: 'settings.general', default_value: 'General Settings', group: 'settings' },
  { key: 'settings.email', default_value: 'Email Settings', group: 'settings' },

  // VALIDATION
  { key: 'validation.required', default_value: 'This field is required', group: 'validation' },
  { key: 'validation.email_invalid', default_value: 'Please enter a valid email', group: 'validation' },
  { key: 'validation.password_min', default_value: 'Password must be at least 6 characters', group: 'validation' },

  // ERRORS
  { key: 'errors.page_not_found', default_value: 'Page Not Found', group: 'errors' },
  { key: 'errors.something_wrong', default_value: 'Something went wrong!', group: 'errors' },
  { key: 'errors.try_again', default_value: 'Try again', group: 'errors' },
];

async function seedTranslations() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'test',
  });

  console.log('Connected to database!\n');

  try {
    // Get all languages
    const [languages] = await connection.execute('SELECT id, code, name FROM languages WHERE is_active = 1');
    console.log(`Found ${languages.length} active languages:`, languages.map(l => l.code).join(', '));

    let created = 0;
    let skipped = 0;

    for (const keyData of translationKeys) {
      // Check if key exists
      const [existing] = await connection.execute(
        'SELECT id FROM translation_keys WHERE `key` = ?',
        [keyData.key]
      );

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Insert key
      const [result] = await connection.execute(
        'INSERT INTO translation_keys (`key`, default_value, `group`, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
        [keyData.key, keyData.default_value, keyData.group]
      );

      const keyId = result.insertId;
      console.log(`Created: ${keyData.key}`);
      created++;

      // Create translations for each language
      for (const lang of languages) {
        let value = keyData.default_value;

        if (lang.code !== 'en') {
          console.log(`  Translating to ${lang.code}...`);
          value = await translateText(keyData.default_value, 'en', lang.code);
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        await connection.execute(
          'INSERT INTO translations (translation_key_id, language_id, value, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
          [keyId, lang.id, value, lang.code === 'en' ? 'reviewed' : 'auto']
        );
      }
    }

    console.log('\n========================================');
    console.log(`Seeding completed!`);
    console.log(`Created: ${created} keys`);
    console.log(`Skipped: ${skipped} keys (already exist)`);
    console.log(`Total translations: ${created * languages.length}`);
    console.log('========================================\n');

  } finally {
    await connection.end();
  }
}

seedTranslations()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
