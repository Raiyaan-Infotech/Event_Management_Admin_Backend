/**
 * Company context middleware for multi-tenant scoping
 */

/**
 * Extract company context from authenticated user
 * Sets req.companyId and req.isDeveloper
 */
const extractCompanyContext = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  const roleSlug = req.user.role?.slug;

  // Developer and super admin can work without a bound company
  // and may optionally switch context via header or query param.
  if (roleSlug === 'developer' || roleSlug === 'super_admin') {
    req.isDeveloper = roleSlug === 'developer';
    req.isSuperAdmin = roleSlug === 'super_admin';
    const companyId = req.headers['x-company-id'] || req.query.company_id;
    req.companyId = companyId ? parseInt(companyId, 10) : null;
  } else {
    req.isDeveloper = false;
    req.isSuperAdmin = false;
    req.companyId = req.user.company_id || null;

    if (!req.companyId) {
      return res.status(403).json({
        success: false,
        message: 'User is not assigned to any company.',
      });
    }
  }

  next();
};

/**
 * Restrict route to developer role only
 */
const isDeveloper = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  if (req.user.role?.slug !== 'developer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Developer access required.',
    });
  }

  next();
};

/**
 * Require a company context to be set (not null)
 */
const requireCompanyContext = (req, res, next) => {
  if (!req.companyId) {
    return res.status(400).json({
      success: false,
      message: 'Company context is required. Please select a company.',
    });
  }

  next();
};

module.exports = {
  extractCompanyContext,
  isDeveloper,
  requireCompanyContext,
};
