const { ApprovalRequest, User } = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');

// Lazy-load services to avoid circular dependency
let _serviceMap = null;
function getServiceMap() {
  if (!_serviceMap) {
    _serviceMap = {
      // ✅ Only keep services that actually exist in your services/ folder
      users: require('./user.service'),
      employees: require('./user.service'),
      roles: require('./role.service'),
      email_campaigns: require('./emailCampaign.service'),
      email_templates: require('./emailTemplate.service'),
      email_configs: require('./emailConfig.service'),
      settings: require('./setting.service'),
      currencies: require('./currency.service'),
      languages: require('./language.service'),
      locations: require('./location.service'),
      translations: require('./translation.service'),
      faqs: require('./faq.service'),
      faq_categories: require('./faqCategory.service'),
      vendors: require('./vendor.service'),
      media: require('./media.service'),

      menus: require('./menu.service'),
      subscriptions: require('./subscription.service'),
    };
  }
  return _serviceMap;
}

/**
 * Create a new approval request
 */
const createRequest = async (data) => {
  const {
    companyId,
    requesterId,
    moduleSlug,
    permissionSlug,
    action,
    resourceType,
    resourceId,
    requestData,
    oldData,
  } = data;

  // Delete any existing pending request for the same resource+action to prevent duplicates
  const existingWhere = {
    company_id: companyId,
    module_slug: moduleSlug,
    action,
    is_active: 2,
  };
  if (resourceId) existingWhere.resource_id = resourceId;

  await ApprovalRequest.destroy({ where: existingWhere });

  const approvalRequest = await ApprovalRequest.create({
    company_id: companyId,
    requester_id: requesterId,
    module_slug: moduleSlug,
    permission_slug: permissionSlug,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    request_data: requestData,
    old_data: oldData,
    is_active: 2,
  });

  return approvalRequest;
};

/**
 * Get all approval requests with filters
 */
const getRequests = async (filters = {}) => {
  const {
    companyId,
    is_active,
    requesterId,
    moduleSlug,
    page = 1,
    limit = 10,
  } = filters;

  const where = {};

  if (companyId) where.company_id = companyId;
  if (is_active !== undefined && is_active !== null) where.is_active = is_active;
  if (requesterId) where.requester_id = requesterId;
  if (moduleSlug) where.module_slug = moduleSlug;

  const offset = (page - 1) * limit;

  const { rows: requests, count: total } = await ApprovalRequest.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'requester',
        attributes: ['id', 'full_name', 'email'],
      },
      {
        model: User,
        as: 'approver',
        attributes: ['id', 'full_name', 'email'],
      },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return {
    data: requests,
    pagination: {
      page,
      limit,
      totalItems: total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
      hasPrevPage: page > 1,
    },
  };
};

/**
 * Get single approval request by ID
 */
const getRequestById = async (id, companyId = null) => {
  const where = { id };
  if (companyId) where.company_id = companyId;

  const request = await ApprovalRequest.findOne({
    where,
    include: [
      {
        model: User,
        as: 'requester',
        attributes: ['id', 'full_name', 'email', 'role_id'],
      },
      {
        model: User,
        as: 'approver',
        attributes: ['id', 'full_name', 'email'],
      },
    ],
  });

  if (!request) {
    throw ApiError.notFound('Approval request not found');
  }

  return request;
};

/**
 * Get pending requests count
 */
const getPendingCount = async (companyId = null) => {
  const where = { is_active: 2 };
  if (companyId) where.company_id = companyId;

  const count = await ApprovalRequest.count({ where });
  return count;
};

/**
 * Approve a request and execute the original action
 */
const approveRequest = async (id, approverId, reviewNotes = null) => {
  const request = await ApprovalRequest.findByPk(id);

  if (!request) {
    throw ApiError.notFound('Approval request not found');
  }

  if (request.is_active !== 2) {
    throw new Error('Request has already been reviewed');
  }

  // Execute the original action
  let executionResult = null;
  try {
    executionResult = await executeApprovedAction(request);
  } catch (execError) {
    throw new Error(`Approval failed during execution: ${execError.message}`);
  }

  // Mark as approved after successful execution
  request.is_active = 1;
  request.approver_id = approverId;
  request.reviewed_at = new Date();
  request.review_notes = reviewNotes;
  if (executionResult?.id) {
    request.resource_id = executionResult.id;
  }

  await request.save();
  await logger.logActivity(approverId, 'approve', 'ApprovalRequest', `Approved ${request.action} request for ${request.module_slug} #${request.resource_id || 'new'}`, { recordId: request.id, companyId: request.company_id });

  return { approval: request, result: executionResult };
};

/**
 * Execute the original action stored in an approval request.
 * Maps module_slug + action to the correct service method.
 */
/**
 * For the locations module, resolve entity-specific method names
 * using resource_type (country, state, district, city, pincode).
 */
const getLocationMethod = (service, resource_type, methodPrefix) => {
  if (!resource_type) throw new Error('Resource type required for location module');
  const rt = resource_type.charAt(0).toUpperCase() + resource_type.slice(1);
  // create→createCountry, update→updateCountry, delete→deleteCountry, getById→getCountryById
  const methodName = methodPrefix === 'getById'
    ? `get${rt}ById`
    : `${methodPrefix}${rt}`;
  const fn = service[methodName];
  if (typeof fn !== 'function') {
    throw new Error(`No ${methodPrefix} method found for location type: ${resource_type}`);
  }
  return fn;
};

