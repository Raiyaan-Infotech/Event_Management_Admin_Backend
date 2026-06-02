const { Op } = require('sequelize');
const {
  sequelize,
  ChatConversation,
  ChatParticipant,
  ChatMessage,
  ChatReadState,
  User,
  Vendor,
  VendorClient,
} = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

const ACTOR_TYPES = new Set(['admin', 'vendor', 'client']);
const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const normalizeActor = (actor) => {
  if (!actor || !ACTOR_TYPES.has(actor.type) || !actor.id) {
    throw ApiError.unauthorized('Invalid chat actor.');
  }
  return {
    type: actor.type,
    id: Number(actor.id),
    vendorId: actor.vendorId ? Number(actor.vendorId) : null,
    companyId: actor.companyId ? Number(actor.companyId) : null,
  };
};

const actorKey = (actor) => `${actor.type}:${actor.id}`;

const safeStoredAvatar = (value) => {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('data:')) return null;
  return value.length > 500 ? null : value;
};

const uploadChatAttachment = async (value, companyId) => {
  if (!value) return null;

  const dataUrl = String(value.data_url || value.dataUrl || '');
  const name = String(value.name || 'attachment').slice(0, 255);
  const type = String(value.type || '').slice(0, 100);
  const declaredSize = Number(value.size) || 0;
  const base64 = dataUrl.split(',')[1] || '';
  const estimatedSize = Math.ceil(base64.length * 0.75);

  if (!/^data:[^;]+;base64,/.test(dataUrl)) {
    throw ApiError.badRequest('Attachment must be a valid uploaded file.');
  }
  if (Math.max(declaredSize, estimatedSize) > CHAT_ATTACHMENT_MAX_BYTES) {
    throw ApiError.badRequest('Attachment must be 10 MB or smaller.');
  }

  const url = await mediaService.uploadDataUri(dataUrl, {
    folder: 'chat/attachments',
    originalName: name.replace(/\.[^.]+$/, '') || 'attachment',
  }, companyId || 1);

  return {
    url,
    name,
    type,
    size: declaredSize || estimatedSize,
  };
};

const resolveAvatar = async ({ value, actor, companyId, persist }) => {
  const safe = safeStoredAvatar(value);
  if (safe) return safe;
  if (!companyId) return null;

  const url = await mediaService.uploadDataUri(value, {
    folder: 'chat/avatars',
    originalName: `${actor.type}-${actor.id}-avatar`,
  }, companyId);
  if (persist && url) {
    await persist(url);
  }

  return url || null;
};

const getActorProfile = async (actor) => {
  if (actor.type === 'admin') {
    const user = await User.findByPk(actor.id, { attributes: ['id', 'full_name', 'email', 'avatar', 'company_id'] });
    if (!user) throw ApiError.notFound('Admin user not found.');
    return {
      actor_type: 'admin',
      actor_id: user.id,
      name: user.full_name || user.email || `Admin #${user.id}`,
      email: user.email,
      avatar: await resolveAvatar({
        value: user.avatar,
        actor,
        companyId: user.company_id,
        persist: (url) => user.update({ avatar: url }),
      }),
      vendor_id: null,
      company_id: user.company_id || null,
    };
  }

  if (actor.type === 'vendor') {
    const vendor = await Vendor.findByPk(actor.id, { attributes: ['id', 'company_name', 'email', 'company_logo', 'company_id'] });
    if (!vendor) throw ApiError.notFound('Vendor not found.');
    return {
      actor_type: 'vendor',
      actor_id: vendor.id,
      name: vendor.company_name || vendor.email || `Vendor #${vendor.id}`,
      email: vendor.email,
      avatar: await resolveAvatar({
        value: vendor.company_logo,
        actor,
        companyId: vendor.company_id,
        persist: (url) => vendor.update({ company_logo: url }),
      }),
      vendor_id: vendor.id,
      company_id: vendor.company_id || null,
    };
  }

  const client = await VendorClient.findByPk(actor.id, { attributes: ['id', 'name', 'email', 'profile_pic', 'vendor_id', 'company_id'] });
  if (!client) throw ApiError.notFound('Client not found.');
  const vendor = client.company_id
    ? null
    : await Vendor.findByPk(client.vendor_id, { attributes: ['id', 'company_id'] });
  const companyId = client.company_id || vendor?.company_id || null;

  return {
    actor_type: 'client',
    actor_id: client.id,
    name: client.name || client.email || `Client #${client.id}`,
    email: client.email,
    avatar: await resolveAvatar({
      value: client.profile_pic,
      actor,
      companyId,
      persist: (url) => client.update({ profile_pic: url }),
    }),
    vendor_id: client.vendor_id,
    company_id: companyId,
  };
};

