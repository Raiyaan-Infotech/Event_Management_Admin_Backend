/**
 * Email Worker Service
 * Runs every 5 minutes to process emails from the queue
 */

const cron = require('node-cron');
const { EmailQueue, EmailSentLog, EmailCampaign, EmailConfig, sequelize } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const emailSenderService = require('./emailSender.service');

// Configuration
const BATCH_SIZE = 50; // Process 50 emails per run
const MAX_ATTEMPTS = 3;
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

/**
 * Get pending emails from queue
 */
const getPendingEmails = async (limit = BATCH_SIZE) => {
  const now = new Date();
  console.log('[Email Worker] Looking for emails scheduled before:', now.toISOString());

  // Debug: Check raw count
  const rawCount = await EmailQueue.count({
    where: {
      status: 'pending',
    },
  });
  console.log('[Email Worker] Total pending emails in queue:', rawCount);

  // Get pending emails that are scheduled to be sent now or earlier
  // Also get failed emails that haven't exceeded max attempts
  return EmailQueue.findAll({
    where: {
      [Op.or]: [
        {
          status: 'pending',
          scheduled_at: { [Op.lte]: now },
        },
        {
          status: 'failed',
          attempts: { [Op.lt]: MAX_ATTEMPTS },
        },
      ],
    },
    order: [
      ['priority', 'ASC'],
      ['scheduled_at', 'ASC'],
    ],
    limit,
    include: [
      {
        model: EmailConfig,
        as: 'email_config',
        required: false,
      },
    ],
  });
};

/**
 * Mark email as processing (lock it)
 */
const lockEmail = async (queueItem) => {
  const [updatedCount] = await EmailQueue.update(
    {
      status: 'processing',
      processed_at: new Date(),
    },
    {
      where: {
        id: queueItem.id,
        status: { [Op.in]: ['pending', 'failed'] },
      },
    }
  );

  return updatedCount > 0;
};

/**
 * Send a single email
 */
