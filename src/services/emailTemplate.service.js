const { EmailTemplate, EmailConfig } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const { generateSlug } = require('../utils/helpers');
const emailSenderService = require('./emailSender.service');

const MODEL_NAME = 'EmailTemplate';

/**
 * Get all email templates (with optional type filter)
 */
const getAll = async (query = {}, companyId = undefined) => {
  const options = {
    searchFields: ['name', 'slug', 'subject'],
    sortableFields: ['created_at', 'name', 'slug'],
    companyId,
    include: [
      {
        model: EmailConfig,
        as: 'email_config',
        attributes: ['id', 'name', 'driver', 'from_email'],
      },
      {
        model: EmailTemplate,
        as: 'header',
        attributes: ['id', 'name'],
      },
      {
        model: EmailTemplate,
        as: 'footer',
        attributes: ['id', 'name'],
      },
    ],
  };

  options.moduleSlug = 'email_templates';
  return baseService.getAll(EmailTemplate, MODEL_NAME, query, options);
};

/**
 * Get email template by ID
 */
const getById = async (id, companyId = undefined) => {
  const template = await EmailTemplate.findByPk(id, {
    include: [
      {
        model: EmailConfig,
        as: 'email_config',
        attributes: ['id', 'name', 'driver', 'from_email'],
      },
      {
        model: EmailTemplate,
        as: 'header',
        attributes: ['id', 'name', 'body'],
      },
      {
        model: EmailTemplate,
        as: 'footer',
        attributes: ['id', 'name', 'body'],
      },
    ],
  });

  if (!template) {
    throw ApiError.notFound('Email template not found');
  }

  // Validate company ownership
  if (companyId !== undefined && companyId !== null) {
    if (template.company_id && template.company_id !== companyId) {
      throw ApiError.notFound('Email template not found');
    }
  }

  return template;
};

/**
 * Get all headers and footers (for dropdown selections)
 */
const getPartsTemplates = async () => {
  return { headers: [], footers: [] };
};

/**
 * Get email template by slug
 */
