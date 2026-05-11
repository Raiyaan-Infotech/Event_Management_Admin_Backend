const { Mail, MailRecipient, MailFolder, User, Vendor, VendorClient } = require('../models');
const { Op } = require('sequelize');
const notificationService = require('./mailNotification.service');

const VALID_LABELS = ['social', 'promotions', 'updates'];

const callerRecipientWhere = (caller) => ({
  recipient_type: caller.type,
  recipient_id: caller.id,
});

const callerSenderWhere = (caller) => ({
  sender_type: caller.type,
  sender_id: caller.id,
});

const isSender = (caller, mail) =>
  mail.sender_type === caller.type && String(mail.sender_id) === String(caller.id);

const normalizeRecipients = (recipients = []) =>
  recipients
    .filter((r) => r && r.id && r.type)
    .map((r) => ({
      recipient_type: r.type,
      recipient_id: r.id,
      role: r.role || 'to',
    }));

const syncRecipients = async (mailId, recipients = []) => {
  await MailRecipient.destroy({ where: { mail_id: mailId } });
  const rows = normalizeRecipients(recipients).map((r) => ({ ...r, mail_id: mailId }));
  if (rows.length) await MailRecipient.bulkCreate(rows);
  return rows;
};

const findSenderMail = async (caller, id, extraWhere = {}) => {
  return Mail.findOne({
    where: {
      id,
      ...callerSenderWhere(caller),
      sender_is_active: { [Op.ne]: 2 },
      ...extraWhere,
    },
  });
};

const validateDraftPayload = (data) => {
  if (!data.subject || !String(data.subject).trim()) throw new Error('Subject is required.');
};

const assertRecipientsAllowed = async (caller, recipients = []) => {
  const normalized = normalizeRecipients(recipients);
  if (!normalized.length) return;

  for (const recipient of normalized) {
    if (caller.type === 'admin') {
      if (recipient.recipient_type === 'vendor') {
        const vendor = await Vendor.findOne({ where: { id: recipient.recipient_id, status: 'active' } });
        if (!vendor) throw new Error('Invalid vendor recipient.');
        continue;
      }
      if (recipient.recipient_type === 'client') {
        const client = await VendorClient.findOne({ where: { id: recipient.recipient_id, is_active: 1 } });
        if (!client) throw new Error('Invalid client recipient.');
        continue;
      }
      if (recipient.recipient_type === 'admin') {
        const admin = await User.findOne({ where: { id: recipient.recipient_id, is_active: 1 } });
        if (!admin) throw new Error('Invalid admin recipient.');
        continue;
      }
    }

    if (caller.type === 'vendor') {
      if (recipient.recipient_type === 'admin') {
        const admin = await User.findOne({ where: { id: recipient.recipient_id, is_active: 1 } });
        if (!admin) throw new Error('Invalid admin recipient.');
        continue;
      }
      if (recipient.recipient_type === 'client') {
        const client = await VendorClient.findOne({
          where: { id: recipient.recipient_id, vendor_id: caller.vendorId, is_active: 1 },
        });
        if (!client) throw new Error('Client does not belong to this vendor.');
        continue;
      }
    }

    if (caller.type === 'client') {
      if (recipient.recipient_type === 'vendor' && String(recipient.recipient_id) === String(caller.vendorId)) {
        const vendor = await Vendor.findOne({ where: { id: recipient.recipient_id, status: 'active' } });
        if (!vendor) throw new Error('Invalid vendor recipient.');
        continue;
      }
    }

    throw new Error('Recipient is not allowed for this account.');
  }
};

const validateSendPayload = (data) => {
  validateDraftPayload(data);
  if (!data.body || String(data.body).trim() === '<p><br></p>') throw new Error('Message body is required.');
  if (!data.recipients || !data.recipients.length) throw new Error('At least one recipient is required.');
};

