const cron = require('node-cron');

const { Sequelize, Event, EventGuest, EventMessage, EventMessageCampaign, WebsiteClient } = require('../models');

const { Op } = Sequelize;
const logger = require('../utils/logger');

/**
 * Fires campaigns whose scheduled time has arrived.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM `emailScheduler.service` ────────────────
 * That one drives the ADMIN's `EmailCampaign` — a different table, a different
 * owner, a different audience model — and, as it happens, nothing ever calls
 * its `start()`. This is the client portal's own scheduler, over
 * `event_message_campaigns`, and it IS started, from `server.js`.
 *
 * ── ⚠ ONLY PUSH ACTUALLY GOES OUT ───────────────────────────────────────────
 * A scheduled WhatsApp or Email campaign is promoted to 'sent' at its time and
 * nothing leaves the building, exactly as an immediate send on those channels
 * behaves — there is no provider behind either. Push has Firebase, so a
 * scheduled push is delivered for real. The distinction is deliberate and is
 * the same one `channelState()` reports to the composer.
 *
 * ── WHY A MINUTE, AND WHY THAT IS ENOUGH ────────────────────────────────────
 * The composer schedules to the minute, so polling faster cannot improve
 * accuracy. A due campaign is claimed by flipping it to 'sending' BEFORE any
 * work happens, which is what stops a long send from being started twice by
 * the next tick — and, on a multi-instance deploy, by another instance.
 */

let task = null;

/** Campaigns due now. A generous window, because a claim is what prevents doubles. */
const findDue = () => EventMessageCampaign.findAll({
    where: {
        status: 'scheduled',
        scheduled_at: { [Op.ne]: null, [Op.lte]: new Date() },
    },
    include: [{ model: Event, as: 'event', required: false }],
    order: [['scheduled_at', 'ASC']],
    limit: 25,
});

/**
 * Send one due campaign.
 *
 * ── THE CLAIM IS AN UPDATE WITH A GUARD, NOT A READ THEN A WRITE ────────────
 * `WHERE id = ? AND status = 'scheduled'` means the row is claimed by whoever
 * flips it first; a second worker's UPDATE matches zero rows and it walks away.
 * Reading the status and then writing it would leave a window between the two
 * where both workers believe they own the campaign, and the guests receive the
 * notification twice.
 */
const fire = async (campaign) => {
    const [claimed] = await EventMessageCampaign.update(
        { status: 'sending' },
        { where: { id: campaign.id, status: 'scheduled' } },
    );
    if (!claimed) return { skipped: true };

    try {
        if (campaign.channel !== 'push') {
            /*
              No provider. The recipient rows stay 'queued' — they were never
              delivered and marking them 'sent' would make every delivery rate
              on the analytics screen a number nobody can unpick later.
            */
            await campaign.update({ status: 'sent', sent_at: new Date() });
            return { delivered: 0, failed: 0, recorded: true };
        }

        const client = await WebsiteClient.findByPk(campaign.website_client_id);
        if (!client) throw new Error('The account that scheduled this no longer exists.');

        /*
          The audience is re-read from the SNAPSHOT taken at schedule time, not
          re-resolved. A guest added to the event between scheduling and sending
          was not part of what the host approved, and a guest removed must not
          still be messaged.
        */
        const recipientIds = (await EventMessage.findAll({
            where: { campaign_id: campaign.id },
            attributes: ['guest_id'],
        })).map((r) => r.guest_id).filter(Boolean);

        const eligible = await EventGuest.findAll({
            where: { id: { [Op.in]: recipientIds } },
            attributes: ['id', 'name', 'participant_client_id'],
        });

        // Required lazily: clientMessage requires this file's siblings, and a
        // top-level require here closes the cycle and yields an empty object.
        // eslint-disable-next-line global-require
        const messages = require('./clientMessage.service');
        const outcome = await messages.deliverScheduledPush(campaign, eligible, client);

        logger.logActivity(
            'campaign_scheduled_sent', 'EventMessageCampaign', campaign.id, null, outcome,
        );
        return outcome;
    } catch (err) {
        logger.logError(err);
        await campaign.update({
            status: 'failed',
            failed_reason: String(err.message).slice(0, 255),
        });
        return { delivered: 0, failed: 0, error: err.message };
    }
};

/** One pass. Exported so a test can run it without waiting for the clock. */
const runOnce = async () => {
    const due = await findDue();
    if (!due.length) return { fired: 0 };

    let fired = 0;
    for (const campaign of due) {
        // eslint-disable-next-line no-await-in-loop
        const result = await fire(campaign);
        if (!result.skipped) fired += 1;
    }
    return { fired };
};

/**
 * Start the minute tick.
 *
 * Guarded against a second call: `server.js` is the only caller today, but a
 * test harness that boots the app twice in one process would otherwise get two
 * schedulers racing each other for the same campaigns.
 */
const start = () => {
    if (task) return task;
    task = cron.schedule('* * * * *', async () => {
        try {
            await runOnce();
        } catch (err) {
            logger.logError(err);
        }
    });
    console.log('Campaign scheduler started (every minute)');
    return task;
};

const stop = () => {
    if (task) {
        task.stop();
        task = null;
    }
};

module.exports = { start, stop, runOnce, fire };
