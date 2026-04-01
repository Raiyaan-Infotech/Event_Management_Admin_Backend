/**
 * Complete translation seeder - Seeds ALL English text from the frontend codebase
 * This is run by developers after scanning the codebase
 * Admin only sees and edits the translations, not keys
 *
 * Usage: node src/database/seeders/seed-all-translations.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');

// MyMemory API for translation
async function translateText(text, fromLang, toLang) {
  try {
    if (fromLang === toLang) return text;
    if (!text || text.trim() === '') return text;
    // Skip very short text
    if (text.length < 2) return text;

    const response = await axios.get('https://api.mymemory.translated.net/get', {
      params: { q: text, langpair: `${fromLang}|${toLang}` },
      timeout: 10000,
    });

    if (response.data && response.data.responseStatus === 200) {
      return response.data.responseData.translatedText;
    }
    return text;
  } catch (error) {
    console.error(`  ⚠️ Translation failed: ${error.message}`);
    return text;
  }
}

// ALL English text extracted from the frontend codebase
// Organized by groups for admin to filter easily
const allTranslationKeys = [
  // ==================== COMMON UI ====================
  { key: 'common.save', default_value: 'Save', group: 'common' },
  { key: 'common.cancel', default_value: 'Cancel', group: 'common' },
  { key: 'common.delete', default_value: 'Delete', group: 'common' },
  { key: 'common.edit', default_value: 'Edit', group: 'common' },
  { key: 'common.create', default_value: 'Create', group: 'common' },
  { key: 'common.update', default_value: 'Update', group: 'common' },
  { key: 'common.search', default_value: 'Search', group: 'common' },
  { key: 'common.loading', default_value: 'Loading...', group: 'common' },
  { key: 'common.saving', default_value: 'Saving...', group: 'common' },
  { key: 'common.creating', default_value: 'Creating...', group: 'common' },
  { key: 'common.deleting', default_value: 'Deleting...', group: 'common' },
  { key: 'common.actions', default_value: 'Actions', group: 'common' },
  { key: 'common.status', default_value: 'Status', group: 'common' },
  { key: 'common.active', default_value: 'Active', group: 'common' },
  { key: 'common.inactive', default_value: 'Inactive', group: 'common' },
  { key: 'common.name', default_value: 'Name', group: 'common' },
  { key: 'common.email', default_value: 'Email', group: 'common' },
  { key: 'common.phone', default_value: 'Phone', group: 'common' },
  { key: 'common.description', default_value: 'Description', group: 'common' },
  { key: 'common.date', default_value: 'Date', group: 'common' },
  { key: 'common.date_time', default_value: 'Date & Time', group: 'common' },
  { key: 'common.previous', default_value: 'Previous', group: 'common' },
  { key: 'common.next', default_value: 'Next', group: 'common' },
  { key: 'common.yes', default_value: 'Yes', group: 'common' },
  { key: 'common.no', default_value: 'No', group: 'common' },
  { key: 'common.confirm', default_value: 'Confirm', group: 'common' },
  { key: 'common.close', default_value: 'Close', group: 'common' },
  { key: 'common.view_all', default_value: 'View All', group: 'common' },
  { key: 'common.help', default_value: 'Help', group: 'common' },
  { key: 'common.got_it', default_value: 'Got it', group: 'common' },
  { key: 'common.ip_address', default_value: 'IP Address', group: 'common' },
  { key: 'common.user', default_value: 'User', group: 'common' },
  { key: 'common.action', default_value: 'Action', group: 'common' },

  // ==================== AUTH ====================
  { key: 'auth.admin_login', default_value: 'Admin Login', group: 'auth' },
  { key: 'auth.enter_credentials', default_value: 'Enter your credentials to access the admin panel', group: 'auth' },
  { key: 'auth.welcome_back', default_value: 'Welcome Back', group: 'auth' },
  { key: 'auth.sign_in_to_access', default_value: 'Sign in to access your admin dashboard and manage your application.', group: 'auth' },
  { key: 'auth.email', default_value: 'Email', group: 'auth' },
  { key: 'auth.password', default_value: 'Password', group: 'auth' },
  { key: 'auth.forgot_password', default_value: 'Forgot password?', group: 'auth' },
  { key: 'auth.sign_in', default_value: 'Sign In', group: 'auth' },
  { key: 'auth.signing_in', default_value: 'Signing in...', group: 'auth' },
  { key: 'auth.dont_have_account', default_value: "Don't have an account?", group: 'auth' },
  { key: 'auth.register', default_value: 'Register', group: 'auth' },
  { key: 'auth.create_account', default_value: 'Create Account', group: 'auth' },
  { key: 'auth.register_for_access', default_value: 'Register for admin access', group: 'auth' },
  { key: 'auth.join_us', default_value: 'Join Us', group: 'auth' },
  { key: 'auth.create_account_desc', default_value: 'Create your account to get started with the admin dashboard.', group: 'auth' },
  { key: 'auth.full_name', default_value: 'Full Name', group: 'auth' },
  { key: 'auth.confirm_password', default_value: 'Confirm Password', group: 'auth' },
  { key: 'auth.creating_account', default_value: 'Creating account...', group: 'auth' },
  { key: 'auth.already_have_account', default_value: 'Already have an account?', group: 'auth' },
  { key: 'auth.logout', default_value: 'Logout', group: 'auth' },

  // Password Reset
  { key: 'auth.reset_password', default_value: 'Reset Password', group: 'auth' },
  { key: 'auth.enter_email_for_otp', default_value: "Enter your email and we'll send you a verification code", group: 'auth' },
  { key: 'auth.enter_otp_desc', default_value: 'Enter the 6-digit OTP sent to your email.', group: 'auth' },
  { key: 'auth.new_password_desc', default_value: 'Create a new password for your account.', group: 'auth' },
  { key: 'auth.back_to_login', default_value: 'Back to Login', group: 'auth' },
  { key: 'auth.email_address', default_value: 'Email Address', group: 'auth' },
  { key: 'auth.send_otp', default_value: 'Send OTP', group: 'auth' },
  { key: 'auth.sending', default_value: 'Sending...', group: 'auth' },
  { key: 'auth.enter_otp', default_value: 'Enter OTP', group: 'auth' },
  { key: 'auth.otp_sent_to', default_value: 'We sent a 6-digit code to', group: 'auth' },
  { key: 'auth.verification_code', default_value: 'Verification Code', group: 'auth' },
  { key: 'auth.verify_otp', default_value: 'Verify OTP', group: 'auth' },
  { key: 'auth.verifying', default_value: 'Verifying...', group: 'auth' },
  { key: 'auth.resend_otp', default_value: 'Resend OTP', group: 'auth' },
  { key: 'auth.change_email', default_value: 'Change email address', group: 'auth' },
  { key: 'auth.new_password', default_value: 'New Password', group: 'auth' },
  { key: 'auth.enter_new_password', default_value: 'Enter new password', group: 'auth' },
  { key: 'auth.confirm_new_password', default_value: 'Confirm new password', group: 'auth' },
  { key: 'auth.resetting', default_value: 'Resetting...', group: 'auth' },

  // ==================== DASHBOARD ====================
  { key: 'dashboard.title', default_value: 'Dashboard', group: 'dashboard' },
  { key: 'dashboard.total_users', default_value: 'Total Users', group: 'dashboard' },
  { key: 'dashboard.manage_users', default_value: 'Manage Users', group: 'dashboard' },
  { key: 'dashboard.manage_roles', default_value: 'Manage Roles', group: 'dashboard' },
  { key: 'dashboard.activity_logs', default_value: 'Activity Logs', group: 'dashboard' },
  { key: 'dashboard.quick_actions', default_value: 'Quick Actions', group: 'dashboard' },
  { key: 'dashboard.recent_activity', default_value: 'Recent Activity', group: 'dashboard' },
  { key: 'dashboard.no_recent_activity', default_value: 'No recent activity to display', group: 'dashboard' },

  // ==================== NAVIGATION ====================
  { key: 'nav.dashboard', default_value: 'Dashboard', group: 'navigation' },
  { key: 'nav.users', default_value: 'Users', group: 'navigation' },
  { key: 'nav.access_control', default_value: 'Access Control', group: 'navigation' },
  { key: 'nav.roles', default_value: 'Roles', group: 'navigation' },
  { key: 'nav.permissions', default_value: 'Permissions', group: 'navigation' },
  { key: 'nav.locations', default_value: 'Locations', group: 'navigation' },
  { key: 'nav.configuration', default_value: 'Configuration', group: 'navigation' },
  { key: 'nav.settings', default_value: 'Settings', group: 'navigation' },
  { key: 'nav.languages', default_value: 'Languages', group: 'navigation' },
  { key: 'nav.currencies', default_value: 'Currencies', group: 'navigation' },
  { key: 'nav.translations', default_value: 'Translations', group: 'navigation' },
  { key: 'nav.email_templates', default_value: 'Email Templates', group: 'navigation' },
  { key: 'nav.profile', default_value: 'Profile', group: 'navigation' },
  { key: 'nav.my_account', default_value: 'My Account', group: 'navigation' },
  { key: 'nav.notifications', default_value: 'Notifications', group: 'navigation' },
  { key: 'nav.search', default_value: 'Search...', group: 'navigation' },

  // ==================== USERS ====================
  { key: 'users.title', default_value: 'Users', group: 'users' },
  { key: 'users.add_user', default_value: 'Add User', group: 'users' },
  { key: 'users.edit_user', default_value: 'Edit User', group: 'users' },
  { key: 'users.create_user', default_value: 'Create User', group: 'users' },
  { key: 'users.update_user', default_value: 'Update User', group: 'users' },
  { key: 'users.search_users', default_value: 'Search users...', group: 'users' },
  { key: 'users.no_users_found', default_value: 'No users found', group: 'users' },
  { key: 'users.role', default_value: 'Role', group: 'users' },
  { key: 'users.confirm_delete', default_value: 'Are you sure you want to delete this user?', group: 'users' },
  { key: 'users.fill_details', default_value: 'Fill in the details to create a new user.', group: 'users' },
  { key: 'users.update_details', default_value: 'Update the user details below.', group: 'users' },
  { key: 'users.enable_disable', default_value: 'Enable/disable this user', group: 'users' },
  { key: 'users.page_of', default_value: 'Page {page} of {total}', group: 'users' },

  // ==================== ROLES ====================
  { key: 'roles.title', default_value: 'Roles', group: 'roles' },
  { key: 'roles.add_role', default_value: 'Add Role', group: 'roles' },
  { key: 'roles.edit_role', default_value: 'Edit Role', group: 'roles' },
  { key: 'roles.create_role', default_value: 'Create Role', group: 'roles' },
  { key: 'roles.update_role', default_value: 'Update Role', group: 'roles' },
  { key: 'roles.search_roles', default_value: 'Search roles...', group: 'roles' },
  { key: 'roles.no_roles_found', default_value: 'No roles found', group: 'roles' },
  { key: 'roles.manage_permissions', default_value: 'Manage Permissions', group: 'roles' },
  { key: 'roles.slug', default_value: 'Slug', group: 'roles' },
  { key: 'roles.confirm_delete', default_value: 'Are you sure you want to delete this role?', group: 'roles' },
  { key: 'roles.fill_details', default_value: 'Fill in the details to create a new role.', group: 'roles' },
  { key: 'roles.update_details', default_value: 'Update the role details below.', group: 'roles' },
  { key: 'roles.select_permissions', default_value: 'Select the permissions to assign to this role.', group: 'roles' },
  { key: 'roles.auto_generated', default_value: 'Leave empty to auto-generate from name', group: 'roles' },

  // ==================== PERMISSIONS ====================
  { key: 'permissions.title', default_value: 'Permissions', group: 'permissions' },
  { key: 'permissions.manage', default_value: 'Manage system permissions', group: 'permissions' },
  { key: 'permissions.add', default_value: 'Add Permission', group: 'permissions' },
  { key: 'permissions.create_first', default_value: 'Create First Permission', group: 'permissions' },
  { key: 'permissions.name', default_value: 'Permission Name', group: 'permissions' },
  { key: 'permissions.no_found', default_value: 'No permissions found', group: 'permissions' },

  // ==================== SETTINGS ====================
  { key: 'settings.title', default_value: 'Settings', group: 'settings' },
  { key: 'settings.manage_desc', default_value: 'Manage all your application settings and configuration', group: 'settings' },
  { key: 'settings.common', default_value: 'Common', group: 'settings' },
  { key: 'settings.general', default_value: 'General', group: 'settings' },
  { key: 'settings.general_desc', default_value: 'View and update your general settings and site info', group: 'settings' },
  { key: 'settings.email', default_value: 'Email', group: 'settings' },
  { key: 'settings.email_desc', default_value: 'View and update your email settings and SMTP configuration', group: 'settings' },
  { key: 'settings.email_templates', default_value: 'Email Templates', group: 'settings' },
  { key: 'settings.email_templates_desc', default_value: 'Email templates using HTML & system variables', group: 'settings' },
  { key: 'settings.phone_number', default_value: 'Phone Number', group: 'settings' },
  { key: 'settings.phone_desc', default_value: 'Configure phone number field settings', group: 'settings' },
  { key: 'settings.languages', default_value: 'Languages', group: 'settings' },
  { key: 'settings.languages_desc', default_value: 'View and update your website languages', group: 'settings' },
  { key: 'settings.currencies', default_value: 'Currencies', group: 'settings' },
  { key: 'settings.currencies_desc', default_value: 'View and update your website currencies', group: 'settings' },
  { key: 'settings.translations', default_value: 'Translations', group: 'settings' },
  { key: 'settings.translations_desc', default_value: 'Manage UI translations for multiple languages', group: 'settings' },
  { key: 'settings.localization', default_value: 'Localization', group: 'settings' },
  { key: 'settings.locations', default_value: 'Locations', group: 'settings' },
  { key: 'settings.locations_desc', default_value: 'Manage countries, states, cities, and pincodes', group: 'settings' },
  { key: 'settings.timezone', default_value: 'Timezone', group: 'settings' },
  { key: 'settings.timezone_desc', default_value: 'Configure timezone and date format settings', group: 'settings' },

  // General Settings Page
  { key: 'settings.general_settings', default_value: 'General Settings', group: 'settings' },
  { key: 'settings.general_config', default_value: 'Configure admin email, timezone, language, and direction', group: 'settings' },
  { key: 'settings.admin_email', default_value: 'Admin Email', group: 'settings' },
  { key: 'settings.admin_email_desc', default_value: 'Primary email address for admin notifications', group: 'settings' },
  { key: 'settings.select_timezone', default_value: 'Select timezone', group: 'settings' },
  { key: 'settings.set_timezone', default_value: 'Set the default timezone for the application', group: 'settings' },
  { key: 'settings.font_direction', default_value: 'Font Direction', group: 'settings' },
  { key: 'settings.set_direction', default_value: 'Set the text direction for the interface', group: 'settings' },
  { key: 'settings.direction', default_value: 'Direction', group: 'settings' },
  { key: 'settings.ltr', default_value: 'LTR (Left to Right)', group: 'settings' },
  { key: 'settings.rtl', default_value: 'RTL (Right to Left)', group: 'settings' },
  { key: 'settings.language', default_value: 'Language', group: 'settings' },
  { key: 'settings.select_language', default_value: 'Select language', group: 'settings' },
  { key: 'settings.set_language', default_value: 'Set the default language for the admin panel', group: 'settings' },
  { key: 'settings.coming_soon_mode', default_value: 'Coming Soon Mode', group: 'settings' },
  { key: 'settings.coming_soon_desc', default_value: "Enable this to show a 'Coming Soon' page to visitors on the main site", group: 'settings' },
  { key: 'settings.enable_coming_soon', default_value: 'Enable Coming Soon Page', group: 'settings' },
  { key: 'settings.coming_soon_when', default_value: 'When enabled, visitors will see a coming soon page instead of the main site', group: 'settings' },
  { key: 'settings.save_general', default_value: 'Save General Settings', group: 'settings' },

  // ==================== PROFILE ====================
  { key: 'profile.title', default_value: 'Profile', group: 'profile' },
  { key: 'profile.manage_desc', default_value: 'Manage your account settings and preferences', group: 'profile' },
  { key: 'profile.account_info', default_value: 'Account Info', group: 'profile' },
  { key: 'profile.your_details', default_value: 'Your account details', group: 'profile' },
  { key: 'profile.role', default_value: 'Role:', group: 'profile' },
  { key: 'profile.status', default_value: 'Status:', group: 'profile' },
  { key: 'profile.phone', default_value: 'Phone:', group: 'profile' },
  { key: 'profile.last_login', default_value: 'Last Login:', group: 'profile' },
  { key: 'profile.personal_info', default_value: 'Personal Information', group: 'profile' },
  { key: 'profile.update_details', default_value: 'Update your personal details', group: 'profile' },
  { key: 'profile.update_profile', default_value: 'Update Profile', group: 'profile' },
  { key: 'profile.change_password', default_value: 'Change Password', group: 'profile' },
  { key: 'profile.password_desc', default_value: 'Update your password to keep your account secure', group: 'profile' },
  { key: 'profile.current_password', default_value: 'Current Password', group: 'profile' },
  { key: 'profile.enter_current', default_value: 'Enter current password', group: 'profile' },
  { key: 'profile.new_password', default_value: 'New Password', group: 'profile' },
  { key: 'profile.enter_new', default_value: 'Enter new password', group: 'profile' },
  { key: 'profile.confirm_new', default_value: 'Confirm New Password', group: 'profile' },
  { key: 'profile.changing', default_value: 'Changing...', group: 'profile' },

  // ==================== LANGUAGES ====================
  { key: 'languages.title', default_value: 'Languages', group: 'languages' },
  { key: 'languages.add', default_value: 'Add Language', group: 'languages' },
  { key: 'languages.edit', default_value: 'Edit Language', group: 'languages' },
  { key: 'languages.code', default_value: 'Code', group: 'languages' },
  { key: 'languages.code_hint', default_value: 'ISO language code (e.g., en, hi, ar)', group: 'languages' },
  { key: 'languages.native_name', default_value: 'Native Name', group: 'languages' },
  { key: 'languages.direction', default_value: 'Text Direction', group: 'languages' },
  { key: 'languages.ltr', default_value: 'Left to Right (LTR)', group: 'languages' },
  { key: 'languages.rtl', default_value: 'Right to Left (RTL)', group: 'languages' },
  { key: 'languages.create', default_value: 'Create Language', group: 'languages' },
  { key: 'languages.update', default_value: 'Update Language', group: 'languages' },

  // ==================== CURRENCIES ====================
  { key: 'currencies.title', default_value: 'Currencies', group: 'currencies' },
  { key: 'currencies.add', default_value: 'Add Currency', group: 'currencies' },
  { key: 'currencies.code', default_value: 'Code', group: 'currencies' },
  { key: 'currencies.code_hint', default_value: 'ISO currency code (e.g., USD, EUR, INR)', group: 'currencies' },
  { key: 'currencies.symbol', default_value: 'Symbol', group: 'currencies' },
  { key: 'currencies.exchange_rate', default_value: 'Exchange Rate', group: 'currencies' },
  { key: 'currencies.enable', default_value: 'Enable this currency', group: 'currencies' },
  { key: 'currencies.create', default_value: 'Create Currency', group: 'currencies' },
  { key: 'currencies.update', default_value: 'Update Currency', group: 'currencies' },

  // ==================== VALIDATION ====================
  { key: 'validation.required', default_value: 'This field is required', group: 'validation' },
  { key: 'validation.email_invalid', default_value: 'Please enter a valid email', group: 'validation' },
  { key: 'validation.password_min', default_value: 'Password must be at least 6 characters', group: 'validation' },
  { key: 'validation.password_mismatch', default_value: "Passwords don't match", group: 'validation' },
  { key: 'validation.name_min_2', default_value: 'Name must be at least 2 characters', group: 'validation' },
  { key: 'validation.full_name_min', default_value: 'Full name must be at least 2 characters', group: 'validation' },
  { key: 'validation.select_role', default_value: 'Please select a role', group: 'validation' },
  { key: 'validation.code_min', default_value: 'Code must be at least 2 characters', group: 'validation' },
  { key: 'validation.code_max', default_value: 'Code must be at most 10 characters', group: 'validation' },
  { key: 'validation.symbol_required', default_value: 'Symbol is required', group: 'validation' },
  { key: 'validation.rate_positive', default_value: 'Exchange rate must be positive', group: 'validation' },
  { key: 'validation.otp_digits', default_value: 'OTP must be 6 digits', group: 'validation' },

  // ==================== ERRORS ====================
  { key: 'errors.page_not_found', default_value: 'Page Not Found', group: 'errors' },
  { key: 'errors.page_not_found_desc', default_value: "The page you are looking for doesn't exist or has been moved.", group: 'errors' },
  { key: 'errors.something_wrong', default_value: 'Something went wrong!', group: 'errors' },
  { key: 'errors.unexpected', default_value: 'An unexpected error has occurred. Please try again later.', group: 'errors' },
  { key: 'errors.go_home', default_value: 'Go Home', group: 'errors' },
  { key: 'errors.try_again', default_value: 'Try again', group: 'errors' },
  { key: 'errors.admin_dashboard', default_value: 'Admin Dashboard', group: 'errors' },
  { key: 'errors.coming_soon', default_value: 'Coming Soon', group: 'errors' },
  { key: 'errors.coming_soon_desc', default_value: "We're working hard to bring you something amazing. Stay tuned!", group: 'errors' },
  { key: 'errors.back_to_home', default_value: 'Back to Home', group: 'errors' },

  // ==================== ACTIVITY LOGS ====================
  { key: 'activity.title', default_value: 'Activity Logs', group: 'activity' },
  { key: 'activity.no_logs', default_value: 'No activity logs found', group: 'activity' },
  { key: 'activity.new_user', default_value: 'New user registered', group: 'activity' },
  { key: 'activity.system_update', default_value: 'System update available', group: 'activity' },
  { key: 'activity.backup_completed', default_value: 'Backup completed', group: 'activity' },
  { key: 'activity.view_all', default_value: 'View all notifications', group: 'activity' },

  // ==================== NOTIFICATIONS ====================
  { key: 'notifications.minutes_ago', default_value: '{count} minutes ago', group: 'notifications' },
  { key: 'notifications.hours_ago', default_value: '{count} hours ago', group: 'notifications' },

  // ==================== EMAIL CONFIG ====================
  { key: 'email.settings', default_value: 'Email Settings', group: 'email' },
  { key: 'email.config_desc', default_value: 'Configure email providers and manage templates', group: 'email' },
  { key: 'email.add_config', default_value: 'Add Email Config', group: 'email' },
  { key: 'email.configurations', default_value: 'Email Configurations', group: 'email' },
  { key: 'email.manage_configs', default_value: 'Manage your email provider configurations', group: 'email' },
  { key: 'email.driver', default_value: 'Driver', group: 'email' },
  { key: 'email.from_email', default_value: 'From Email', group: 'email' },
  { key: 'email.no_configs', default_value: 'No email configurations yet. Add one to get started.', group: 'email' },
  { key: 'email.edit_config', default_value: 'Edit Email Configuration', group: 'email' },
  { key: 'email.add_config_title', default_value: 'Add Email Configuration', group: 'email' },
  { key: 'email.update_settings', default_value: 'Update your email provider settings', group: 'email' },
  { key: 'email.configure_new', default_value: 'Configure a new email provider', group: 'email' },
  { key: 'email.config_name', default_value: 'Configuration Name', group: 'email' },
  { key: 'email.from_name', default_value: 'From Name', group: 'email' },
  { key: 'email.smtp', default_value: 'SMTP (Generic)', group: 'email' },
  { key: 'email.brevo', default_value: 'Brevo (300/day FREE)', group: 'email' },
  { key: 'email.sendmail', default_value: 'Sendmail (Server)', group: 'email' },
  { key: 'email.host', default_value: 'Host', group: 'email' },
  { key: 'email.port', default_value: 'Port', group: 'email' },
  { key: 'email.username', default_value: 'Username', group: 'email' },
  { key: 'email.encryption', default_value: 'Encryption', group: 'email' },
  { key: 'email.tls', default_value: 'TLS', group: 'email' },
  { key: 'email.ssl', default_value: 'SSL', group: 'email' },
  { key: 'email.none', default_value: 'None', group: 'email' },
  { key: 'email.test_connection', default_value: 'Test Email Connection', group: 'email' },
  { key: 'email.test_desc', default_value: 'Enter an email address to receive a test email. Leave empty to only verify the connection.', group: 'email' },
  { key: 'email.test_address', default_value: 'Test Email Address', group: 'email' },
  { key: 'email.test', default_value: 'Test Connection', group: 'email' },
  { key: 'email.testing', default_value: 'Testing...', group: 'email' },
  { key: 'email.delete_config', default_value: 'Delete Email Configuration', group: 'email' },
  { key: 'email.delete_confirm', default_value: 'Are you sure you want to delete this email configuration? This action cannot be undone.', group: 'email' },
];

async function seedAllTranslations() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'test',
    charset: 'utf8mb4',
  });

  console.log('🔌 Connected to database!\n');

  try {
    const [languages] = await connection.execute('SELECT id, code, name FROM languages WHERE is_active = 1');
    console.log(`📚 Found ${languages.length} active languages:`, languages.map(l => l.code).join(', '));
    console.log(`📝 Seeding ${allTranslationKeys.length} translation keys...\n`);

    let created = 0, skipped = 0;

    for (const keyData of allTranslationKeys) {
      const [existing] = await connection.execute('SELECT id FROM translation_keys WHERE `key` = ?', [keyData.key]);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      const [result] = await connection.execute(
        'INSERT INTO translation_keys (`key`, default_value, `group`, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
        [keyData.key, keyData.default_value, keyData.group]
      );

      const keyId = result.insertId;
      process.stdout.write(`✅ ${keyData.key}`);
      created++;

      for (const lang of languages) {
        let value = keyData.default_value;

        if (lang.code !== 'en') {
          process.stdout.write(` → ${lang.code}`);
          value = await translateText(keyData.default_value, 'en', lang.code);
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        await connection.execute(
          'INSERT INTO translations (translation_key_id, language_id, value, status, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
          [keyId, lang.id, value, lang.code === 'en' ? 'reviewed' : 'auto']
        );
      }
      console.log('');
    }

    console.log('\n========================================');
    console.log(`✅ Seeding completed!`);
    console.log(`   Created: ${created} keys`);
    console.log(`   Skipped: ${skipped} keys (already exist)`);
    console.log(`   Total translations: ${created * languages.length}`);
    console.log('========================================\n');

  } finally {
    await connection.end();
  }
}

seedAllTranslations()
  .then(() => { console.log('Done!'); process.exit(0); })
  .catch((error) => { console.error('Failed:', error); process.exit(1); });
