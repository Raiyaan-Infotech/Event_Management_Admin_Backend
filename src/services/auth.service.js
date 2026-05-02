const { User, Role, Permission, Company, RefreshToken } = require("../models");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");
const emailSenderService = require("./emailSender.service");

/**
 * Generate 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Register new user
 */
const register = async (data) => {
  try {
    // Check if email exists
    const existingUser = await User.findOne({ where: { email: data.email } });
    if (existingUser) {
      throw ApiError.conflict("Email already registered");
    }

    // Get default role
    const defaultRole = await Role.findOne({
      where: { is_default: true, is_active: true },
    });
    if (!defaultRole) {
      throw ApiError.internal("Default role not configured");
    }

    // Create user
    const user = await User.create({
      ...data,
      role_id: defaultRole.id,
      is_active: 0,
    });

    await logger.logActivity(
      user.id,
      "register",
      "auth",
      "New user registered",
    );

    // Send welcome email
    try {
      const [settings] = await sequelize.query(
        "SELECT `value` FROM settings WHERE `key` = 'admin_title' AND is_active = 1 LIMIT 1",
        { type: sequelize.QueryTypes.SELECT },
      );

      const appName = settings?.[0]?.value || "Our Platform";

      await emailSenderService.sendEmail("welcome", {
        to: user.email,
        variables: {
          user_name: user.full_name || "User",
          app_name: appName, // ← Pass it explicitly
        },
      });
    } catch (emailError) {
      logger.logError(emailError);
    }

    return user;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Login user
 */
const login = async (email, password, req) => {
  try {
    if (!email || !password) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    // Find user with role and permissions
    const user = await User.findOne({
      where: { email },
      include: [
        {
          model: Role,
          as: "role",
          include: [
            {
              model: Permission,
              as: "permissions",
            },
          ],
        },
        {
          model: Company,
          as: "company",
          attributes: ["id", "name", "slug", "is_active", "logo"],
        },
      ],
    });
    if (!user) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    // Validate password
    const isValid = await user.validatePassword(password);
    if (!isValid) {
      throw ApiError.unauthorized("Invalid email or password");
    }

    // Check user is_active (1=active, 0=inactive, 2=pending)
    if (user.is_active !== 1) {
      throw ApiError.forbidden(
        "Your account is not active. Please contact admin.",
      );
    }

    // Check login_access
    if (user.login_access !== 1) {
      throw ApiError.forbidden(
        "Your login access has been revoked. Please contact admin.",
      );
    }

    // Check if company is active (for non-developer users)
    if (user.company_id && user.company && user.company.is_active !== 1) {
      throw ApiError.forbidden(
        "Your company account is suspended. Please contact support.",
      );
    }

    // Update last login
    await user.update({ last_login_at: new Date() });

    await logger.logActivity(user.id, "login", "auth", "User logged in", {
      ip: req?.ip,
      userAgent: req?.get("User-Agent"),
    });

    return user;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Logout user
 */
const logout = async (userId, req) => {
  try {
    await logger.logActivity(userId, "logout", "auth", "User logged out", {
      ip: req?.ip,
    });
    return true;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get current user profile
 */
const getProfile = async (userId) => {
  try {
    const user = await User.findByPk(userId, {
      include: [
        {
          model: Role,
          as: "role",
          include: [
            {
              model: Permission,
              as: "permissions",
            },
          ],
        },
        {
          model: Company,
          as: "company",
          attributes: ["id", "name", "slug", "is_active", "logo"],
        },
      ],
    });

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    return user;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update user profile
 */
const updateProfile = async (userId, data) => {
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      throw ApiError.notFound("User not found");
    }

    // Store old values for logging
    const oldValues = {
      full_name: user.full_name,
      phone: user.phone,
      avatar: user.avatar,
      timezone: user.timezone,
    };

    // Prepare update data - only include fields that are provided
    const updateData = {
      updated_by: userId,
    };

    if (data.full_name !== undefined) {
      updateData.full_name = data.full_name;
    }
    if (data.phone !== undefined) {
      updateData.phone = data.phone;
    }
    if (data.avatar !== undefined) {
      updateData.avatar = data.avatar;
    }
    if (data.timezone !== undefined) {
      updateData.timezone = data.timezone;
    }

    // Update user
    await user.update(updateData);

    // Log the activity
    logger.logActivity(userId, "update", "profile", "User updated profile", {
      oldValues,
      newValues: updateData,
    });

    // Return updated user with relations
    return await getProfile(userId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Change password
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      throw ApiError.notFound("User not found");
    }

    // Verify current password
    const isValid = await user.validatePassword(currentPassword);
    if (!isValid) {
      throw ApiError.badRequest("Current password is incorrect");
    }

    await user.update({
      password: newPassword,
      updated_by: userId,
    });

    // Invalidate all refresh tokens so other active sessions are kicked out immediately
    await RefreshToken.destroy({ where: { user_id: userId } });

    logger.logActivity(
      userId,
      "password_change",
      "auth",
      "User changed password",
    );

    // Send password changed confirmation email
    try {
      await emailSenderService.sendEmail("password_changed", {
        to: user.email,
        variables: {
          user_name: user.full_name || "User",
        },
      });
    } catch (emailError) {
      logger.logError(emailError);
    }

    return true;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Request password reset - sends OTP via email
 */
const forgotPassword = async (email) => {
  try {
    const user = await User.findOne({ where: { email } });

    // Don't reveal if email exists
    if (!user) {
      return { success: true, message: "If email exists, OTP has been sent" };
    }

    // Generate 6-digit OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await user.update({
      password_reset_token: otp,
      password_reset_expires: otpExpires,
    });

    logger.logActivity(
      user.id,
      "password_reset_request",
      "auth",
      "Password reset OTP requested",
    );

    // Send OTP email using database template
    try {
      await emailSenderService.sendEmail("password_reset_otp", {
        to: user.email,
        variables: {
          user_name: user.full_name || "User",
          otp_code: otp,
          expiry_time: "10 minutes",
        },
      });
    } catch (emailError) {
      logger.logError(emailError);
    }

    return { success: true, message: "OTP sent to your email" };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Verify OTP for password reset
 */
const verifyResetOTP = async (email, otp) => {
  try {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      throw ApiError.badRequest("Invalid email or OTP");
    }

    if (user.password_reset_token !== otp) {
      throw ApiError.badRequest("Invalid OTP");
    }

    if (user.password_reset_expires < new Date()) {
      throw ApiError.badRequest("OTP has expired");
    }

    return { success: true, message: "OTP verified successfully" };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Reset password with OTP
 */
const resetPassword = async (email, otp, newPassword) => {
  try {
    const user = await User.findOne({ where: { email } });

    if (!user) {
      throw ApiError.badRequest("Invalid email or OTP");
    }

    if (user.password_reset_token !== otp) {
      throw ApiError.badRequest("Invalid OTP");
    }

    if (user.password_reset_expires < new Date()) {
      throw ApiError.badRequest("OTP has expired");
    }

    await user.update({
      password: newPassword,
      password_reset_token: null,
      password_reset_expires: null,
    });

    logger.logActivity(
      user.id,
      "password_reset",
      "auth",
      "Password reset completed",
    );

    // Send password changed confirmation email
    try {
      await emailSenderService.sendEmail("password_changed", {
        to: user.email,
        variables: {
          user_name: user.full_name || "User",
        },
      });
    } catch (emailError) {
      logger.logError(emailError);
    }

    return { success: true, message: "Password reset successfully" };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
};
