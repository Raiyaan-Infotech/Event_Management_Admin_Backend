const nodemailer = require("nodemailer");
const { EmailConfig, EmailTemplate, Setting } = require("../models");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");
const { wrapWithBaseTemplate } = require("../utils/baseEmailTemplate");

const createTransporter = (config) => {
  console.log("EMAIL DRIVER =", config.driver);
  
  switch (config.driver) {
    case "smtp":
      return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.encryption === "ssl",
        auth: config.username
          ? {
              user: config.username,
              pass: config.password,
            }
          : undefined,
        tls:
          config.encryption === "tls"
            ? { rejectUnauthorized: false }
            : undefined,
      });

    case "brevo":
      // Brevo (Sendinblue) - 300 emails/day FREE forever
      console.log("📧 Using Brevo (Sendinblue) - FREE tier");
      return nodemailer.createTransport({
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        auth: {
          user: config.username, // Your Brevo login email
          pass: config.api_key || config.password,  // Brevo SMTP key
        },
      });

    case "sendmail":
      return nodemailer.createTransport({
        sendmail: true,
        newline: "unix",
        path: "/usr/sbin/sendmail",
      });

    default:
      throw ApiError.badRequest(`Unsupported email driver: ${config.driver}`);
  }
};

const replaceVariables = (text, variables = {}) => {
  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    result = result.replace(regex, value || "");
  }
  return result;
};

const buildFullBody = async (template, options = {}) => {
  let contentBody = "";

  if (template.header_id) {
    const header = await EmailTemplate.findByPk(template.header_id);
    if (header && header.is_active) {
      contentBody += header.body + "\n";
    }
  }

  contentBody += template.body;

  if (template.footer_id) {
    const footer = await EmailTemplate.findByPk(template.footer_id);
    if (footer && footer.is_active) {
      contentBody += "\n" + footer.body;
    }
  }

  if (options.useBaseTemplate !== false) {
    return wrapWithBaseTemplate(contentBody, options);
  }

  return contentBody;
};

const getEmailSettings = async () => {
  try {
    const settings = await Setting.findAll({
      where: {
        key: [
          "admin_title",
          "support_email",
          "company_name",
          "company_address",
          "company_phone",
          "site_url",
        ],
        is_active: 1,
      },
      attributes: ["key", "value"],
    });

    const result = {};
    settings.forEach((setting) => {
      result[setting.key] = setting.value;
    });

    return result;
  } catch (error) {
    logger.logError(error);
    return {};
  }
};