const assertTargetAllowed = async (caller, target) => {
  if (!ACTOR_TYPES.has(target.type) || !target.id) {
    throw ApiError.badRequest('Invalid chat recipient.');
  }

  const normalizedTarget = { type: target.type, id: Number(target.id) };
  const callerProfile = await getActorProfile(caller);
  const targetProfile = await getActorProfile(normalizedTarget);

  if (caller.type === 'client') {
    if (targetProfile.actor_type !== 'vendor' || targetProfile.actor_id !== caller.vendorId) {
      throw ApiError.forbidden('Clients can only chat with their vendor.');
    }
  }

  if (caller.type === 'vendor') {
    const targetIsAdmin = targetProfile.actor_type === 'admin';
    const targetIsOwnClient = targetProfile.actor_type === 'client' && targetProfile.vendor_id === caller.id;
    if (!targetIsAdmin && !targetIsOwnClient) {
      throw ApiError.forbidden('Vendors can only chat with admins and their own clients.');
    }
  }

  if (caller.type === 'admin') {
    if (!['vendor', 'client'].includes(targetProfile.actor_type)) {
      throw ApiError.forbidden('Admins can chat with vendors and clients.');
    }
  }

  const vendorId = targetProfile.vendor_id || callerProfile.vendor_id || caller.vendorId || null;
  const companyId = targetProfile.company_id || callerProfile.company_id || caller.companyId || null;

  return { callerProfile, targetProfile, vendorId, companyId };
};

const upsertParticipant = async (conversationId, profile, transaction) => {
  const [participant] = await ChatParticipant.findOrCreate({
    where: {
      conversation_id: conversationId,
      actor_type: profile.actor_type,
      actor_id: profile.actor_id,
    },
    defaults: {
      display_name: profile.name,
      avatar: profile.avatar,
      is_active: 1,
    },
    transaction,
  });

  await participant.update({
    display_name: profile.name,
    avatar: profile.avatar,
    is_active: 1,
  }, { transaction });

  return participant;
};

const findDirectConversation = async (caller, target) => {
  const callerRows = await ChatParticipant.findAll({
    where: { actor_type: caller.type, actor_id: caller.id, is_active: 1 },
    attributes: ['conversation_id'],
  });
  if (callerRows.length === 0) return null;

  const targetRows = await ChatParticipant.findAll({
    where: {
      actor_type: target.type,
      actor_id: target.id,
      is_active: 1,
      conversation_id: { [Op.in]: callerRows.map((r) => r.conversation_id) },
    },
    attributes: ['conversation_id'],
  });
  if (targetRows.length === 0) return null;

  return ChatConversation.findOne({
    where: {
      id: { [Op.in]: targetRows.map((r) => r.conversation_id) },
      conversation_type: 'direct',
      is_active: 1,
    },
  });
};

const getOrCreateDirectConversation = async (callerInput, targetInput) => {
  const caller = normalizeActor(callerInput);
  const target = { type: String(targetInput.type || '').toLowerCase(), id: Number(targetInput.id) };
  const access = await assertTargetAllowed(caller, target);

  const existing = await findDirectConversation(caller, target);
  if (existing) {
    return getConversationById(caller, existing.id);
  }

  return sequelize.transaction(async (transaction) => {
    const conversation = await ChatConversation.create({
      company_id: access.companyId,
      vendor_id: access.vendorId,
      conversation_type: 'direct',
      context_type: 'general',
      is_active: 1,
    }, { transaction });

    await upsertParticipant(conversation.id, access.callerProfile, transaction);
    await upsertParticipant(conversation.id, access.targetProfile, transaction);

    await ChatReadState.bulkCreate([
      { conversation_id: conversation.id, actor_type: access.callerProfile.actor_type, actor_id: access.callerProfile.actor_id },
      { conversation_id: conversation.id, actor_type: access.targetProfile.actor_type, actor_id: access.targetProfile.actor_id },
    ], { transaction });

    return getConversationById(caller, conversation.id, transaction);
  });
};

