const { ActivityLog } = require('../models');

const logActivity = async (userId, action, module, description, oldValues = null, newValues = null, req = null, companyId = null) => {
  try {
    await ActivityLog.create({
      user_id: userId,
      action,
      module,
      description,
      old_values: oldValues,
      new_values: newValues,
      ip_address: req?.ip || req?.connection?.remoteAddress,
      user_agent: req?.get('User-Agent'),
      url: req?.originalUrl,
      method: req?.method,
      company_id: req?.companyId || companyId || null,
    });
  } catch (error) {
    console.error('Activity log error:', error);
  }
};

// Middleware to automatically log activities
const activityLoggerMiddleware = (action, module, getMessage) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = async function(data) {
      if (data.success && req.user) {
        const description = typeof getMessage === 'function'
          ? getMessage(req, data)
          : getMessage;

        await logActivity(
          req.user.id,
          action,
          module,
          description,
          req.oldValues || null,
          req.newValues || null,
          req
        );
      }
      return originalJson(data);
    };

    next();
  };
};

const logVendorActivity = async (vendorId, action, module, description, req = null) => {
  try {
    await ActivityLog.create({
      vendor_id: vendorId,
      action,
      module,
      description,
      ip_address: req?.ip || req?.connection?.remoteAddress,
      user_agent: req?.get('User-Agent'),
      url: req?.originalUrl,
      method: req?.method,
    });
  } catch (error) {
    console.error('Vendor activity log error:', error);
  }
};

module.exports = {
  logActivity,
  logVendorActivity,
  activityLoggerMiddleware,
};
