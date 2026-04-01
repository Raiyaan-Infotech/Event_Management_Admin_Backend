/**
 * Email Scheduler Service
 * Runs daily at 8 AM to check for campaigns that need to be queued
 */

const cron = require('node-cron');
const { EmailCampaign, EmailTemplate, EmailConfig, EmailQueue, EmailSentLog, User, Setting, sequelize } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const emailCampaignService = require('./emailCampaign.service');

/**
 * Check if today matches a holiday campaign
 */
const isTodayHoliday = (campaign) => {
  const today = new Date();
  return (
    campaign.holiday_month === today.getMonth() + 1 &&
    campaign.holiday_day === today.getDate()
  );
};

/**
 * Check if campaign should run now (date matches and time has passed)
 */
const isTodayScheduled = (campaign) => {
  if (!campaign.scheduled_date) return false;

  const now = new Date();
  const scheduled = new Date(campaign.scheduled_date);

  // Set the scheduled time (default 8 AM if not specified)
  if (campaign.scheduled_time) {
    const [hours, minutes] = campaign.scheduled_time.split(':');
    scheduled.setHours(parseInt(hours), parseInt(minutes), 0, 0);
  } else {
    scheduled.setHours(8, 0, 0, 0);
  }

  // Check if same day AND time has passed
  const sameDay = (
    now.getFullYear() === scheduled.getFullYear() &&
    now.getMonth() === scheduled.getMonth() &&
    now.getDate() === scheduled.getDate()
  );

  return sameDay && now >= scheduled;
};

/**
 * Get users based on campaign target audience
 */
const getTargetUsers = async (campaign) => {
  const where = {
    is_active: true,
  };

  switch (campaign.target_audience) {
    case 'all_users':
      // No additional filters
      break;

    case 'active_users':
      where.is_active = 1;
      break;

    case 'verified_users':
      where.is_active = 1;
      where.email_verified_at = { [Op.ne]: null };
      break;

    case 'custom':
      where.is_active = 1;
      if (campaign.target_roles && campaign.target_roles.length > 0) {
        where.role_id = { [Op.in]: campaign.target_roles };
      }
      break;
  }

  return User.findAll({
    where,
    attributes: ['id', 'email', 'full_name', 'phone'],
  });
};

/**
 * Get setting value by key
 */
const getSettingValue = async (key, defaultValue = '') => {
  const setting = await Setting.findOne({ where: { key } });
  return setting?.value || defaultValue;
};

/**
 * Build variables for a specific user
 */
const buildUserVariables = async (user, campaign) => {
  const mappings = campaign.variable_mappings || emailCampaignService.getDefaultVariableMappings();
  const variables = {};

  for (const [varName, mapping] of Object.entries(mappings)) {
    switch (mapping.source) {
      case 'user':
        variables[varName] = user[mapping.field] || '';
        break;

      case 'setting':
        variables[varName] = await getSettingValue(mapping.key, mapping.default || '');
        break;

      case 'computed':
        if (mapping.compute === 'full_name') {
          variables[varName] = user.full_name || '';
        } else if (mapping.compute === 'new Date().getFullYear()') {
          variables[varName] = new Date().getFullYear().toString();
        } else if (mapping.compute === 'new Date().toLocaleDateString()') {
          variables[varName] = new Date().toLocaleDateString();
        }
        break;

      case 'static':
        variables[varName] = mapping.value || '';
        break;

      default:
        variables[varName] = '';
    }
  }

  // Always include these basic variables
  variables.user_name = variables.user_name || user.full_name || 'User';
  variables.user_email = variables.user_email || user.email;
  variables.app_name = variables.app_name || await getSettingValue('app_name', 'Our App');
  variables.app_url = variables.app_url || await getSettingValue('app_url', process.env.APP_URL || 'http://localhost:3000');
  variables.current_year = new Date().getFullYear().toString();

  return variables;
};

/**
 * Replace variables in text
 */
const replaceVariables = (text, variables) => {
  if (!text) return text;

  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    result = result.replace(regex, value || '');
  }
  return result;
};

/**
 * Build full email body with header and footer
 */
const buildFullBody = async (template) => {
  let fullBody = '';

  // Get header if assigned
  if (template.header_id) {
    const header = await EmailTemplate.findByPk(template.header_id);
    if (header && header.is_active) {
      fullBody += header.body + '\n';
    }
  }

  // Main body
  fullBody += template.body;

  // Get footer if assigned
  if (template.footer_id) {
    const footer = await EmailTemplate.findByPk(template.footer_id);
    if (footer && footer.is_active) {
      fullBody += '\n' + footer.body;
    }
  }

  return fullBody;
};

/**
 * Add users to queue for a campaign
 */