const saveDraft = async (caller, data) => {
  validateDraftPayload(data);
  const draftId = data.id || data.draft_id;
  await assertRecipientsAllowed(caller, data.recipients || []);
  if (draftId) return updateDraft(caller, draftId, data);

  const mail = await Mail.create({
    company_id: caller.companyId || null,
    sender_type: caller.type,
    sender_id: caller.id,
    subject: data.subject,
    body: data.body || '',
    status: 'draft',
    sender_is_active: 1,
  });

  await syncRecipients(mail.id, data.recipients || []);
  return mail;
};

const updateDraft = async (caller, id, data) => {
  validateDraftPayload(data);
  const mail = await findSenderMail(caller, id, { status: 'draft' });
  if (!mail) throw new Error('Draft not found.');
  await assertRecipientsAllowed(caller, data.recipients || []);

  await mail.update({
    subject: data.subject,
    body: data.body || '',
    sender_is_active: 1,
  });
  await syncRecipients(mail.id, data.recipients || []);
  return Mail.findByPk(mail.id, { include: [{ model: MailRecipient, as: 'recipients' }] });
};

const sendMail = async (caller, data) => {
  validateSendPayload(data);
  await assertRecipientsAllowed(caller, data.recipients || []);
  const draftId = data.id || data.draft_id;
  if (draftId) return sendDraft(caller, draftId, data);

  const mail = await Mail.create({
    company_id: caller.companyId || null,
    sender_type: caller.type,
    sender_id: caller.id,
    subject: data.subject,
    body: data.body,
    status: 'sent',
    sent_at: new Date(),
    sender_is_active: 1,
  });

  const recipientRows = await syncRecipients(mail.id, data.recipients);
  await notificationService.createForRecipients(mail.id, recipientRows);
  return mail;
};

const sendDraft = async (caller, id, data = {}) => {
  const mail = await findSenderMail(caller, id, { status: 'draft' });
  if (!mail) throw new Error('Draft not found.');

  const payload = {
    subject: data.subject ?? mail.subject,
    body: data.body ?? mail.body,
    recipients: data.recipients ?? [],
  };
  validateSendPayload(payload);
  await assertRecipientsAllowed(caller, payload.recipients || []);

  await mail.update({
    subject: payload.subject,
    body: payload.body,
    status: 'sent',
    sent_at: new Date(),
    error_message: null,
    sender_is_active: 1,
  });

  const recipientRows = await syncRecipients(mail.id, payload.recipients);
  await notificationService.createForRecipients(mail.id, recipientRows);
  return Mail.findByPk(mail.id, { include: [{ model: MailRecipient, as: 'recipients' }] });
};

const getInbox = async (caller, query = {}) => {
  const { label, folder_id, limit = 50, page = 1 } = query;
  const offset = (Number(page) - 1) * Number(limit);

  const recipientWhere = { ...callerRecipientWhere(caller), is_active: 1 };
  if (label) recipientWhere.label = label;
  if (folder_id) recipientWhere.custom_folder_id = folder_id;

  const rows = await MailRecipient.findAndCountAll({
    where: recipientWhere,
    include: [{ model: Mail, as: 'mail', where: { status: 'sent' } }],
    order: [[{ model: Mail, as: 'mail' }, 'sent_at', 'DESC']],
    limit: Number(limit),
    offset,
  });

  return { total: rows.count, rows: rows.rows };
};

const getSent = async (caller, query = {}) => {
  const { label, folder_id, limit = 50, page = 1 } = query;
  const offset = (Number(page) - 1) * Number(limit);
  const where = { ...callerSenderWhere(caller), status: 'sent', sender_is_active: 1 };
  if (label) where.sender_label = label;
  if (folder_id) where.sender_custom_folder_id = folder_id;

  return Mail.findAndCountAll({
    where,
    include: [{ model: MailRecipient, as: 'recipients' }],
    order: [['sent_at', 'DESC']],
    limit: Number(limit),
    offset,
  });
};

const getDrafts = async (caller, query = {}) => {
  const { label, folder_id, limit = 50, page = 1 } = query;
  const offset = (Number(page) - 1) * Number(limit);
  const where = { ...callerSenderWhere(caller), status: 'draft', sender_is_active: 1 };
  if (label) where.sender_label = label;
  if (folder_id) where.sender_custom_folder_id = folder_id;

  return Mail.findAndCountAll({
    where,
    include: [{ model: MailRecipient, as: 'recipients' }],
    order: [['updated_at', 'DESC']],
    limit: Number(limit),
    offset,
  });
};

