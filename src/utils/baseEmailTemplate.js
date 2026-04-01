/**
 * Base Email Template Utility
 * Provides a common HTML wrapper for all emails
 */

/**
 * Wrap email content with proper HTML structure
 * @param {string} content - The main email body content
 * @param {Object} options - Template options
 * @returns {string} Complete HTML email
 */
const wrapWithBaseTemplate = (content, options = {}) => {
  const {
    primaryColor = '#2563eb',
    backgroundColor = '#f3f4f6',
    textColor = '#1f2937',
    appName = '{{app_name}}',
    appUrl = '{{app_url}}',
    showFooter = true,
    year = new Date().getFullYear(),
  } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${appName}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: ${backgroundColor};
      color: ${textColor};
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      padding: 40px 20px;
      background-color: ${backgroundColor};
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background-color: ${primaryColor};
      padding: 30px 40px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      color: #ffffff;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 40px;
    }
    .content p {
      margin: 0 0 16px;
      font-size: 16px;
    }
    .content h2 {
      margin: 0 0 20px;
      font-size: 20px;
      color: ${textColor};
    }
    .btn {
      display: inline-block;
      padding: 14px 28px;
      background-color: ${primaryColor};
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
    }
    .btn:hover {
      opacity: 0.9;
    }
    .otp-code {
      display: inline-block;
      padding: 15px 30px;
      background-color: #f3f4f6;
      border: 2px dashed ${primaryColor};
      border-radius: 8px;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 8px;
      color: ${primaryColor};
      margin: 20px 0;
    }
    .footer {
      background-color: #f9fafb;
      padding: 30px 40px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    .footer p {
      margin: 0 0 8px;
      font-size: 14px;
      color: #6b7280;
    }
    .footer a {
      color: ${primaryColor};
      text-decoration: none;
    }
    .divider {
      border: 0;
      border-top: 1px solid #e5e7eb;
      margin: 20px 0;
    }
    .text-muted {
      color: #6b7280;
      font-size: 14px;
    }
    .text-center {
      text-align: center;
    }
    @media only screen and (max-width: 600px) {
      .wrapper {
        padding: 20px 10px;
      }
      .content, .header, .footer {
        padding: 25px 20px;
      }
      .otp-code {
        font-size: 24px;
        letter-spacing: 5px;
        padding: 12px 20px;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <table class="container" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="header">
          <h1>${appName}</h1>
        </td>
      </tr>
      <tr>
        <td class="content">
          ${content}
        </td>
      </tr>
      ${showFooter ? `
      <tr>
        <td class="footer">
          <p>&copy; ${year} ${appName}. All rights reserved.</p>
          <p><a href="${appUrl}">${appUrl}</a></p>
        </td>
      </tr>
      ` : ''}
    </table>
  </div>
</body>
</html>`;
};

/**
 * Common email templates content
 */
const templates = {
  // Forgot Password Template
  forgotPassword: (variables = {}) => {
    const resetLink = variables.reset_link || '{{reset_link}}';
    const userName = variables.user_name || '{{user_name}}';
    const expiryTime = variables.expiry_time || '1 hour';

    return `
      <h2>Password Reset Request</h2>
      <p>Hi ${userName},</p>
      <p>We received a request to reset your password. Click the button below to create a new password:</p>
      <div class="text-center">
        <a href="${resetLink}" class="btn">Reset Password</a>
      </div>
      <p class="text-muted">This link will expire in ${expiryTime}.</p>
      <hr class="divider">
      <p class="text-muted">If you didn't request this, please ignore this email. Your password will remain unchanged.</p>
    `;
  },

  // Welcome Email Template
  welcome: (variables = {}) => {
    const userName = variables.user_name || '{{user_name}}';
    const appUrl = variables.app_url || '{{app_url}}';

    return `
      <h2>Welcome to {{app_name}}!</h2>
      <p>Hi ${userName},</p>
      <p>Thank you for joining us! We're excited to have you on board.</p>
      <p>Your account has been created successfully. You can now access all the features of our platform.</p>
      <div class="text-center">
        <a href="${appUrl}/login" class="btn">Get Started</a>
      </div>
      <p>If you have any questions, feel free to reach out to our support team.</p>
    `;
  },

  // OTP Verification Template
  otpVerification: (variables = {}) => {
    const userName = variables.user_name || '{{user_name}}';
    const otpCode = variables.otp_code || '{{otp_code}}';
    const expiryTime = variables.expiry_time || '10 minutes';

    return `
      <h2>Verify Your Email</h2>
      <p>Hi ${userName},</p>
      <p>Use the following OTP code to verify your email address:</p>
      <div class="text-center">
        <span class="otp-code">${otpCode}</span>
      </div>
      <p class="text-muted text-center">This code will expire in ${expiryTime}.</p>
      <hr class="divider">
      <p class="text-muted">If you didn't request this code, please ignore this email.</p>
    `;
  },

  // Login OTP Template
  loginOtp: (variables = {}) => {
    const userName = variables.user_name || '{{user_name}}';
    const otpCode = variables.otp_code || '{{otp_code}}';
    const expiryTime = variables.expiry_time || '5 minutes';

    return `
      <h2>Login Verification</h2>
      <p>Hi ${userName},</p>
      <p>Your login verification code is:</p>
      <div class="text-center">
        <span class="otp-code">${otpCode}</span>
      </div>
      <p class="text-muted text-center">This code will expire in ${expiryTime}.</p>
      <hr class="divider">
      <p class="text-muted">If you didn't attempt to login, please secure your account immediately.</p>
    `;
  },

  // Password Changed Confirmation
  passwordChanged: (variables = {}) => {
    const userName = variables.user_name || '{{user_name}}';

    return `
      <h2>Password Changed Successfully</h2>
      <p>Hi ${userName},</p>
      <p>Your password has been changed successfully.</p>
      <p>If you made this change, you can safely ignore this email.</p>
      <hr class="divider">
      <p class="text-muted"><strong>Didn't change your password?</strong> Please contact our support team immediately to secure your account.</p>
    `;
  },

  // Account Activated
  accountActivated: (variables = {}) => {
    const userName = variables.user_name || '{{user_name}}';
    const appUrl = variables.app_url || '{{app_url}}';

    return `
      <h2>Account Activated!</h2>
      <p>Hi ${userName},</p>
      <p>Great news! Your account has been activated and you can now access all features.</p>
      <div class="text-center">
        <a href="${appUrl}/login" class="btn">Login Now</a>
      </div>
      <p>Thank you for your patience.</p>
    `;
  },

  // Account Deactivated
  accountDeactivated: (variables = {}) => {
    const userName = variables.user_name || '{{user_name}}';
    const reason = variables.reason || '';

    return `
      <h2>Account Deactivated</h2>
      <p>Hi ${userName},</p>
      <p>Your account has been deactivated.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>If you believe this is a mistake, please contact our support team.</p>
    `;
  },
};

/**
 * Get a complete email with base template
 * @param {string} templateName - Template name (forgotPassword, welcome, etc.)
 * @param {Object} variables - Variables to replace in template
 * @param {Object} options - Base template options
 * @returns {string} Complete HTML email
 */
const getEmailTemplate = (templateName, variables = {}, options = {}) => {
  const templateFn = templates[templateName];
  if (!templateFn) {
    throw new Error(`Template "${templateName}" not found`);
  }

  const content = templateFn(variables);
  return wrapWithBaseTemplate(content, options);
};

/**
 * Get available template names
 */
const getAvailableTemplates = () => {
  return Object.keys(templates);
};

module.exports = {
  wrapWithBaseTemplate,
  templates,
  getEmailTemplate,
  getAvailableTemplates,
};