const sendQueuedEmail = async (queueItem) => {
  try {
    // Get email config
    let config = queueItem.email_config;
    if (!config && queueItem.email_config_id) {
      config = await EmailConfig.findByPk(queueItem.email_config_id);
    }
    if (!config) {
      // Get default config
      config = await EmailConfig.findOne({
        where: { is_default: true, is_active: true },
      });
    }

    if (!config) {
      throw new Error('No email configuration found');
    }

    // Create transporter and send
    const transporter = emailSenderService.createTransporter(config);

    const mailOptions = {
      from: `"${config.from_name}" <${config.from_email}>`,
      to: queueItem.email,
      subject: queueItem.subject,
      html: queueItem.body,
    };

    const result = await transporter.sendMail(mailOptions);

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Mark email as sent and log it
 */
const markAsSent = async (queueItem, messageId) => {
  const transaction = await sequelize.transaction();

  try {
    const today = new Date();
    const runDate = today.toISOString().split('T')[0];
    const runYear = today.getFullYear();

    // Update queue item
    await EmailQueue.update(
      {
        status: 'sent',
        sent_at: new Date(),
        attempts: queueItem.attempts + 1,
      },
      {
        where: { id: queueItem.id },
        transaction,
      }
    );

    // Create sent log
    await EmailSentLog.create({
      campaign_id: queueItem.campaign_id,
      user_id: queueItem.user_id,
      email: queueItem.email,
      queue_id: queueItem.id,
      run_date: runDate,
      run_year: runYear,
      subject: queueItem.subject,
      status: 'sent',
      message_id: messageId,
      attempts: queueItem.attempts + 1,
      sent_at: new Date(),
    }, { transaction });

    // Update campaign statistics
    await EmailCampaign.increment('total_sent', {
      where: { id: queueItem.campaign_id },
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Mark email as failed
 */
const markAsFailed = async (queueItem, errorMessage) => {
  const attempts = queueItem.attempts + 1;
  const isFinalAttempt = attempts >= MAX_ATTEMPTS;

  const transaction = await sequelize.transaction();

  try {
    // Update queue item
    await EmailQueue.update(
      {
        status: isFinalAttempt ? 'failed' : 'failed', // Keep as failed, will retry
        attempts,
        last_error: errorMessage,
        processed_at: new Date(),
      },
      {
        where: { id: queueItem.id },
        transaction,
      }
    );

    // If final attempt, log the failure
    if (isFinalAttempt) {
      const today = new Date();
      const runDate = today.toISOString().split('T')[0];
      const runYear = today.getFullYear();

      await EmailSentLog.create({
        campaign_id: queueItem.campaign_id,
        user_id: queueItem.user_id,
        email: queueItem.email,
        queue_id: queueItem.id,
        run_date: runDate,
        run_year: runYear,
        subject: queueItem.subject,
        status: 'failed',
        error_message: errorMessage,
        attempts,
      }, { transaction });

      // Update campaign statistics
      await EmailCampaign.increment('total_failed', {
        where: { id: queueItem.campaign_id },
        transaction,
      });
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Process a single queue item
 */
const processQueueItem = async (queueItem) => {
  try {
    // Try to lock the email
    const locked = await lockEmail(queueItem);
    if (!locked) {
      // Someone else is processing this email
      return { status: 'skipped', reason: 'already_processing' };
    }

    // Send the email
    const result = await sendQueuedEmail(queueItem);

    if (result.success) {
      await markAsSent(queueItem, result.messageId);
      return { status: 'sent', messageId: result.messageId };
    } else {
      await markAsFailed(queueItem, result.error);
      return { status: 'failed', error: result.error, attempt: queueItem.attempts + 1 };
    }
  } catch (error) {
    logger.logError(error);
    await markAsFailed(queueItem, error.message);
    return { status: 'error', error: error.message };
  }
};

/**
 * Main worker function - process queue
 */
const processQueue = async () => {
  logger.logActivity('worker_start', 'System', null, null, {
    timestamp: new Date().toISOString(),
    batch_size: BATCH_SIZE,
  });

  try {
    // Get pending emails
    const pendingEmails = await getPendingEmails(BATCH_SIZE);

    if (pendingEmails.length === 0) {
      logger.logActivity('worker_no_emails', 'System', null, null, {
        message: 'No pending emails in queue',
      });
      return { processed: 0, sent: 0, failed: 0 };
    }

    logger.logActivity('worker_emails_found', 'System', null, null, {
      count: pendingEmails.length,
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    // Process emails sequentially to avoid overwhelming the mail server
    // For better performance, you could process in small parallel batches
    for (const queueItem of pendingEmails) {
      const result = await processQueueItem(queueItem);

      switch (result.status) {
        case 'sent':
          sent++;
          break;
        case 'failed':
        case 'error':
          failed++;
          break;
        case 'skipped':
          skipped++;
          break;
      }

      // Small delay between emails to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.logActivity('worker_complete', 'System', null, null, {
      processed: pendingEmails.length,
      sent,
      failed,
      skipped,
    });

    return {
      processed: pendingEmails.length,
      sent,
      failed,
      skipped,
    };
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Clean up old queue items (optional maintenance)
 */
const cleanupQueue = async (daysOld = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const deleted = await EmailQueue.destroy({
    where: {
      status: 'sent',
      sent_at: { [Op.lt]: cutoffDate },
    },
  });

  logger.logActivity('queue_cleanup', 'System', null, null, {
    deleted,
    days_old: daysOld,
  });

  return deleted;
};

/**
 * Reset stuck processing emails (maintenance)
 */
const resetStuckEmails = async () => {
  const cutoffTime = new Date(Date.now() - LOCK_TIMEOUT);

  const [updated] = await EmailQueue.update(
    { status: 'pending' },
    {
      where: {
        status: 'processing',
        processed_at: { [Op.lt]: cutoffTime },
      },
    }
  );

  if (updated > 0) {
    logger.logActivity('reset_stuck_emails', 'System', null, null, {
      count: updated,
    });
  }

  return updated;
};

/**
 * Get queue statistics
 */
const getQueueStats = async () => {
  const stats = await EmailQueue.findAll({
    attributes: [
      'status',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    group: ['status'],
    raw: true,
  });

  return stats.reduce((acc, item) => {
    acc[item.status] = parseInt(item.count);
    return acc;
  }, {
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
  });
};

/**
 * Start the worker cron job
 * Runs every 5 minutes
 */
const startWorker = () => {
  // Run every 5 minutes
  const workerJob = cron.schedule('*/5 * * * *', async () => {
    console.log('[Email Worker] Processing queue...');
    try {
      // Reset any stuck emails first
      await resetStuckEmails();

      // Process the queue
      const results = await processQueue();
      console.log('[Email Worker] Completed:', results);
    } catch (error) {
      console.error('[Email Worker] Error:', error.message);
    }
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  });

  // Also run cleanup daily at midnight
  const cleanupJob = cron.schedule('0 0 * * *', async () => {
    console.log('[Email Worker] Running daily cleanup...');
    try {
      const deleted = await cleanupQueue(30);
      console.log(`[Email Worker] Cleanup completed: ${deleted} old items removed`);
    } catch (error) {
      console.error('[Email Worker] Cleanup error:', error.message);
    }
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  });

  console.log('[Email Worker] Started - runs every 5 minutes');
  return { workerJob, cleanupJob };
};

module.exports = {
  startWorker,
  processQueue,
  processQueueItem,
  cleanupQueue,
  resetStuckEmails,
  getQueueStats,
  getPendingEmails,
};