const getById = async (caller, id) => {
  const mail = await Mail.findByPk(id, {
    include: [{ model: MailRecipient, as: 'recipients' }],
  });
  if (!mail) return null;

  const senderOwnsMail = isSender(caller, mail) && mail.sender_is_active !== 2;
  const recipientRow = await MailRecipient.findOne({
    where: { mail_id: id, ...callerRecipientWhere(caller), is_active: { [Op.ne]: 2 } },
  });

  if (!senderOwnsMail && !recipientRow) return null;
  return { mail, recipientRow };
};

const moveToTrash = async (caller, id) => {
  const mail = await findSenderMail(caller, id, { sender_is_active: 1 });
  if (mail) return mail.update({ sender_is_active: 0 });

  return MailRecipient.update(
    { is_active: 0 },
    { where: { mail_id: id, ...callerRecipientWhere(caller), is_active: 1 } }
  );
};

const bulkMoveToTrash = async (caller, ids = []) => {
  await Mail.update(
    { sender_is_active: 0 },
    { where: { id: { [Op.in]: ids }, ...callerSenderWhere(caller), sender_is_active: 1 } }
  );
  return MailRecipient.update(
    { is_active: 0 },
    { where: { mail_id: { [Op.in]: ids }, ...callerRecipientWhere(caller), is_active: 1 } }
  );
};

const senderTrashRow = (mailModel) => {
  const mail = typeof mailModel.toJSON === 'function' ? mailModel.toJSON() : mailModel;
  return {
    id: Number(mail.id),
    mail_id: Number(mail.id),
    recipient_type: mail.sender_type,
    recipient_id: Number(mail.sender_id),
    role: 'to',
    is_read: 1,
    is_active: 0,
    label: mail.sender_label,
    custom_folder_id: mail.sender_custom_folder_id,
    owner: 'sender',
    updatedAt: mail.updatedAt,
    mail,
  };
};

const getTrash = async (caller) => {
  const [recipientRows, senderRows] = await Promise.all([
    MailRecipient.findAll({
      where: { ...callerRecipientWhere(caller), is_active: 0 },
      include: [{ model: Mail, as: 'mail' }],
      order: [['updated_at', 'DESC']],
    }),
    Mail.findAll({
      where: { ...callerSenderWhere(caller), sender_is_active: 0 },
      include: [{ model: MailRecipient, as: 'recipients' }],
      order: [['updated_at', 'DESC']],
    }),
  ]);

  return [...recipientRows, ...senderRows.map(senderTrashRow)]
    .sort((a, b) => new Date(b.updatedAt || b.mail?.updatedAt || 0) - new Date(a.updatedAt || a.mail?.updatedAt || 0));
};

const restoreFromTrash = async (caller, id) => {
  const mail = await findSenderMail(caller, id, { sender_is_active: 0 });
  if (mail) return mail.update({ sender_is_active: 1 });

  return MailRecipient.update(
    { is_active: 1 },
    { where: { mail_id: id, ...callerRecipientWhere(caller), is_active: 0 } }
  );
};

const permanentDelete = async (caller, id) => {
  const mail = await findSenderMail(caller, id, { sender_is_active: 0 });
  if (mail) return mail.update({ sender_is_active: 2 });

  return MailRecipient.update(
    { is_active: 2 },
    { where: { mail_id: id, ...callerRecipientWhere(caller), is_active: 0 } }
  );
};

const toggleRead = async (caller, id) => {
  const row = await MailRecipient.findOne({
    where: { mail_id: id, ...callerRecipientWhere(caller) },
  });
  if (!row) return null;
  return row.update({ is_read: row.is_read ? 0 : 1 });
};

const bulkMarkRead = async (caller, ids, isRead) => {
  return MailRecipient.update(
    { is_read: isRead ? 1 : 0 },
    { where: { mail_id: { [Op.in]: ids }, ...callerRecipientWhere(caller) } }
  );
};

