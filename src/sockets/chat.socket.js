const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { authenticateChatRequest } = require('../middleware/chatAuth');
const chatService = require('../services/chat.service');

const parseCookieHeader = (socket) => {
  const raw = socket.handshake.headers.cookie || '';
  return cookie.parse(raw);
};

const onlineActors = new Map();

const actorKey = (actor) => `${actor.type}:${actor.id}`;

const onlineSnapshot = () => Array.from(onlineActors.entries()).map(([key, count]) => {
  const [type, id] = key.split(':');
  return { actor_type: type, actor_id: Number(id), online: count > 0 };
});

const markOnline = (io, actor) => {
  const key = actorKey(actor);
  const nextCount = (onlineActors.get(key) || 0) + 1;
  onlineActors.set(key, nextCount);
  if (nextCount === 1) {
    io.emit('chat:presence', { actor_type: actor.type, actor_id: actor.id, online: true });
  }
};

const markOffline = (io, actor) => {
  const key = actorKey(actor);
  const nextCount = Math.max((onlineActors.get(key) || 1) - 1, 0);
  if (nextCount > 0) {
    onlineActors.set(key, nextCount);
    return;
  }
  onlineActors.delete(key);
  io.emit('chat:presence', { actor_type: actor.type, actor_id: actor.id, online: false });
};

const attachChatSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      // Token-based auth (for proxy-fronted portals where cookies are on Vercel domain)
      const authToken = socket.handshake.auth?.token;
      if (authToken) {
        try {
          const decoded = jwt.verify(authToken, process.env.ACCESS_TOKEN_SECRET);
          if (decoded?.actor) {
            socket.chatActor = decoded.actor;
            socket.join(`actor:${decoded.actor.type}:${decoded.actor.id}`);
            return next();
          }
        } catch (_) {
          // fall through to cookie auth
        }
      }

      // Cookie-based auth fallback
      const cookies = parseCookieHeader(socket);
      const portalType = String(socket.handshake.auth?.portalType || socket.handshake.headers['x-portal-type'] || '').toLowerCase();

      const req = {
        cookies,
        headers: { 'x-portal-type': portalType },
      };
      const res = {
        cookie: () => {},
      };

      const actor = await authenticateChatRequest(req, res);
      if (!actor) return next(new Error('Authentication required.'));

      socket.chatActor = actor;
      socket.join(`actor:${actor.type}:${actor.id}`);
      return next();
    } catch (error) {
      return next(new Error('Authentication required.'));
    }
  });

  io.on('connection', (socket) => {
    markOnline(io, socket.chatActor);
    socket.emit('chat:presence:list', onlineSnapshot());

    socket.on('chat:join', async ({ conversationId }, ack) => {
      try {
        const conversation = await chatService.getConversationById(socket.chatActor, Number(conversationId));
        socket.join(`chat:${conversation.id}`);
        if (typeof ack === 'function') ack({ success: true, conversation });
      } catch (error) {
        if (typeof ack === 'function') ack({ success: false, message: error.message || 'Unable to join conversation.' });
      }
    });

    socket.on('chat:send', async (payload, ack) => {
      try {
        const message = await chatService.sendMessage(socket.chatActor, payload);
        io.to(`chat:${message.conversation_id}`).emit('chat:message', message);
        if (typeof ack === 'function') ack({ success: true, message });
      } catch (error) {
        if (typeof ack === 'function') ack({ success: false, message: error.message || 'Unable to send message.' });
      }
    });

    socket.on('chat:typing', async ({ conversationId, isTyping = true }) => {
      try {
        const conversation = await chatService.getConversationById(socket.chatActor, Number(conversationId));
        socket.to(`chat:${conversation.id}`).emit('chat:typing', {
          conversation_id: conversation.id,
          actor_type: socket.chatActor.type,
          actor_id: socket.chatActor.id,
          is_typing: Boolean(isTyping),
        });
      } catch (error) {
        // Ignore unauthorized typing probes.
      }
    });

    socket.on('chat:read', async ({ conversationId, messageId }, ack) => {
      try {
        const state = await chatService.markRead(socket.chatActor, Number(conversationId), messageId);
        socket.to(`chat:${conversationId}`).emit('chat:read', {
          conversation_id: Number(conversationId),
          actor_type: socket.chatActor.type,
          actor_id: socket.chatActor.id,
          last_read_message_id: state.last_read_message_id,
        });
        if (typeof ack === 'function') ack({ success: true, state });
      } catch (error) {
        if (typeof ack === 'function') ack({ success: false, message: error.message || 'Unable to mark read.' });
      }
    });

    socket.on('disconnect', () => {
      markOffline(io, socket.chatActor);
    });
  });
};

module.exports = { attachChatSocket };