const assertParticipant = async (caller, conversationId, transaction) => {
  const participant = await ChatParticipant.findOne({
    where: {
      conversation_id: conversationId,
      actor_type: caller.type,
      actor_id: caller.id,
      is_active: 1,
    },
    transaction,
  });
  if (!participant) throw ApiError.forbidden('You do not have access to this conversation.');
  return participant;
};

const decorateConversation = async (caller, conversation) => {
  const plain = conversation.toJSON ? conversation.toJSON() : conversation;
  const participants = plain.participants || [];
  const other = participants.find((p) => actorKey({ type: p.actor_type, id: p.actor_id }) !== actorKey(caller)) || participants[0] || null;
  const readState = await ChatReadState.findOne({
    where: { conversation_id: plain.id, actor_type: caller.type, actor_id: caller.id },
  });
  const unread_count = await ChatMessage.count({
    where: {
      conversation_id: plain.id,
      sender_type: { [Op.ne]: caller.type },
      sender_id: { [Op.ne]: caller.id },
      ...(readState?.last_read_message_id ? { id: { [Op.gt]: readState.last_read_message_id } } : {}),
      deleted_at: null,
    },
  });

  return {
    ...plain,
    title: plain.title || other?.display_name || 'Conversation',
    other_participant: other,
    unread_count,
  };
};

const conversationInclude = [
  {
    model: ChatParticipant,
    as: 'participants',
    where: { is_active: 1 },
    required: false,
  },
  {
    model: ChatMessage,
    as: 'lastMessage',
    required: false,
  },
];

const getConversationById = async (callerInput, conversationId, transaction) => {
  const caller = normalizeActor(callerInput);
  await assertParticipant(caller, conversationId, transaction);

  const conversation = await ChatConversation.findByPk(conversationId, {
    include: conversationInclude,
    transaction,
  });
  if (!conversation) throw ApiError.notFound('Conversation not found.');
  return decorateConversation(caller, conversation);
};

const getConversations = async (callerInput) => {
  const caller = normalizeActor(callerInput);
  const rows = await ChatParticipant.findAll({
    where: { actor_type: caller.type, actor_id: caller.id, is_active: 1 },
    attributes: ['conversation_id'],
  });

  if (rows.length === 0) return [];

  const conversations = await ChatConversation.findAll({
    where: { id: { [Op.in]: rows.map((r) => r.conversation_id) }, is_active: 1 },
    include: conversationInclude,
    order: [['last_message_at', 'DESC'], ['updated_at', 'DESC']],
  });

  return Promise.all(conversations.map((conversation) => decorateConversation(caller, conversation)));
};

const getMessages = async (callerInput, conversationId, options = {}) => {
  const caller = normalizeActor(callerInput);
  await assertParticipant(caller, conversationId);

  const limit = Math.min(Number(options.limit) || 50, 100);
  const beforeId = options.before_id ? Number(options.before_id) : null;
  const where = {
    conversation_id: conversationId,
    deleted_at: null,
    ...(beforeId ? { id: { [Op.lt]: beforeId } } : {}),
  };

  const rows = await ChatMessage.findAll({
    where,
    order: [['id', 'DESC']],
    limit,
  });

  return rows.reverse();
};

