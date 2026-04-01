const { TranslationKey, Translation, Language } = require('../../models');
const autoTranslateService = require('../../services/autoTranslate.service');

// Initial translation keys organized by group
const translationKeys = [
  // ==================== COMMON ====================
  { key: 'common.save', default_value: 'Save', group: 'common' },
  { key: 'common.cancel', default_value: 'Cancel', group: 'common' },
  { key: 'common.delete', default_value: 'Delete', group: 'common' },
  { key: 'common.edit', default_value: 'Edit', group: 'common' },
  { key: 'common.create', default_value: 'Create', group: 'common' },
  { key: 'common.update', default_value: 'Update', group: 'common' },
  { key: 'common.search', default_value: 'Search', group: 'common' },
  { key: 'common.loading', default_value: 'Loading...', group: 'common' },
  { key: 'common.saving', default_value: 'Saving...', group: 'common' },
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
  { key: 'common.previous', default_value: 'Previous', group: 'common' },
  { key: 'common.next', default_value: 'Next', group: 'common' },
  { key: 'common.yes', default_value: 'Yes', group: 'common' },
  { key: 'common.no', default_value: 'No', group: 'common' },
  { key: 'common.confirm', default_value: 'Confirm', group: 'common' },
  { key: 'common.close', default_value: 'Close', group: 'common' },
  { key: 'common.view_all', default_value: 'View All', group: 'common' },
  { key: 'common.help', default_value: 'Help', group: 'common' },
  { key: 'common.got_it', default_value: 'Got it', group: 'common' },

  // ==================== AUTH ====================
  { key: 'auth.login', default_value: 'Login', group: 'auth' },
  { key: 'auth.logout', default_value: 'Logout', group: 'auth' },
  { key: 'auth.register', default_value: 'Register', group: 'auth' },
  { key: 'auth.sign_in', default_value: 'Sign In', group: 'auth' },
  { key: 'auth.sign_out', default_value: 'Sign Out', group: 'auth' },
  { key: 'auth.password', default_value: 'Password', group: 'auth' },
  { key: 'auth.confirm_password', default_value: 'Confirm Password', group: 'auth' },
  { key: 'auth.forgot_password', default_value: 'Forgot Password?', group: 'auth' },
  { key: 'auth.reset_password', default_value: 'Reset Password', group: 'auth' },
  { key: 'auth.new_password', default_value: 'New Password', group: 'auth' },
  { key: 'auth.current_password', default_value: 'Current Password', group: 'auth' },
  { key: 'auth.remember_me', default_value: 'Remember me', group: 'auth' },
  { key: 'auth.signing_in', default_value: 'Signing in...', group: 'auth' },
  { key: 'auth.creating_account', default_value: 'Creating account...', group: 'auth' },
  { key: 'auth.admin_login', default_value: 'Admin Login', group: 'auth' },
  { key: 'auth.welcome_back', default_value: 'Welcome Back', group: 'auth' },
  { key: 'auth.create_account', default_value: 'Create Account', group: 'auth' },
  { key: 'auth.join_us', default_value: 'Join Us', group: 'auth' },
  { key: 'auth.dont_have_account', default_value: "Don't have an account?", group: 'auth' },
  { key: 'auth.already_have_account', default_value: 'Already have an account?', group: 'auth' },
  { key: 'auth.back_to_login', default_value: 'Back to Login', group: 'auth' },
  { key: 'auth.full_name', default_value: 'Full Name', group: 'auth' },
  { key: 'auth.enter_credentials', default_value: 'Enter your credentials to access the admin panel', group: 'auth' },

  // ==================== DASHBOARD ====================
  { key: 'dashboard.title', default_value: 'Dashboard', group: 'dashboard' },
  { key: 'dashboard.users', default_value: 'Users', group: 'dashboard' },
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

  // ==================== USERS ====================
  { key: 'users.title', default_value: 'Users', group: 'users' },
  { key: 'users.add_user', default_value: 'Add User', group: 'users' },
  { key: 'users.edit_user', default_value: 'Edit User', group: 'users' },
  { key: 'users.create_user', default_value: 'Create User', group: 'users' },
  { key: 'users.update_user', default_value: 'Update User', group: 'users' },
  { key: 'users.delete_user', default_value: 'Delete User', group: 'users' },
  { key: 'users.search_users', default_value: 'Search users...', group: 'users' },
  { key: 'users.no_users_found', default_value: 'No users found', group: 'users' },
  { key: 'users.role', default_value: 'Role', group: 'users' },
  { key: 'users.confirm_delete', default_value: 'Are you sure you want to delete this user?', group: 'users' },
  { key: 'users.fill_details', default_value: 'Fill in the details to create a new user.', group: 'users' },
  { key: 'users.update_details', default_value: 'Update the user details below.', group: 'users' },

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

  // ==================== SETTINGS ====================
  { key: 'settings.title', default_value: 'Settings', group: 'settings' },
  { key: 'settings.general', default_value: 'General Settings', group: 'settings' },
  { key: 'settings.email', default_value: 'Email Settings', group: 'settings' },
  { key: 'settings.languages', default_value: 'Languages', group: 'settings' },
  { key: 'settings.currencies', default_value: 'Currencies', group: 'settings' },
  { key: 'settings.timezone', default_value: 'Timezone', group: 'settings' },
  { key: 'settings.translations', default_value: 'Translations', group: 'settings' },
  { key: 'settings.manage_settings', default_value: 'Manage all your application settings and configuration', group: 'settings' },

  // ==================== PROFILE ====================
  { key: 'profile.title', default_value: 'Profile', group: 'profile' },
  { key: 'profile.personal_info', default_value: 'Personal Information', group: 'profile' },
  { key: 'profile.update_profile', default_value: 'Update Profile', group: 'profile' },
  { key: 'profile.change_password', default_value: 'Change Password', group: 'profile' },
  { key: 'profile.account_info', default_value: 'Account Info', group: 'profile' },
  { key: 'profile.your_details', default_value: 'Your account details', group: 'profile' },
  { key: 'profile.update_details', default_value: 'Update your personal details', group: 'profile' },
  { key: 'profile.password_secure', default_value: 'Update your password to keep your account secure', group: 'profile' },

  // ==================== VALIDATION ====================
  { key: 'validation.required', default_value: 'This field is required', group: 'validation' },
  { key: 'validation.email_invalid', default_value: 'Please enter a valid email', group: 'validation' },
  { key: 'validation.password_min', default_value: 'Password must be at least 6 characters', group: 'validation' },
  { key: 'validation.password_mismatch', default_value: "Passwords don't match", group: 'validation' },
  { key: 'validation.name_min', default_value: 'Name must be at least 2 characters', group: 'validation' },
  { key: 'validation.select_role', default_value: 'Please select a role', group: 'validation' },

  // ==================== ERRORS ====================
  { key: 'errors.page_not_found', default_value: 'Page Not Found', group: 'errors' },
  { key: 'errors.page_not_found_desc', default_value: "The page you are looking for doesn't exist or has been moved.", group: 'errors' },
  { key: 'errors.something_wrong', default_value: 'Something went wrong!', group: 'errors' },
  { key: 'errors.unexpected', default_value: 'An unexpected error has occurred. Please try again later.', group: 'errors' },
  { key: 'errors.go_home', default_value: 'Go Home', group: 'errors' },
  { key: 'errors.try_again', default_value: 'Try again', group: 'errors' },
  { key: 'errors.coming_soon', default_value: 'Coming Soon', group: 'errors' },
  { key: 'errors.coming_soon_desc', default_value: "We're working hard to bring you something amazing. Stay tuned!", group: 'errors' },

  // ==================== COMMON EXTRAS ====================
  { key: 'common.slug', default_value: 'Slug', group: 'common' },
  { key: 'common.slug_hint', default_value: 'Auto-generated from name.', group: 'common' },
  { key: 'common.image', default_value: 'Image', group: 'common' },
  { key: 'common.sort_order', default_value: 'Sort Order', group: 'common' },
  { key: 'common.save_exit', default_value: 'Save & Exit', group: 'common' },
  { key: 'common.publish', default_value: 'Publish', group: 'common' },
  { key: 'common.settings', default_value: 'Settings', group: 'common' },
  { key: 'common.are_you_sure', default_value: 'Are you sure?', group: 'common' },
  { key: 'common.delete_confirm', default_value: 'This action cannot be undone.', group: 'common' },
  { key: 'common.uploading', default_value: 'Uploading...', group: 'common' },
  { key: 'common.upload_success', default_value: 'Image uploaded successfully', group: 'common' },
  { key: 'common.upload_error', default_value: 'Failed to upload image', group: 'common' },

  // ==================== NAVIGATION - BLOG ====================
  { key: 'nav.blog', default_value: 'Blog', group: 'navigation' },
  { key: 'nav.blog_posts', default_value: 'Blog Posts', group: 'navigation' },
  { key: 'nav.blog_categories', default_value: 'Blog Categories', group: 'navigation' },
  { key: 'nav.blog_tags', default_value: 'Blog Tags', group: 'navigation' },
  { key: 'nav.pages', default_value: 'Pages', group: 'navigation' },
  { key: 'nav.testimonials', default_value: 'Testimonials', group: 'navigation' },
  { key: 'nav.ads', default_value: 'Ads', group: 'navigation' },
  { key: 'nav.ad_banners', default_value: 'Ad Banners', group: 'navigation' },
  { key: 'nav.menus', default_value: 'Menus', group: 'navigation' },
  { key: 'nav.simple_sliders', default_value: 'Simple Sliders', group: 'navigation' },
  { key: 'nav.vendors', default_value: 'Vendors', group: 'navigation' },
  { key: 'nav.locations', default_value: 'Locations', group: 'navigation' },
  { key: 'nav.banners', default_value: 'Ad Banners', group: 'navigation' },
  { key: 'nav.announcements', default_value: 'Announcements', group: 'navigation' },
  { key: 'nav.faqs', default_value: 'FAQs', group: 'navigation' },
  { key: 'nav.faq_list', default_value: 'FAQ List', group: 'navigation' },
  { key: 'nav.faq_categories', default_value: 'FAQ Categories', group: 'navigation' },
  { key: 'nav.media', default_value: 'Media', group: 'navigation' },
  { key: 'nav.employees', default_value: 'Employees', group: 'navigation' },
  { key: 'nav.modules', default_value: 'Modules', group: 'navigation' },
  { key: 'nav.navigation', default_value: 'Navigation', group: 'navigation' },
  { key: 'nav.newsletters', default_value: 'Newsletters', group: 'navigation' },
  { key: 'nav.contact', default_value: 'Contact', group: 'navigation' },
  { key: 'nav.plugins', default_value: 'Plugins', group: 'navigation' },
  { key: 'nav.payments', default_value: 'Payments', group: 'navigation' },
  { key: 'nav.tools', default_value: 'Tools', group: 'navigation' },
  { key: 'nav.appearance', default_value: 'Appearance', group: 'navigation' },
  { key: 'nav.theme', default_value: 'Theme', group: 'navigation' },
  { key: 'nav.menu', default_value: 'Menu', group: 'navigation' },
  { key: 'nav.theme_option', default_value: 'Theme Option', group: 'navigation' },
  { key: 'nav.approvals', default_value: 'Approvals', group: 'navigation' },
  { key: 'nav.companies', default_value: 'Companies', group: 'navigation' },
  { key: 'nav.platform_admin', default_value: 'Platform Admin', group: 'navigation' },

  // ==================== BLOG ====================
  { key: 'blog.posts_title', default_value: 'Blog Posts', group: 'blog' },
  { key: 'blog.posts_desc', default_value: 'Manage all blog posts', group: 'blog' },
  { key: 'blog.add_post', default_value: 'Add Post', group: 'blog' },
  { key: 'blog.no_posts', default_value: 'No blog posts found.', group: 'blog' },
  { key: 'blog.create_post', default_value: 'Create Blog Post', group: 'blog' },
  { key: 'blog.create_post_desc', default_value: 'Add a new post to your blog', group: 'blog' },
  { key: 'blog.edit_post', default_value: 'Edit Blog Post', group: 'blog' },
  { key: 'blog.post_not_found', default_value: 'Blog post not found.', group: 'blog' },
  { key: 'blog.title', default_value: 'Title', group: 'blog' },
  { key: 'blog.description', default_value: 'Description / Excerpt', group: 'blog' },
  { key: 'blog.content', default_value: 'Content', group: 'blog' },
  { key: 'blog.featured_image', default_value: 'Featured Image', group: 'blog' },
  { key: 'blog.image_hint', default_value: 'Recommended: 1200x630 px', group: 'blog' },
  { key: 'blog.is_featured', default_value: 'Featured Post', group: 'blog' },
  { key: 'blog.is_featured_hint', default_value: 'Show this post in featured sections', group: 'blog' },
  { key: 'blog.featured', default_value: 'Featured', group: 'blog' },
  { key: 'blog.author', default_value: 'Author', group: 'blog' },
  { key: 'blog.select_author', default_value: 'Select author...', group: 'blog' },
  { key: 'blog.categories', default_value: 'Categories', group: 'blog' },
  { key: 'blog.select_categories', default_value: 'Select categories...', group: 'blog' },
  { key: 'blog.tags', default_value: 'Tags', group: 'blog' },
  { key: 'blog.select_tags', default_value: 'Select tags...', group: 'blog' },
  { key: 'blog.seo', default_value: 'SEO', group: 'blog' },
  { key: 'blog.seo_title', default_value: 'SEO Title', group: 'blog' },
  { key: 'blog.seo_description', default_value: 'SEO Description', group: 'blog' },
  // Blog Tags
  { key: 'blog.tags_title', default_value: 'Blog Tags', group: 'blog' },
  { key: 'blog.tags_desc', default_value: 'Manage tags for blog posts', group: 'blog' },
  { key: 'blog.add_tag', default_value: 'Add Tag', group: 'blog' },
  { key: 'blog.no_tags', default_value: 'No blog tags found.', group: 'blog' },
  { key: 'blog.create_tag', default_value: 'Create Tag', group: 'blog' },
  { key: 'blog.edit_tag', default_value: 'Edit Tag', group: 'blog' },
  { key: 'blog.tag_form_desc', default_value: 'Fill in the tag details.', group: 'blog' },
  // Blog Categories
  { key: 'blog.categories_title', default_value: 'Blog Categories', group: 'blog' },
  { key: 'blog.categories_desc', default_value: 'Manage categories for blog posts', group: 'blog' },
  { key: 'blog.add_category', default_value: 'Add Category', group: 'blog' },
  { key: 'blog.no_categories', default_value: 'No blog categories found.', group: 'blog' },
  { key: 'blog.create_category', default_value: 'Create Category', group: 'blog' },
  { key: 'blog.edit_category', default_value: 'Edit Category', group: 'blog' },
  { key: 'blog.category_form_desc', default_value: 'Fill in the blog category details.', group: 'blog' },
  { key: 'blog.category_image_desc', default_value: 'Recommended size: 600x400 px', group: 'blog' },
];

