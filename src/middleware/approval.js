const { RolePermission, Permission } = require('../models');
const approvalService = require('../services/approval.service');

// Lazy-load service map to fetch old data before storing approval
let _serviceMap = null;
function getServiceMap() {
  if (!_serviceMap) {
    _serviceMap = {
      users: require('../services/user.service'),
      employees: require('../services/user.service'),
      roles: require('../services/role.service'),
      email_campaigns: require('../services/emailCampaign.service'),
      email_templates: require('../services/emailTemplate.service'),
      email_configs: require('../services/emailConfig.service'),
      settings: require('../services/setting.service'),
      currencies: require('../services/currency.service'),
      languages: require('../services/language.service'),
      locations: require('../services/location.service'),
      translations: require('../services/translation.service'),
      media: require('../services/media.service'),
      faqs: require('../services/faq.service'),
      faq_categories: require('../services/faqCategory.service'),
      vendors: require('../services/vendor.service'),
    };
  }
  return _serviceMap;
}

/**
 * Middleware to check if an action requires approval.
 * Must be placed AFTER hasPermission() in the middleware chain.
 * Super Admin (level >= 100) and Developer bypass approval.
 *
 * @param {string} moduleSlug - e.g. 'users', 'email_campaigns'
 * @param {string} action - e.g. 'create', 'update', 'delete'
 * @param {string} resourceType - e.g. 'user', 'email_campaign'
 */
function checkApprovalRequired(moduleSlug, action, resourceType) {
  return async (req, res, next) => {
    try {
      // Super Admin and Developer bypass approval
      const roleLevel = req.user.role?.level || 0;
      console.log(`[APPROVAL] module=${moduleSlug} action=${action} type=${resourceType} roleLevel=${roleLevel} role=${req.user.role?.name} roleId=${req.user.role_id}`);
      if (roleLevel >= 100) {
        console.log('[APPROVAL] BYPASSED — role level >= 100');
        return next();
      }

      const roleId = req.user.role_id;
      const permissionSlug = `${moduleSlug}.${action}`;

      // Find ALL permission records with this slug — DB may have duplicates from multiple installs
      let permissionRows = await Permission.findAll({ where: { slug: permissionSlug } });
      if (permissionRows.length === 0 && action === 'update') {
        permissionRows = await Permission.findAll({ where: { slug: `${moduleSlug}.edit` } });
      }

      console.log(`[APPROVAL] slug=${permissionSlug} found=${permissionRows.length} ids=[${permissionRows.map(p => p.id)}]`);

      if (permissionRows.length === 0) {
        console.log('[APPROVAL] SKIPPED — no permission rows found');
        return next();
      }

      const permissionIds = permissionRows.map(p => p.id);

      // Check if ANY of the matching permission IDs requires approval for this role
      // Use requires_approval: true in the WHERE to handle duplicate permission rows correctly
      const rolePermission = await RolePermission.findOne({
        where: {
          role_id: roleId,
          permission_id: permissionIds,
          requires_approval: true,
        },
      });

      console.log(`[APPROVAL] rolePermission found=${!!rolePermission} requires_approval=${rolePermission?.requires_approval}`);

      if (!rolePermission) {
        console.log('[APPROVAL] SKIPPED — requires_approval not set for this role');
        return next();
      }

      // Fetch current (old) data for edit/delete actions so approver can compare
      let oldData = null;
      let resourceId = req.params.id ? parseInt(req.params.id) : null;
      if (resourceId && (action === 'edit' || action === 'update' || action === 'delete')) {
        try {
          const services = getServiceMap();
          const service = services[moduleSlug];
          // Location module has entity-specific methods (getCountryById, getStateById, etc.)
          let getByIdFn = service ? service.getById : null;
          if (moduleSlug === 'locations' && resourceType && service) {
            const rt = resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
            getByIdFn = service[`get${rt}ById`] || null;
          }
          if (typeof getByIdFn === 'function') {
            const record = await getByIdFn(resourceId, req.companyId);
            if (record) {
              // Strip sensitive fields
              const data = record.toJSON ? record.toJSON() : record;
              const { password, ...safeData } = data;
              oldData = safeData;
            }
          }
        } catch (e) {
          // Non-fatal — continue without old data
        }
      }

      // If body is empty (e.g. toggle actions), infer the intended change from oldData
      let requestData = req.body;
      if ((!requestData || Object.keys(requestData).length === 0) && oldData && 'is_active' in oldData) {
        requestData = { is_active: !oldData.is_active };
      }

      // For CREATE: insert the record with is_active=2 (pending) so it appears in the list
      if (action === 'create') {
        try {
          const services = getServiceMap();
          const service = services[moduleSlug];
          // Location module has entity-specific create methods (createCountry, createState, etc.)
          let createFn = service ? service.create : null;
          if (moduleSlug === 'locations' && resourceType && service) {
            const rt = resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
            createFn = service[`create${rt}`] || null;
          }
          if (typeof createFn === 'function') {
            const pendingRecord = await createFn(
              { ...req.body, is_active: 2 },
              req.user.id,
              req.companyId
            );
            resourceId = pendingRecord?.id || pendingRecord?.dataValues?.id || null;
          }
        } catch (createError) {
          // Creation failed (e.g. validation error) — surface to client instead of storing approval
          return next(createError);
        }
      }

      // Approval required — create request and return 202
      const approvalRequest = await approvalService.createRequest({
        companyId: req.companyId,
        requesterId: req.user.id,
        moduleSlug,
        permissionSlug,
        action,
        resourceType,
        resourceId,
        requestData,
        oldData,
      });

      return res.status(202).json({
        success: true,
        status: 'pending_approval',
        message: 'Your request has been sent for approval',
        approval_id: approvalRequest.id,
        action,
      });
    } catch (error) {
      console.error('Error in checkApprovalRequired middleware:', error);
      return next(error);
    }
  };
}

module.exports = {
  checkApprovalRequired,
};