const sendMessage = async (callerInput, payload) => {
  const caller = normalizeActor(callerInput);
  const conversationId = Number(payload.conversation_id);
  const text = String(payload.message || '').trim();

  if (!conversationId) throw ApiError.badRequest('conversation_id is required.');
  if (!text && !payload.attachment) throw ApiError.badRequest('Message is required.');
  if (text.length > 5000) throw ApiError.badRequest('Message is too long.');

  await assertParticipant(caller, conversationId);
  const conversation = await ChatConversation.findByPk(conversationId, { attributes: ['company_id'] });
  if (!conversation) throw ApiError.notFound('Conversation not found.');
  const attachment = await uploadChatAttachment(payload.attachment, caller.companyId || conversation.company_id);
  const messageText = text || attachment?.name || 'Attachment';

  return sequelize.transaction(async (transaction) => {
    await assertParticipant(caller, conversationId, transaction);

    const message = await ChatMessage.create({
      conversation_id: conversationId,
      sender_type: caller.type,
      sender_id: caller.id,
      message: messageText,
      message_type: 'text',
      metadata: attachment ? { attachment } : null,
    }, { transaction });

    await ChatConversation.update({
      last_message_id: message.id,
      last_message_at: new Date(),
    }, {
      where: { id: conversationId },
      transaction,
    });

    await markRead(caller, conversationId, message.id, transaction);
    return message;
  });
};

const markRead = async (callerInput, conversationId, messageId = null, transaction = null) => {
  const caller = normalizeActor(callerInput);
  await assertParticipant(caller, conversationId, transaction);

  const latest = messageId
    ? { id: Number(messageId) }
    : await ChatMessage.findOne({
        where: { conversation_id: conversationId, deleted_at: null },
        order: [['id', 'DESC']],
        attributes: ['id'],
        transaction,
      });

  const lastReadId = latest?.id || null;
  const [row] = await ChatReadState.findOrCreate({
    where: { conversation_id: conversationId, actor_type: caller.type, actor_id: caller.id },
    defaults: { last_read_message_id: lastReadId, last_read_at: new Date() },
    transaction,
  });

  await row.update({ last_read_message_id: lastReadId, last_read_at: new Date() }, { transaction });
  await ChatParticipant.update({
    last_read_message_id: lastReadId,
    last_read_at: new Date(),
  }, {
    where: { conversation_id: conversationId, actor_type: caller.type, actor_id: caller.id },
    transaction,
  });

  return row;
};

const getContacts = async (callerInput) => {
  const caller = normalizeActor(callerInput);
  const result = { admins: [], vendors: [], clients: [] };

  if (caller.type === 'admin') {
    const [vendors, clients] = await Promise.all([
      Vendor.findAll({ where: { status: 'active' }, attributes: ['id', 'company_name', 'email', 'company_logo'] }),
      VendorClient.findAll({ where: { is_active: 1 }, attributes: ['id', 'name', 'email', 'profile_pic', 'vendor_id'] }),
    ]);
    result.vendors = vendors.map((v) => ({ id: v.id, type: 'vendor', name: v.company_name, email: v.email, avatar: safeStoredAvatar(v.company_logo) }));
    result.clients = clients.map((c) => ({ id: c.id, type: 'client', name: c.name, email: c.email, avatar: safeStoredAvatar(c.profile_pic), vendor_id: c.vendor_id }));
  }

  if (caller.type === 'vendor') {
    const [admins, clients] = await Promise.all([
      User.findAll({ where: { is_active: 1 }, attributes: ['id', 'full_name', 'email', 'avatar'] }),
      VendorClient.findAll({ where: { vendor_id: caller.id, is_active: 1 }, attributes: ['id', 'name', 'email', 'profile_pic', 'vendor_id'] }),
    ]);
    result.admins = admins.map((a) => ({ id: a.id, type: 'admin', name: a.full_name, email: a.email, avatar: safeStoredAvatar(a.avatar) }));
    result.clients = clients.map((c) => ({ id: c.id, type: 'client', name: c.name, email: c.email, avatar: safeStoredAvatar(c.profile_pic), vendor_id: c.vendor_id }));
  }

  if (caller.type === 'client') {
    const vendor = await Vendor.findByPk(caller.vendorId, { attributes: ['id', 'company_name', 'email', 'company_logo'] });
    if (vendor) {
      result.vendors = [{ id: vendor.id, type: 'vendor', name: vendor.company_name, email: vendor.email, avatar: safeStoredAvatar(vendor.company_logo) }];
    }
  }

  return result;
};

module.exports = {
  getContacts,
  getConversations,
  getConversationById,
  getOrCreateDirectConversation,
  getMessages,
  sendMessage,
  markRead,
};