const queueCampaignEmails = async (campaign) => {
  const today = new Date();
  const runDate = today.toISOString().split('T')[0];
  const runYear = today.getFullYear();

  logger.logActivity('campaign_queue_start', 'EmailCampaign', campaign.id, null, {
    campaign_name: campaign.name,
    run_date: runDate,
  });

  try {
    // Get template with full body
    const template = await EmailTemplate.findByPk(campaign.email_template_id, {
      include: [
        { model: EmailTemplate, as: 'header' },
        { model: EmailTemplate, as: 'footer' },
      ],
    });

    if (!template || !template.is_active) {
      logger.logError(new Error(`Template not found or inactive for campaign ${campaign.id}`));
      return { queued: 0, skipped: 0, errors: 1 };
    }

    const fullBody = await buildFullBody(template);

    // Get target users
    const users = await getTargetUsers(campaign);
    logger.logActivity('campaign_users_found', 'EmailCampaign', campaign.id, null, {
      user_count: users.length,
    });

    // Get email config
    const emailConfigId = campaign.email_config_id || template.email_config_id;

    let queued = 0;
    let skipped = 0;
    const errors = [];

    // Process users in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (user) => {
        try {
          // Check if already sent this campaign to this user for this date/year
          const alreadySent = await EmailSentLog.findOne({
            where: {
              campaign_id: campaign.id,
              user_id: user.id,
              run_date: runDate,
              run_year: runYear,
            },
          });

          if (alreadySent) {
            skipped++;
            return;
          }

          // Check if already in queue
          const alreadyQueued = await EmailQueue.findOne({
            where: {
              campaign_id: campaign.id,
              user_id: user.id,
              status: { [Op.in]: ['pending', 'processing'] },
            },
          });

          if (alreadyQueued) {
            skipped++;
            return;
          }

          // Build variables for this user
          const variables = await buildUserVariables(user, campaign);

          // Replace variables in subject and body
          const subject = replaceVariables(template.subject, variables);
          const body = replaceVariables(fullBody, variables);

          // Add to queue
          await EmailQueue.create({
            campaign_id: campaign.id,
            user_id: user.id,
            email: user.email,
            subject,
            body,
            status: 'pending',
            priority: 5,
            scheduled_at: new Date(),
            email_config_id: emailConfigId,
          });

          queued++;
        } catch (error) {
          errors.push({ user_id: user.id, error: error.message });
          logger.logError(error);
        }
      }));
    }

    // Update campaign statistics
    await campaign.update({
      total_recipients: campaign.total_recipients + queued,
      last_run_at: new Date(),
      next_run_at: emailCampaignService.calculateNextRunDate(campaign.toJSON()),
    });

    logger.logActivity('campaign_queue_complete', 'EmailCampaign', campaign.id, null, {
      queued,
      skipped,
      errors: errors.length,
    });

    return { queued, skipped, errors: errors.length };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Main scheduler function - check and queue campaigns
 */
const runScheduler = async () => {
  logger.logActivity('scheduler_start', 'System', null, null, {
    timestamp: new Date().toISOString(),
  });

  try {
    // Get all active campaigns
    const campaigns = await EmailCampaign.findAll({
      where: {
        is_active: 1,
      },
    });

    logger.logActivity('scheduler_campaigns_found', 'System', null, null, {
      count: campaigns.length,
    });

    const results = [];

    for (const campaign of campaigns) {
      let shouldRun = false;

      switch (campaign.campaign_type) {
        case 'holiday':
          shouldRun = isTodayHoliday(campaign);
          break;

        case 'scheduled':
          shouldRun = isTodayScheduled(campaign);
          break;

        case 'recurring':
          // TODO: Implement recurring check
          break;
      }

      if (shouldRun) {
        logger.logActivity('scheduler_campaign_triggered', 'EmailCampaign', campaign.id, null, {
          campaign_name: campaign.name,
          campaign_type: campaign.campaign_type,
        });

        const result = await queueCampaignEmails(campaign);
        results.push({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          ...result,
        });

        // Mark scheduled campaigns as completed after running
        if (campaign.campaign_type === 'scheduled') {
          await campaign.update({ is_active: 0 });
        }
      }
    }

    logger.logActivity('scheduler_complete', 'System', null, null, {
      campaigns_processed: results.length,
      results,
    });

    return results;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Start the scheduler cron job
 * Runs every hour to check for campaigns that need to be queued
 */
const startScheduler = () => {
  // Run every hour at minute 0
  const schedulerJob = cron.schedule('0 * * * *', async () => {
    console.log('[Email Scheduler] Running hourly campaign check...');
    try {
      const results = await runScheduler();
      console.log('[Email Scheduler] Completed:', results);
    } catch (error) {
      console.error('[Email Scheduler] Error:', error.message);
    }
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  });

  console.log('[Email Scheduler] Started - runs every hour');
  return schedulerJob;
};

/**
 * Manually trigger campaign queue (for testing or manual runs)
 */
const triggerCampaign = async (campaignId) => {
  const campaign = await EmailCampaign.findByPk(campaignId);
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  return queueCampaignEmails(campaign);
};

module.exports = {
  startScheduler,
  runScheduler,
  triggerCampaign,
  queueCampaignEmails,
  buildUserVariables,
  replaceVariables,
};