const executeApprovedAction = async (request) => {
  const { module_slug, action, request_data, resource_id, company_id, requester_id, resource_type } = request;
  const services = getServiceMap();
  const service = services[module_slug];

  if (!service) {
    throw new Error(`No service found for module: ${module_slug}`);
  }

  // Settings module uses bulkUpdate with no resource_id
  if (module_slug === 'settings' && (action === 'edit' || action === 'update')) {
    const { group = 'general', ...keyValues } = request_data || {};
    return await service.bulkUpdate(keyValues, group, requester_id, company_id);
  }

  // Location module has entity-specific methods (createCountry, updateState, etc.)
  if (module_slug === 'locations') {
    switch (action) {
      case 'create':
        if (resource_id) {
          const updateFn = getLocationMethod(service, resource_type, 'update');
          return await updateFn(resource_id, { ...request_data, is_active: 1 }, requester_id);
        }
        const createFn = getLocationMethod(service, resource_type, 'create');
        return await createFn(request_data, requester_id);
      case 'update':
      case 'edit':
        if (!resource_id) throw new Error('Resource ID required for update');
        const editFn = getLocationMethod(service, resource_type, 'update');
        return await editFn(resource_id, request_data, requester_id);
      case 'delete':
        if (!resource_id) throw new Error('Resource ID required for delete');
        const deleteFn = getLocationMethod(service, resource_type, 'delete');
        return await deleteFn(resource_id, requester_id);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  switch (action) {
    case 'create':
      // Record was already created with is_active=2 (pending) — just activate it
      if (resource_id && typeof service.update === 'function') {
        return await service.update(resource_id, { ...request_data, is_active: 1 }, requester_id, company_id);
      }
      // Fallback for legacy requests without resource_id
      return await service.create(request_data, requester_id, company_id);
    case 'update':
    case 'edit':
      if (!resource_id) throw new Error('Resource ID required for update');
      return await service.update(resource_id, request_data, requester_id, company_id);
    case 'delete':
      if (!resource_id) throw new Error('Resource ID required for delete');
      return await service.remove(resource_id, requester_id, company_id);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
};

/**
 * Reject a request
 */
const rejectRequest = async (id, approverId, reviewNotes = null) => {
  const request = await ApprovalRequest.findByPk(id);

  if (!request) {
    throw ApiError.notFound('Approval request not found');
  }

  if (request.is_active !== 2) {
    throw new Error('Request has already been reviewed');
  }

  // For CREATE rejections: delete the pending record (is_active=2) that was pre-inserted
  if (request.action === 'create' && request.resource_id) {
    try {
      const services = getServiceMap();
      const service = services[request.module_slug];
      if (service) {
        // Location module has entity-specific delete methods (deleteCountry, deleteState, etc.)
        if (request.module_slug === 'locations' && request.resource_type) {
          const deleteFn = getLocationMethod(service, request.resource_type, 'delete');
          await deleteFn(request.resource_id, approverId);
        } else if (typeof service.remove === 'function') {
          await service.remove(request.resource_id, approverId, request.company_id);
        }
      }
    } catch (e) {
      // Non-fatal — still mark approval as rejected
    }
  }

  request.is_active = 0;
  request.approver_id = approverId;
  request.reviewed_at = new Date();
  request.review_notes = reviewNotes;

  await request.save();
  await logger.logActivity(approverId, 'reject', 'ApprovalRequest', `Rejected ${request.action} request for ${request.module_slug} #${request.resource_id || 'new'}`, { recordId: request.id, companyId: request.company_id });

  return request;
};

/**
 * Cancel a request (by requester)
 */
const cancelRequest = async (id, requesterId) => {
  const request = await ApprovalRequest.findOne({
    where: {
      id,
      requester_id: requesterId,
      is_active: 2,
    },
  });

  if (!request) {
    throw new Error('Approval request not found or cannot be cancelled');
  }

  await request.destroy();
  return true;
};

/**
 * Check if a permission requires approval for a user
 */
const checkApprovalRequired = async (userId, permissionSlug) => {
  const user = await User.findByPk(userId, {
    include: [
      {
        association: 'role',
        include: [
          {
            association: 'permissions',
            where: { slug: permissionSlug },
            through: {
              attributes: ['requires_approval'],
            },
            required: false,
          },
        ],
      },
    ],
  });

  if (!user || !user.role) {
    return { hasPermission: false, requiresApproval: false };
  }

  const permission = user.role.permissions?.find(p => p.slug === permissionSlug);

  if (!permission) {
    return { hasPermission: false, requiresApproval: false };
  }

  const requiresApproval = permission.RolePermission?.requires_approval || false;

  return {
    hasPermission: true,
    requiresApproval,
  };
};

module.exports = {
  createRequest,
  getRequests,
  getRequestById,
  getPendingCount,
  approveRequest,
  rejectRequest,
  cancelRequest,
  checkApprovalRequired,
};
