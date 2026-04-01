const { EmailCampaign, EmailTemplate, EmailConfig, EmailQueue, EmailSentLog, Sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'EmailCampaign';

/**
 * Pre-defined holidays with their dates
 */
const HOLIDAYS = {
  new_year: { month: 1, day: 1, name: 'New Year' },
  valentine: { month: 2, day: 14, name: "Valentine's Day" },
  independence_day_us: { month: 7, day: 4, name: 'Independence Day (US)' },
  halloween: { month: 10, day: 31, name: 'Halloween' },
  christmas_eve: { month: 12, day: 24, name: 'Christmas Eve' },
  christmas: { month: 12, day: 25, name: 'Christmas' },
  new_year_eve: { month: 12, day: 31, name: "New Year's Eve" },
  republic_day: { month: 1, day: 26, name: 'Republic Day (India)' },
  independence_day_in: { month: 8, day: 15, name: 'Independence Day (India)' },
};

/**
 * Generate slug from name
 */
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

/**
 * Get all email campaigns
 */
const getAll = async (query = {}, companyId = undefined) => {
  return baseService.getAll(EmailCampaign, MODEL_NAME, query, {
    searchFields: ['name', 'description', 'holiday_name'],
    sortableFields: ['created_at', 'name', 'campaign_type', 'is_active', 'next_run_at'],
    companyId,
    moduleSlug: 'email_campaigns',
    include: [
      {
        model: EmailTemplate,
        as: 'template',
        attributes: ['id', 'name', 'slug', 'subject'],
      },
      {
        model: EmailConfig,
        as: 'email_config',
        attributes: ['id', 'name', 'driver'],
      },
    ],
  });
};

/**
 * Get campaign by ID
 */
const getById = async (id, companyId = undefined) => {
  const campaign = await EmailCampaign.findByPk(id, {
    include: [
      {
        model: EmailTemplate,
        as: 'template',
        attributes: ['id', 'name', 'slug', 'subject', 'body', 'variables'],
      },
      {
        model: EmailConfig,
        as: 'email_config',
        attributes: ['id', 'name', 'driver', 'from_email', 'from_name'],
      },
    ],
  });

  if (!campaign) {
    throw ApiError.notFound('Email campaign not found');
  }

  // Validate company ownership
  if (companyId !== undefined && companyId !== null) {
    if (campaign.company_id && campaign.company_id !== companyId) {
      throw ApiError.notFound('Email campaign not found');
    }
  }

  return campaign;
};

/**
 * Create email campaign
 */
const create = async (data, userId = null, companyId = undefined) => {
  try {
    // Validate template exists
    const template = await EmailTemplate.findByPk(data.email_template_id);
    if (!template) {
      throw ApiError.badRequest('Email template not found');
    }

    if (!data.slug) {
      data.slug = generateSlug(data.name);
    }

    const slugExists = await EmailCampaign.findOne({ where: { slug: data.slug, ...(companyId ? { company_id: companyId } : {}) } });
    if (slugExists) throw ApiError.conflict(`An email campaign with this slug already exists.`);

    // Set holiday date if holiday campaign
    if (data.campaign_type === 'holiday' && data.holiday_name) {
      const holiday = HOLIDAYS[data.holiday_name];
      if (holiday) {
        data.holiday_month = holiday.month;
        data.holiday_day = holiday.day;
      }
    }

    // Calculate next run date
    data.next_run_at = calculateNextRunDate(data);

    return baseService.create(EmailCampaign, MODEL_NAME, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update email campaign
 */
const update = async (id, data, userId = null, companyId = undefined) => {
  try {
    const campaign = await EmailCampaign.findByPk(id);
    if (!campaign) {
      throw ApiError.notFound('Email campaign not found');
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (campaign.company_id && campaign.company_id !== companyId) {
        throw ApiError.notFound('Email campaign not found');
      }
    }

    if (data.slug && data.slug !== campaign.slug) {
      const slugExists = await EmailCampaign.findOne({ where: { slug: data.slug, id: { [Op.ne]: id }, ...(companyId ? { company_id: companyId } : {}) } });
      if (slugExists) throw ApiError.conflict(`An email campaign with this slug already exists.`);
    }

    // Update holiday dates if changed
    if (data.campaign_type === 'holiday' && data.holiday_name) {
      const holiday = HOLIDAYS[data.holiday_name];
      if (holiday) {
        data.holiday_month = holiday.month;
        data.holiday_day = holiday.day;
      }
    }

    // Recalculate next run date
    const updatedData = { ...campaign.toJSON(), ...data };
    data.next_run_at = calculateNextRunDate(updatedData);

    return baseService.update(EmailCampaign, MODEL_NAME, id, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete email campaign
 */
const remove = async (id, userId = null, companyId = undefined) => {
  await EmailQueue.destroy({ where: { campaign_id: id } });
  return baseService.remove(EmailCampaign, MODEL_NAME, id, userId, companyId, { uniqueFields: ['slug'] });
};

/**
 * Calculate next run date for campaign
 */
const calculateNextRunDate = (campaign) => {
  const now = new Date();
  const currentYear = now.getFullYear();

  switch (campaign.campaign_type) {
    case 'holiday': {
      if (!campaign.holiday_month || !campaign.holiday_day) return null;

      let nextDate = new Date(currentYear, campaign.holiday_month - 1, campaign.holiday_day);
      if (nextDate <= now) {
        nextDate = new Date(currentYear + 1, campaign.holiday_month - 1, campaign.holiday_day);
      }

      if (campaign.scheduled_time) {
        const [hours, minutes] = campaign.scheduled_time.split(':');
        nextDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      } else {
        nextDate.setHours(8, 0, 0, 0);
      }

      return nextDate;
    }

    case 'scheduled': {
      if (!campaign.scheduled_date) return null;

      const scheduledDate = new Date(campaign.scheduled_date);
      if (campaign.scheduled_time) {
        const [hours, minutes] = campaign.scheduled_time.split(':');
        scheduledDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      } else {
        scheduledDate.setHours(8, 0, 0, 0);
      }

      return scheduledDate > now ? scheduledDate : null;
    }

    case 'recurring': {
      return null;
    }

    default:
      return null;
  }
};

/**
 * Get list of available holidays
 */
const getHolidays = () => {
  return Object.entries(HOLIDAYS).map(([key, value]) => ({
    key,
    ...value,
  }));
};

/**
 * Get campaign statistics
 */
const getStatistics = async (id) => {
  const campaign = await EmailCampaign.findByPk(id);
  if (!campaign) {
    throw ApiError.notFound('Email campaign not found');
  }

  const [queueStats, sentStats] = await Promise.all([
    EmailQueue.findAll({
      where: { campaign_id: id },
      attributes: [
        'status',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count'],
      ],
      group: ['status'],
      raw: true,
    }),
    EmailSentLog.findAll({
      where: { campaign_id: id },
      attributes: [
        'status',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count'],
      ],
      group: ['status'],
      raw: true,
    }),
  ]);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      total_recipients: campaign.total_recipients,
      total_sent: campaign.total_sent,
      total_failed: campaign.total_failed,
      last_run_at: campaign.last_run_at,
      next_run_at: campaign.next_run_at,
    },
    queue: queueStats.reduce((acc, item) => {
      acc[item.status] = parseInt(item.count);
      return acc;
    }, {}),
    sent: sentStats.reduce((acc, item) => {
      acc[item.status] = parseInt(item.count);
      return acc;
    }, {}),
  };
};

/**
 * Activate campaign
 */
const activate = async (id, userId = null, companyId = undefined) => {
  const campaign = await EmailCampaign.findByPk(id);
  if (!campaign) {
    throw ApiError.notFound('Email campaign not found');
  }

  // Validate company ownership
  if (companyId !== undefined && companyId !== null) {
    if (campaign.company_id && campaign.company_id !== companyId) {
      throw ApiError.notFound('Email campaign not found');
    }
  }

  const next_run_at = calculateNextRunDate(campaign.toJSON());

  await campaign.update({
    is_active: 1,
    next_run_at,
    updated_by: userId,
  });

  // Check if campaign should run NOW and queue emails immediately
  const now = new Date();
  let shouldQueueNow = false;

  if (campaign.campaign_type === 'scheduled' && campaign.scheduled_date) {
    const scheduledDate = new Date(campaign.scheduled_date);
    if (campaign.scheduled_time) {
      const [hours, minutes] = campaign.scheduled_time.split(':');
      scheduledDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    } else {
      scheduledDate.setHours(8, 0, 0, 0);
    }
    shouldQueueNow = scheduledDate <= now;
  } else if (campaign.campaign_type === 'holiday') {
    const today = now;
    shouldQueueNow = (
      campaign.holiday_month === today.getMonth() + 1 &&
      campaign.holiday_day === today.getDate()
    );
  }

  if (shouldQueueNow) {
    const emailSchedulerService = require('./emailScheduler.service');
    try {
      const queueResult = await emailSchedulerService.queueCampaignEmails(campaign);
      logger.logActivity('campaign_auto_queued', MODEL_NAME, id, userId, {
        queued: queueResult.queued,
        skipped: queueResult.skipped,
      });
    } catch (error) {
      logger.logError(error);
    }
  }

  return campaign.reload();
};

/**
 * Pause campaign
 */
const pause = async (id, userId = null, companyId = undefined) => {
  const campaign = await EmailCampaign.findByPk(id);
  if (!campaign) {
    throw ApiError.notFound('Email campaign not found');
  }

  // Validate company ownership
  if (companyId !== undefined && companyId !== null) {
    if (campaign.company_id && campaign.company_id !== companyId) {
      throw ApiError.notFound('Email campaign not found');
    }
  }

  return campaign.update({
    is_active: 0,
    updated_by: userId,
  });
};

/**
 * Get default variable mappings based on user model
 */
const getDefaultVariableMappings = () => {
  return {
    user_name: { source: 'user', field: 'full_name' },
    user_email: { source: 'user', field: 'email' },
    user_full_name: { source: 'user', field: 'full_name' },
    app_name: { source: 'setting', key: 'app_name', default: 'Our App' },
    app_url: { source: 'setting', key: 'app_url', default: process.env.APP_URL || 'http://localhost:3000' },
    current_year: { source: 'computed', compute: 'new Date().getFullYear()' },
    current_date: { source: 'computed', compute: 'new Date().toLocaleDateString()' },
  };
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  getHolidays,
  getStatistics,
  activate,
  pause,
  calculateNextRunDate,
  getDefaultVariableMappings,
  HOLIDAYS,
};
