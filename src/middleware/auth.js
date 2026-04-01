const { User, Role, Permission, RefreshToken, Company } = require('../models');
const { verifyAccessToken, verifyRefreshToken, generateAccessToken, COOKIE_OPTIONS } = require('../utils/jwt');

// Check if user is authenticated (JWT cookie-based)
const isAuthenticated = async (req, res, next) => {
  try {
    const accessToken = req.cookies.access_token;
    const refreshToken = req.cookies.refresh_token;

    let decoded = null;

    // Try access token first
    if (accessToken) {
      decoded = verifyAccessToken(accessToken);
    }

    // If access token expired/invalid, try refresh token for auto-refresh
    if (!decoded && refreshToken) {
      const refreshDecoded = verifyRefreshToken(refreshToken);
      if (refreshDecoded) {
        // Validate refresh token exists and is active in DB
        const storedToken = await RefreshToken.findOne({
          where: { token: refreshToken, user_id: refreshDecoded.userId, is_active: true },
        });

        if (storedToken && storedToken.expires_at > new Date()) {
          // Fetch user to generate new access token with fresh data
          const user = await User.findByPk(refreshDecoded.userId, {
            include: [{
              model: Role,
              as: 'role',
            }],
          });

          if (user && user.is_active === 1) {
            const newAccessToken = generateAccessToken(user);
            res.cookie('access_token', newAccessToken, {
              ...COOKIE_OPTIONS,
              maxAge: 15 * 60 * 1000,
            });
            decoded = verifyAccessToken(newAccessToken);
          }
        }
      }
    }

    // No valid token at all
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login.',
      });
    }

    // Fetch fresh user with role, permissions, and company
    const user = await User.findByPk(decoded.userId, {
      include: [
        {
          model: Role,
          as: 'role',
          include: [
            {
              model: Permission,
              as: 'permissions',
            },
          ],
        },
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'slug', 'is_active', 'logo'],
        },
      ],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Please login again.',
      });
    }

    // If password was changed after this token was issued, force re-login immediately
    if (user.password_changed_at && decoded.iat) {
      const tokenIssuedAt = decoded.iat * 1000; // JWT iat is in seconds
      if (user.password_changed_at.getTime() > tokenIssuedAt) {
        return res.status(401).json({
          success: false,
          message: 'Your password was changed. Please login again.',
        });
      }
    }

    // Check is_active (1=active, 0=inactive, 2=pending)
    if (user.is_active !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Please contact admin.',
      });
    }

    // Check login_access (0 = API access revoked by admin)
    if (user.login_access !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Your login access has been revoked. Please contact admin.',
      });
    }

    // Check if role is active
    if (!user.role || !user.role.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Your role is inactive. Please contact admin.',
      });
    }

    // Check if company is active (for non-developer users)
    if (user.company_id && user.company && user.company.is_active !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Your company account is suspended. Please contact support.',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

// Check if user has specific role
const hasRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userRole = req.user.role?.slug;

    // Developer bypasses all role checks
    if (userRole === 'developer') {
      return next();
    }

    // Allow Super Admin — strict slug check only
    if (userRole === 'super_admin') {
      return next();
    }

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient role permissions.',
      });
    }

    next();
  };
};

// Check if user has specific permission
const hasPermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const roleSlug = req.user.role?.slug;

    // Developer bypasses all permission checks
    if (roleSlug === 'developer') {
      return next();
    }

    // Allow Super Admin — strict slug check only
    if (roleSlug === 'super_admin') {
      return next();
    }

    const userPermissions = req.user.role?.permissions?.map(p => p.slug) || [];
    const hasRequiredPermission = permissions.some(p => userPermissions.includes(p));

    if (!hasRequiredPermission) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.',
      });
    }

    next();
  };
};

// Check if user has minimum role level
const hasMinLevel = (requiredLevel) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Developer and Super Admin bypass level checks
    const roleSlug = req.user.role?.slug;
    if (roleSlug === 'developer' || roleSlug === 'super_admin') {
      return next();
    }

    const userLevel = req.user.role?.level || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient role level.',
      });
    }

    next();
  };
};

// Check if user is a developer (exported for route use)
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
      message: 'Access denied. Developer role required.',
    });
  }

  next();
};

module.exports = {
  isAuthenticated,
  hasRole,
  hasPermission,
  hasMinLevel,
  isDeveloper,
};