const getBySlug = async (slug, companyId = undefined) => {
  try {
    const where = { slug, is_active: true };
    if (companyId !== undefined && companyId !== null) {
      where.company_id = companyId;
    }

    const template = await EmailTemplate.findOne({ where });

    if (!template) {
      throw ApiError.notFound('Email template not found');
    }

    logger.logDB('findBySlug', MODEL_NAME, null, { slug });
    return template;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Create email template
 */
const create = async (data, userId = null, companyId = undefined) => {
  try {
    if (!data.slug) {
      data.slug = generateSlug(data.name);
    }

    // Uniqueness check scoped to company
    const whereClause = { slug: data.slug };
    if (companyId !== undefined && companyId !== null) {
      whereClause.company_id = companyId;
    }

    const existing = await EmailTemplate.findOne({ where: whereClause });
    if (existing) {
      throw ApiError.conflict('Email template with this slug already exists');
    }

    // Extract variables from body and subject
    if (!data.variables) {
      data.variables = extractVariables(data.body, data.subject);
    }

    return baseService.create(EmailTemplate, MODEL_NAME, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update email template
 */
const update = async (id, data, userId = null, companyId = undefined) => {
  try {
    const template = await EmailTemplate.findByPk(id);
    if (!template) {
      throw ApiError.notFound('Email template not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (template.company_id && template.company_id !== companyId) {
        throw ApiError.notFound('Email template not found');
      }
    }

    // Check slug uniqueness within company
    if (data.slug && data.slug !== template.slug) {
      const whereClause = { slug: data.slug };
      if (companyId !== undefined && companyId !== null) {
        whereClause.company_id = companyId;
      }
      const existing = await EmailTemplate.findOne({ where: whereClause });
      if (existing) {
        throw ApiError.conflict('Email template with this slug already exists');
      }
    }

    // Auto-extract variables if body or subject changed
    if (data.body || data.subject) {
      data.variables = extractVariables(
        data.body || template.body,
        data.subject || template.subject
      );
    }

    return baseService.update(EmailTemplate, MODEL_NAME, id, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Toggle active status
 */
const toggleActive = async (id, userId = null, companyId = undefined) => {
  try {
    const template = await EmailTemplate.findByPk(id);
    if (!template) {
      throw ApiError.notFound('Email template not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (template.company_id && template.company_id !== companyId) {
        throw ApiError.notFound('Email template not found');
      }
    }

    return baseService.update(EmailTemplate, MODEL_NAME, id, {
      is_active: !template.is_active,
    }, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete email template
 */
const remove = async (id, userId = null, companyId = undefined) => {
  return baseService.remove(EmailTemplate, MODEL_NAME, id, userId, companyId, { uniqueFields: ['slug'] });
};

/**
 * Preview email template with sample data (includes header/footer)
 */
const preview = async (id, sampleData = {}) => {
  try {
    const template = await EmailTemplate.findByPk(id);
    if (!template) {
      throw ApiError.notFound('Email template not found');
    }

    const fullBody = await emailSenderService.buildFullBody(template);

    const defaultVariables = {
      app_name: process.env.APP_NAME || 'Admin Dashboard',
      app_url: process.env.APP_URL || 'http://localhost:3000',
      current_year: new Date().getFullYear(),
      user_name: 'John Doe',
      user_email: 'john@example.com',
    };

    const allVariables = { ...defaultVariables, ...sampleData };

    let subject = template.subject || '';
    let body = fullBody;

    subject = emailSenderService.replaceVariables(subject, allVariables);
    body = emailSenderService.replaceVariables(body, allVariables);

    logger.logDB('preview', MODEL_NAME, id);

    return {
      subject,
      body,
      variables: template.variables,
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Send email using template
 */
const send = async (id, options = {}, userId = null) => {
  try {
    const template = await EmailTemplate.findByPk(id);
    if (!template) {
      throw ApiError.notFound('Email template not found');
    }

    return emailSenderService.sendEmail(template.slug, {
      ...options,
      userId,
    });
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Render email template (for internal use)
 */
const render = async (slug, data = {}) => {
  try {
    const template = await getBySlug(slug);

    const fullBody = await emailSenderService.buildFullBody(template);

    const defaultVariables = {
      app_name: process.env.APP_NAME || 'Admin Dashboard',
      app_url: process.env.APP_URL || 'http://localhost:3000',
      current_year: new Date().getFullYear(),
    };

    const allVariables = { ...defaultVariables, ...data };

    const subject = emailSenderService.replaceVariables(template.subject || '', allVariables);
    const body = emailSenderService.replaceVariables(fullBody, allVariables);

    return { subject, body };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Extract variables from template content
 */
const extractVariables = (body = '', subject = '') => {
  const combined = `${subject} ${body}`;
  const regex = /{{(\w+)}}/g;
  const variables = new Set();
  let match;

  while ((match = regex.exec(combined)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables);
};

/**
 * Get available template variables
 */
const getAvailableVariables = async () => {
  const { Setting } = require('../models');

  const settings = await Setting.findAll({
    where: { group: 'email_variables', is_active: true },
    attributes: ['key', 'value', 'description'],
    order: [['key', 'ASC']],
  });

  const systemVariables = [
    { key: 'user_name', description: 'Username', category: 'user' },
    { key: 'full_name', description: 'user full name', category: 'user' },
    { key: 'user_email', description: "User's email address", category: 'user' },
    { key: 'app_name', description: 'Application name', category: 'system' },
    { key: 'app_url', description: 'Application URL', category: 'system' },
    { key: 'current_year', description: 'Current year', category: 'system' },
    { key: 'current_date', description: 'Current date', category: 'system' },
    { key: 'otp_code', description: 'Verification code', category: 'auth' },
    { key: 'reset_link', description: 'Password reset link', category: 'auth' },
    { key: 'verification_link', description: 'Email verification link', category: 'auth' },
    { key: 'support_email', description: 'Support email address', category: 'system' },
    { key: 'company_name', description: 'Company name', category: 'system' },
    { key: 'company_address', description: 'Company address', category: 'system' },
    { key: 'company_phone', description: 'Company phone number', category: 'system' },
  ];

  const customVariables = settings.map(s => ({
    key: s.key,
    description: s.description || s.value,
    category: 'custom',
  }));

  return [...systemVariables, ...customVariables];
};

module.exports = {
  getAll,
  getById,
  getBySlug,
  getPartsTemplates,
  create,
  update,
  toggleActive,
  remove,
  preview,
  send,
  render,
  getAvailableVariables,
};