const assignLabel = async (caller, id, label) => {
  if (label && !VALID_LABELS.includes(label)) throw new Error('Invalid label.');
  const mail = await findSenderMail(caller, id);
  if (mail) return mail.update({ sender_label: label || null });

  return MailRecipient.update(
    { label: label || null },
    { where: { mail_id: id, ...callerRecipientWhere(caller) } }
  );
};

const bulkAssignLabel = async (caller, ids, label) => {
  if (label && !VALID_LABELS.includes(label)) throw new Error('Invalid label.');
  await Mail.update(
    { sender_label: label || null },
    { where: { id: { [Op.in]: ids }, ...callerSenderWhere(caller), sender_is_active: { [Op.ne]: 2 } } }
  );
  return MailRecipient.update(
    { label: label || null },
    { where: { mail_id: { [Op.in]: ids }, ...callerRecipientWhere(caller), is_active: { [Op.ne]: 2 } } }
  );
};

const assertFolder = async (caller, folderId) => {
  if (!folderId) return;
  const folder = await MailFolder.findOne({
    where: { id: folderId, owner_type: caller.type, owner_id: caller.id, is_active: 1 },
  });
  if (!folder) throw new Error('Folder not found.');
};

const moveToFolder = async (caller, mailId, folderId) => {
  await assertFolder(caller, folderId);
  const mail = await findSenderMail(caller, mailId);
  if (mail) return mail.update({ sender_custom_folder_id: folderId || null });

  return MailRecipient.update(
    { custom_folder_id: folderId || null },
    { where: { mail_id: mailId, ...callerRecipientWhere(caller) } }
  );
};

const bulkMoveToFolder = async (caller, ids, folderId) => {
  await assertFolder(caller, folderId);
  await Mail.update(
    { sender_custom_folder_id: folderId || null },
    { where: { id: { [Op.in]: ids }, ...callerSenderWhere(caller), sender_is_active: { [Op.ne]: 2 } } }
  );
  return MailRecipient.update(
    { custom_folder_id: folderId || null },
    { where: { mail_id: { [Op.in]: ids }, ...callerRecipientWhere(caller), is_active: { [Op.ne]: 2 } } }
  );
};

const getFolders = async (caller) => {
  return MailFolder.findAll({
    where: { owner_type: caller.type, owner_id: caller.id, is_active: 1 },
    order: [['name', 'ASC']],
  });
};

const createFolder = async (caller, name) => {
  const count = await MailFolder.count({
    where: { owner_type: caller.type, owner_id: caller.id, is_active: 1 },
  });
  if (count >= 10) throw new Error('Maximum 10 folders allowed.');
  return MailFolder.create({ owner_type: caller.type, owner_id: caller.id, name });
};

const updateFolder = async (caller, id, data) => {
  const folder = await MailFolder.findOne({
    where: { id, owner_type: caller.type, owner_id: caller.id },
  });
  if (!folder) throw new Error('Folder not found.');
  return folder.update({ name: data.name ?? folder.name, is_active: data.is_active ?? folder.is_active });
};

const deleteFolder = async (caller, id) => {
  const folder = await MailFolder.findOne({
    where: { id, owner_type: caller.type, owner_id: caller.id },
  });
  if (!folder) throw new Error('Folder not found.');
  await Promise.all([
    MailRecipient.update(
      { custom_folder_id: null },
      { where: { custom_folder_id: id, ...callerRecipientWhere(caller) } }
    ),
    Mail.update(
      { sender_custom_folder_id: null },
      { where: { sender_custom_folder_id: id, ...callerSenderWhere(caller) } }
    ),
  ]);
  return folder.destroy();
};

module.exports = {
  saveDraft,
  updateDraft,
  sendMail,
  sendDraft,
  getInbox,
  getSent,
  getDrafts,
  getById,
  moveToTrash,
  bulkMoveToTrash,
  getTrash,
  restoreFromTrash,
  permanentDelete,
  toggleRead,
  bulkMarkRead,
  assignLabel,
  bulkAssignLabel,
  moveToFolder,
  bulkMoveToFolder,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
};
