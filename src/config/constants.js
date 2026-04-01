module.exports = {
  // User Status
  USER_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    PENDING: 'pending',
    BLOCKED: 'blocked',
  },

  // Default Roles
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    USER: 'user',
  },

  // Activity Log Actions
  ACTIVITY_ACTIONS: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LOGIN: 'login',
    LOGOUT: 'logout',
    PASSWORD_CHANGE: 'password_change',
    PASSWORD_RESET: 'password_reset',
  },

  // Setting Groups
  SETTING_GROUPS: {
    GENERAL: 'general',
    MAIL: 'mail',
    PAYMENT: 'payment',
    THEME: 'theme',
    COOKIE: 'cookie',
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
  },

  // File Upload
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  ALLOWED_DOCUMENT_TYPES: ['application/pdf', 'application/msword'],
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
};
