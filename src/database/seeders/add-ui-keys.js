/**
 * Add missing UI translation keys
 * Usage: node src/database/seeders/add-ui-keys.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const mysql = require('mysql2/promise');
const axios = require('axios');

// MyMemory API for translation
async function translateText(text, fromLang, toLang) {
  try {
    if (fromLang === toLang) return text;
    if (!text || text.trim() === '') return text;

    const response = await axios.get('https://api.mymemory.translated.net/get', {
      params: { q: text, langpair: `${fromLang}|${toLang}` },
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

// New keys needed for UI
const newKeys = [
  // Dashboard
  { key: 'dashboard.welcome_admin', default_value: 'Welcome to Admin Dashboard', group: 'dashboard' },
  { key: 'dashboard.quick_actions', default_value: 'Quick Actions', group: 'dashboard' },

  // Navigation - Appearance
  { key: 'nav.appearance', default_value: 'Appearance', group: 'navigation' },
  { key: 'nav.theme', default_value: 'Theme', group: 'navigation' },
  { key: 'nav.menu', default_value: 'Menu', group: 'navigation' },
  { key: 'nav.theme_option', default_value: 'Theme Option', group: 'navigation' },
  { key: 'nav.platform_admin', default_value: 'Platform Administration', group: 'navigation' },
  { key: 'nav.navigation', default_value: 'Navigation', group: 'navigation' },
  { key: 'nav.translations', default_value: 'Translations', group: 'navigation' },

  // Users
  { key: 'users.manage_users', default_value: 'Manage Users', group: 'users' },
  { key: 'users.delete_confirm', default_value: 'Are you sure you want to delete this user?', group: 'users' },
  { key: 'users.no_users_found', default_value: 'No users found', group: 'users' },

  // Roles
  { key: 'roles.manage_roles', default_value: 'Manage Roles', group: 'roles' },
  { key: 'roles.delete_confirm', default_value: 'Are you sure you want to delete this role?', group: 'roles' },
  { key: 'roles.edit_role', default_value: 'Edit Role', group: 'roles' },
  { key: 'roles.add_role', default_value: 'Add Role', group: 'roles' },
  { key: 'roles.edit_desc', default_value: 'Update the role details below.', group: 'roles' },
  { key: 'roles.add_desc', default_value: 'Fill in the details to create a new role.', group: 'roles' },
  { key: 'roles.manage_permissions', default_value: 'Manage Permissions', group: 'roles' },
  { key: 'roles.permissions_desc', default_value: 'Select the permissions to assign to this role.', group: 'roles' },
  { key: 'roles.search', default_value: 'Search roles...', group: 'roles' },
  { key: 'roles.no_roles_found', default_value: 'No roles found', group: 'roles' },

  // Activity
  { key: 'activity.logs', default_value: 'Activity Logs', group: 'activity' },
  { key: 'activity.recent', default_value: 'Recent Activity', group: 'activity' },
  { key: 'activity.no_activity', default_value: 'No recent activity to display', group: 'activity' },
  { key: 'activity.view_all', default_value: 'View All', group: 'activity' },
  { key: 'activity.date_time', default_value: 'Date & Time', group: 'activity' },
  { key: 'activity.ip_address', default_value: 'IP Address', group: 'activity' },
  { key: 'activity.logs_desc', default_value: 'View system activity and user actions', group: 'activity' },
  { key: 'activity.loading', default_value: 'Loading activity logs...', group: 'activity' },

  // Common
  { key: 'common.user', default_value: 'User', group: 'common' },
  { key: 'common.action', default_value: 'Action', group: 'common' },
  { key: 'common.description', default_value: 'Description', group: 'common' },
  { key: 'common.date', default_value: 'Date', group: 'common' },
  { key: 'common.slug', default_value: 'Slug', group: 'common' },
  { key: 'common.saving', default_value: 'Saving...', group: 'common' },
  { key: 'common.changing', default_value: 'Changing...', group: 'common' },
  { key: 'common.code', default_value: 'Code', group: 'common' },
  { key: 'common.loading', default_value: 'Loading...', group: 'common' },
  { key: 'common.create', default_value: 'Create', group: 'common' },

  // Settings
  { key: 'settings.common', default_value: 'Common', group: 'settings' },
  { key: 'settings.general', default_value: 'General', group: 'settings' },
  { key: 'settings.general_desc', default_value: 'View and update your general settings and site info', group: 'settings' },
  { key: 'settings.email', default_value: 'Email', group: 'settings' },
  { key: 'settings.email_desc', default_value: 'View and update your email settings and SMTP configuration', group: 'settings' },
  { key: 'settings.email_templates', default_value: 'Email Templates', group: 'settings' },
  { key: 'settings.email_templates_desc', default_value: 'Email templates using HTML & system variables', group: 'settings' },
  { key: 'settings.phone_number', default_value: 'Phone Number', group: 'settings' },
  { key: 'settings.phone_number_desc', default_value: 'Configure phone number field settings', group: 'settings' },
  { key: 'settings.languages', default_value: 'Languages', group: 'settings' },
  { key: 'settings.languages_desc', default_value: 'View and update your website languages', group: 'settings' },
  { key: 'settings.currencies', default_value: 'Currencies', group: 'settings' },
  { key: 'settings.currencies_desc', default_value: 'View and update your website currencies', group: 'settings' },
  { key: 'settings.media', default_value: 'Media', group: 'settings' },
  { key: 'settings.media_desc', default_value: 'View and update your media settings', group: 'settings' },
  { key: 'settings.website_tracking', default_value: 'Website Tracking', group: 'settings' },
  { key: 'settings.website_tracking_desc', default_value: 'View and update your Website Tracking settings', group: 'settings' },
  { key: 'settings.dashboard_theme', default_value: 'Dashboard Color Theme', group: 'settings' },
  { key: 'settings.dashboard_theme_desc', default_value: 'View and update Admin Colors And Layout', group: 'settings' },
  { key: 'settings.site_settings', default_value: 'Site Settings', group: 'settings' },
  { key: 'settings.site_settings_desc', default_value: 'View and update logo, favicon, layout', group: 'settings' },
  { key: 'settings.email_campaigns', default_value: 'Email Campaigns', group: 'settings' },
  { key: 'settings.email_campaigns_desc', default_value: 'Manage email marketing campaigns', group: 'settings' },
  { key: 'settings.social_login', default_value: 'Social Login', group: 'settings' },
  { key: 'settings.social_login_desc', default_value: 'Configure social login providers', group: 'settings' },
  { key: 'settings.localization', default_value: 'Localization', group: 'settings' },
  { key: 'settings.translations', default_value: 'Translations', group: 'settings' },
  { key: 'settings.translations_desc', default_value: 'Manage UI translations for multiple languages', group: 'settings' },
  { key: 'settings.locations', default_value: 'Locations', group: 'settings' },
  { key: 'settings.locations_desc', default_value: 'Manage countries, states, cities, and pincodes', group: 'settings' },
  { key: 'settings.timezone', default_value: 'Timezone', group: 'settings' },
  { key: 'settings.timezone_desc', default_value: 'Configure timezone and date format settings', group: 'settings' },
  { key: 'settings.performance', default_value: 'Performance', group: 'settings' },
  { key: 'settings.cache', default_value: 'Cache', group: 'settings' },
  { key: 'settings.cache_desc', default_value: 'Configure caching for optimized speed', group: 'settings' },
  { key: 'settings.optimize', default_value: 'Optimize', group: 'settings' },
  { key: 'settings.optimize_desc', default_value: 'Minify HTML output, inline CSS, remove comments', group: 'settings' },
  { key: 'settings.page_desc', default_value: 'Manage all your application settings and configuration', group: 'settings' },

  // Profile
  { key: 'profile.title', default_value: 'Profile', group: 'profile' },
  { key: 'profile.description', default_value: 'Manage your account settings and preferences', group: 'profile' },
  { key: 'profile.account_info', default_value: 'Account Info', group: 'profile' },
  { key: 'profile.account_details', default_value: 'Your account details', group: 'profile' },
  { key: 'profile.phone', default_value: 'Phone', group: 'profile' },
  { key: 'profile.last_login', default_value: 'Last Login', group: 'profile' },
  { key: 'profile.personal_info', default_value: 'Personal Information', group: 'profile' },
  { key: 'profile.personal_info_desc', default_value: 'Update your personal details', group: 'profile' },
  { key: 'profile.full_name', default_value: 'Full Name', group: 'profile' },
  { key: 'profile.update_profile', default_value: 'Update Profile', group: 'profile' },
  { key: 'profile.change_password', default_value: 'Change Password', group: 'profile' },
  { key: 'profile.change_password_desc', default_value: 'Update your password to keep your account secure', group: 'profile' },
  { key: 'profile.current_password', default_value: 'Current Password', group: 'profile' },
  { key: 'profile.enter_current_password', default_value: 'Enter current password', group: 'profile' },
  { key: 'profile.new_password', default_value: 'New Password', group: 'profile' },
  { key: 'profile.enter_new_password', default_value: 'Enter new password', group: 'profile' },
  { key: 'profile.confirm_password', default_value: 'Confirm New Password', group: 'profile' },
  { key: 'profile.confirm_new_password', default_value: 'Confirm new password', group: 'profile' },

  // Permissions
  { key: 'permissions.title', default_value: 'Permissions', group: 'permissions' },
  { key: 'permissions.description', default_value: 'Manage system permissions', group: 'permissions' },
  { key: 'permissions.name', default_value: 'Permission Name', group: 'permissions' },
  { key: 'permissions.add_permission', default_value: 'Add Permission', group: 'permissions' },
  { key: 'permissions.loading', default_value: 'Loading permissions...', group: 'permissions' },
  { key: 'permissions.no_permissions', default_value: 'No permissions found', group: 'permissions' },
  { key: 'permissions.create_first', default_value: 'Create First Permission', group: 'permissions' },

  // Languages
  { key: 'languages.title', default_value: 'Languages', group: 'languages' },
  { key: 'languages.add_language', default_value: 'Add Language', group: 'languages' },
  { key: 'languages.edit_language', default_value: 'Edit Language', group: 'languages' },
  { key: 'languages.add_desc', default_value: 'Fill in the details to create a new language.', group: 'languages' },
  { key: 'languages.edit_desc', default_value: 'Update the language details below.', group: 'languages' },
  { key: 'languages.search', default_value: 'Search languages...', group: 'languages' },
  { key: 'languages.native_name', default_value: 'Native Name', group: 'languages' },
  { key: 'languages.direction', default_value: 'Direction', group: 'languages' },
  { key: 'languages.no_languages_found', default_value: 'No languages found', group: 'languages' },
  { key: 'languages.delete_confirm', default_value: 'Are you sure you want to delete this language?', group: 'languages' },

  // Currencies
  { key: 'currencies.title', default_value: 'Currencies', group: 'currencies' },
  { key: 'currencies.add_currency', default_value: 'Add Currency', group: 'currencies' },
  { key: 'currencies.edit_currency', default_value: 'Edit Currency', group: 'currencies' },
  { key: 'currencies.add_desc', default_value: 'Fill in the details to create a new currency.', group: 'currencies' },
  { key: 'currencies.edit_desc', default_value: 'Update the currency details below.', group: 'currencies' },
  { key: 'currencies.search', default_value: 'Search currencies...', group: 'currencies' },
  { key: 'currencies.symbol', default_value: 'Symbol', group: 'currencies' },
  { key: 'currencies.exchange_rate', default_value: 'Exchange Rate', group: 'currencies' },
  { key: 'currencies.no_currencies_found', default_value: 'No currencies found', group: 'currencies' },
  { key: 'currencies.delete_confirm', default_value: 'Are you sure you want to delete this currency?', group: 'currencies' },

  // Platform
  { key: 'platform.user_management', default_value: 'User Management', group: 'platform' },
  { key: 'platform.users_desc', default_value: 'Manage all registered users and their accounts', group: 'platform' },
  { key: 'platform.roles_desc', default_value: 'Create and manage user roles and access levels', group: 'platform' },
  { key: 'platform.permissions_desc', default_value: 'Define granular permissions for roles', group: 'platform' },
  { key: 'platform.profile_desc', default_value: 'View and update your admin profile', group: 'platform' },
  { key: 'platform.system', default_value: 'System', group: 'platform' },
  { key: 'platform.activity_desc', default_value: 'View all user activities and system events', group: 'platform' },
  { key: 'platform.cache_manager', default_value: 'Cache Manager', group: 'platform' },
  { key: 'platform.cache_desc', default_value: 'Clear and manage application cache', group: 'platform' },
  { key: 'platform.page_desc', default_value: 'Manage users, roles, and system administration', group: 'platform' },
];

async function addKeys() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'test',
  });

  console.log('Connected to database!\n');

  const [languages] = await conn.execute('SELECT id, code, name FROM languages WHERE is_active = 1');
  console.log('Languages:', languages.map(l => l.code).join(', '), '\n');

  let created = 0;
  let skipped = 0;

  for (const keyData of newKeys) {
    const [existing] = await conn.execute('SELECT id FROM translation_keys WHERE `key` = ?', [keyData.key]);
    if (existing.length > 0) {
      console.log('Skip:', keyData.key);
      skipped++;
      continue;
    }

    const [result] = await conn.execute(
      'INSERT INTO translation_keys (`key`, default_value, `group`, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
      [keyData.key, keyData.default_value, keyData.group]
    );

    const keyId = result.insertId;
    console.log('Created:', keyData.key);
    created++;

    for (const lang of languages) {
      let value = keyData.default_value;

      if (lang.code !== 'en') {
        value = await translateText(keyData.default_value, 'en', lang.code);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      await conn.execute(
        'INSERT INTO translations (translation_key_id, language_id, value, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
        [keyId, lang.id, value, lang.code === 'en' ? 'reviewed' : 'auto']
      );
    }
  }

  console.log('\n========================================');
  console.log(`Created: ${created} keys`);
  console.log(`Skipped: ${skipped} keys (already exist)`);
  console.log('========================================\n');

  await conn.end();
}

addKeys()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
