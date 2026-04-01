// Export all services
const authService = require('./auth.service');
const userService = require('./user.service');
const roleService = require('./role.service');
const permissionService = require('./permission.service');
const settingService = require('./setting.service');
const locationService = require('./location.service');
const languageService = require('./language.service');
const currencyService = require('./currency.service');
const activityLogService = require('./activityLog.service');
const emailTemplateService = require('./emailTemplate.service');

module.exports = {
  authService,
  userService,
  roleService,
  permissionService,
  settingService,
  locationService,
  languageService,
  currencyService,
  activityLogService,
  emailTemplateService,
};
