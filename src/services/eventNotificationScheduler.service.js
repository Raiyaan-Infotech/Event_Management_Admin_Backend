const cron = require('node-cron');
const logger = require('../utils/logger');
const eventNotifications = require('./clientEventNotification.service');

/**
 * Sends the mobile app's scheduled notifications (`event_notifications`) when
 * their time comes. Every minute, like `campaignScheduler` — which stays the
 * portal's and does not know this table.
 *
 * Started from `server.js` and nowhere else: two schedulers would be two
 * chances to send (the claim in `sendDue` guards that, but do not lean on it).
 */
let task = null;

const runOnce = () => eventNotifications.sendDue();

const start = () => {
    if (task) return task;
    task = cron.schedule('* * * * *', async () => {
        try {
            await runOnce();
        } catch (err) {
            logger.logError(err);
        }
    });
    console.log('Event notification scheduler started (every minute)');
    return task;
};

const stop = () => {
    if (task) {
        task.stop();
        task = null;
    }
};

module.exports = { start, stop, runOnce };