/**
 * Seed translation keys and auto-translate to all active languages
 */
async function seedTranslations() {
  console.log('Starting translation seeder...');

  try {
    // Get all active languages
    const languages = await Language.findAll({ where: { is_active: true } });
    console.log(`Found ${languages.length} active languages`);

    let created = 0;
    let skipped = 0;

    for (const keyData of translationKeys) {
      // Check if key exists
      const existing = await TranslationKey.findOne({ where: { key: keyData.key } });
      if (existing) {
        skipped++;
        continue;
      }

      // Create the key
      const translationKey = await TranslationKey.create({
        key: keyData.key,
        default_value: keyData.default_value,
        description: keyData.description || null,
        group: keyData.group,
      });

      console.log(`Created key: ${keyData.key}`);
      created++;

      // Create translations for each language
      for (const language of languages) {
        let value = keyData.default_value;

        // Auto-translate for non-English languages
        if (language.code !== 'en') {
          try {
            value = await autoTranslateService.translateText(
              keyData.default_value,
              'en',
              language.code
            );
            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (error) {
            console.error(`Failed to translate ${keyData.key} to ${language.code}:`, error.message);
          }
        }

        await Translation.create({
          translation_key_id: translationKey.id,
          language_id: language.id,
          value,
          status: language.code === 'en' ? 'reviewed' : 'auto',
        });
      }
    }

    console.log(`\nSeeding completed!`);
    console.log(`Created: ${created} keys`);
    console.log(`Skipped: ${skipped} keys (already exist)`);
    console.log(`Total translations: ${created * languages.length}`);

  } catch (error) {
    console.error('Seeder error:', error);
    throw error;
  }
}

module.exports = { seedTranslations, translationKeys };

// Run directly if called from command line
if (require.main === module) {
  seedTranslations()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed:', error);
      process.exit(1);
    });
}
