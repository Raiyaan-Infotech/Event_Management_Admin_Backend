const { MailNotification, Mail } = require('../models');
const { Op } = require('sequelize');

const createForRecipients = async (mailId, recipients) => {
  const toRecipients = recipients.filter(r => r.role === 'to');
  if (!toRecipients.length) return;

  await MailNotification.bulkCreate(
    toRecipients.map(r => ({
      mail_id: mailId,
      recipient_type: r.recipient_type,
      recipient_id: r.recipient_id,
    }))
  );
};

const getUnread = async (caller) => {
  const [count, latest] = await Promise.all([
    MailNotification.count({
      where: { recipient_type: caller.type, recipient_id: caller.id, is_read: 0 },
    }),
    MailNotification.findAll({
      where: { recipient_type: caller.type, recipient_id: caller.id },
      include: [{ model: Mail, as: 'mail', attributes: ['id', 'subject', 'sender_type', 'sender_id', 'sent_at'] }],
      order: [['created_at', 'DESC']],
      limit: 10,
    }),
  ]);

  return { unread_count: count, notifications: latest };
};

const markAllRead = async (caller) => {
  await MailNotification.update(
    { is_read: 1 },
    { where: { recipient_type: caller.type, recipient_id: caller.id, is_read: 0 } }
  );
};

module.exports = { createForRecipients, getUnread, markAllRead };
