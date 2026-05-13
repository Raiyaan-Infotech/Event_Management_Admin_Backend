const jwt = require('jsonwebtoken');
const ApiResponse = require('../utils/apiResponse');
const chatService = require('../services/chat.service');

const getSocketToken = async (req, res, next) => {
  try {
    const token = jwt.sign(
      { actor: req.chatActor },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '10m' }
    );
    return ApiResponse.success(res, { token }, 'Socket token issued');
  } catch (error) {
    return next(error);
  }
};

const getContacts = async (req, res, next) => {
  try {
    const data = await chatService.getContacts(req.chatActor);
    return ApiResponse.success(res, data, 'Chat contacts fetched successfully');
  } catch (error) {
    return next(error);
  }
};

const getConversations = async (req, res, next) => {
  try {
    const rows = await chatService.getConversations(req.chatActor);
    return ApiResponse.success(res, { rows, count: rows.length }, 'Conversations fetched successfully');
  } catch (error) {
    return next(error);
  }
};

const getOrCreateDirectConversation = async (req, res, next) => {
  try {
    const conversation = await chatService.getOrCreateDirectConversation(req.chatActor, req.body);
    return ApiResponse.success(res, conversation, 'Conversation ready');
  } catch (error) {
    return next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const rows = await chatService.getMessages(req.chatActor, Number(req.params.id), req.query);
    return ApiResponse.success(res, { rows, count: rows.length }, 'Messages fetched successfully');
  } catch (error) {
    return next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const message = await chatService.sendMessage(req.chatActor, req.body);
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${message.conversation_id}`).emit('chat:message', message);
    }
    return ApiResponse.created(res, message, 'Message sent successfully');
  } catch (error) {
    return next(error);
  }
};

const markRead = async (req, res, next) => {
  try {
    const state = await chatService.markRead(req.chatActor, Number(req.params.id), req.body?.message_id);
    return ApiResponse.success(res, state, 'Conversation marked as read');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getSocketToken,
  getContacts,
  getConversations,
  getOrCreateDirectConversation,
  getMessages,
  sendMessage,
  markRead,
};