const sendEmail = async (templateSlug, options = {}) => {
  try {
    const { to, variables = {}, configId, userId = null } = options;

    if (!to) {
      throw ApiError.badRequest("Recipient email (to) is required");
    }

    const template = await EmailTemplate.findOne({
      where: { slug: templateSlug, is_active: true, type: "template" },
    });

    if (!template) {
      throw ApiError.notFound(
        `Email template "${templateSlug}" not found or inactive`,
      );
    }

    let config;
    if (configId) {
      config = await EmailConfig.findByPk(configId);
    } else if (template.email_config_id) {
      config = await EmailConfig.findByPk(template.email_config_id);
    } else {
      config = await EmailConfig.findOne({
        where: { is_default: true, is_active: true },
      });
    }

    if (!config) {
      throw ApiError.badRequest(
        "No email configuration found. Please configure an email provider.",
      );
    }

    const fullBody = await buildFullBody(template);
    const dbSettings = await getEmailSettings();
    const defaultVariables = {
      app_name:
        dbSettings.admin_title || process.env.APP_NAME || "Admin Dashboard",
      support_email:
        dbSettings.support_email ||
        process.env.SUPPORT_EMAIL ||
        "support@example.com",
      company_name: dbSettings.company_name || process.env.COMPANY_NAME || "",
      company_address: dbSettings.company_address || "",
      company_phone: dbSettings.company_phone || "",
      app_url:
        dbSettings.site_url || process.env.APP_URL || "http://localhost:3000",
      current_year: new Date().getFullYear(),
    };

    const allVariables = { ...defaultVariables, ...variables };

    const subject = replaceVariables(template.subject, allVariables);
    const body = replaceVariables(fullBody, allVariables);

    const transporter = createTransporter(config);

    const mailOptions = {
      from: `"${config.from_name}" <${config.from_email}>`,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html: body,
    };

    const result = await transporter.sendMail(mailOptions);

    logger.logActivity(
      userId,
      "send_email",
      "EmailTemplate",
      `Sent email using template: ${templateSlug}`,
      {
        to,
        subject,
        templateId: template.id,
        templateSlug,
        messageId: result.messageId,
      },
    );

    return {
      success: true,
      messageId: result.messageId,
      to,
      subject,
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

const sendDirect = async (options = {}) => {
  try {
    const { to, subject, body, configId } = options;

    if (!to || !subject || !body) {
      throw ApiError.badRequest("to, subject, and body are required");
    }

    let config;
    if (configId) {
      config = await EmailConfig.findByPk(configId);
    } else {
      config = await EmailConfig.findOne({
        where: { is_default: true, is_active: true },
      });
    }

    if (!config) {
      throw ApiError.badRequest("No email configuration found.");
    }

    const transporter = createTransporter(config);

    const mailOptions = {
      from: `"${config.from_name}" <${config.from_email}>`,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      html: body,
    };

    const result = await transporter.sendMail(mailOptions);

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

const testConfig = async (configId, testEmail, templateId = null) => {
  try {
    console.log("\n🧪 Testing Email Configuration:");
    console.log("  Config ID:", configId);
    console.log("  Test Email:", testEmail || "none (connection test only)");
    console.log("  Template ID:", templateId || "none (basic test)");
    
    const config = await EmailConfig.findByPk(configId);
    if (!config) {
      throw ApiError.notFound("Email configuration not found");
    }

    console.log("  Driver:", config.driver);
    console.log("  Name:", config.name);

    const transporter = createTransporter(config);

    console.log("  Running verify()...");
    await transporter.verify();
    
    if (testEmail) {
      console.log("\n📤 Sending test email...");
      
      let subject = "Test Email - Configuration Verified";
      let htmlBody = `<p>This is a test email from your <strong>${config.name}</strong> configuration.</p><p>If you received this, your email settings are working correctly.</p>`;

      // If template ID is provided, use the template
      if (templateId) {
        console.log("  Loading template...");
        const template = await EmailTemplate.findByPk(templateId);
        
        if (!template) {
          throw ApiError.notFound("Email template not found");
        }

        if (!template.is_active) {
          throw ApiError.badRequest("Selected template is not active");
        }

        console.log("  Using Template:", template.name);

        // Build full body with header/footer if applicable
        const fullBody = await buildFullBody(template);

        // Get email settings for default variables
        const dbSettings = await getEmailSettings();
        const defaultVariables = {
          app_name: dbSettings.admin_title || process.env.APP_NAME || "Admin Dashboard",
          support_email: dbSettings.support_email || process.env.SUPPORT_EMAIL || "support@example.com",
          company_name: dbSettings.company_name || process.env.COMPANY_NAME || "",
          company_address: dbSettings.company_address || "",
          company_phone: dbSettings.company_phone || "",
          app_url: dbSettings.site_url || process.env.APP_URL || "http://localhost:3000",
          current_year: new Date().getFullYear(),
        };

        // Create sample variables for all template variables
        const sampleVars = { ...defaultVariables };
        if (template.variables && Array.isArray(template.variables)) {
          console.log("  Template variables:", template.variables);
          template.variables.forEach((varName) => {
            // Only add sample if not already in defaultVariables
            if (!sampleVars[varName]) {
              sampleVars[varName] = `[Sample ${varName}]`;
            }
          });
        }

        // Replace variables in subject and body
        subject = replaceVariables(template.subject || subject, sampleVars);
        htmlBody = replaceVariables(fullBody, sampleVars);

        // Add test prefix to subject
        subject = `[TEST] ${subject}`;
        
        console.log("  Email subject:", subject);
      }

      await transporter.sendMail({
        from: `"${config.from_name}" <${config.from_email}>`,
        to: testEmail,
        subject: subject,
        html: htmlBody,
      });

      console.log("✅ Test email sent successfully!\n");
      
      const message = templateId 
        ? `Test email sent successfully to ${testEmail} using template`
        : `Test email sent successfully to ${testEmail}`;
      
      return {
        success: true,
        message: message,
      };
    }

    console.log("✅ Connection verified successfully!\n");
    return { success: true, message: "Connection verified successfully" };
  } catch (error) {
    console.error("\n❌ Test Configuration Failed:");
    console.error("  Error:", error.message);
    console.error("  Stack:", error.stack);
    logger.logError(error);
    return { success: false, message: error.message || "Connection failed" };
  }
};

module.exports = {
  sendEmail,
  sendDirect,
  testConfig,
  createTransporter,
  replaceVariables,
  buildFullBody,
  getEmailSettings,
};