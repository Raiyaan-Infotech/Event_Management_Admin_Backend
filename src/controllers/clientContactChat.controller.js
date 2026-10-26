const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const service = require('../services/clientContactChat.service');

/**
 * Contact Person chat (2026-10-26) — see clientContactChat.service.
 *
 * Team routes run as the event OWNER; for the contact person (organizer login)
 * eventOrganizerAccess has already swapped req.websiteClient to the owner and
 * kept the real caller on req.organizerClient — that is the message's sender.
 */
const ownerId = (req) => req.websiteClient.id;
const senderId = (req) => (req.organizerClient || req.websiteClient).id;
/** The caller is the event's contact person (organizer login), not its owner. */
const asContactPerson = (req) => Boolean(req.organizerClient);

const list = asyncHandler(async (req, res) => {
    const data = await service.listChats(ownerId(req), req.params.id, asContactPerson(req));
    return ApiResponse.success(res, data, 'Participant chats retrieved');
});

const messages = asyncHandler(async (req, res) => {
    const data = await service.getTeamMessages(
        ownerId(req), req.params.id, req.params.chatId, senderId(req), asContactPerson(req),
    );
    return ApiResponse.success(res, data, 'Chat retrieved');
});

const reply = asyncHandler(async (req, res) => {
    const message = await service.sendTeamMessage(
        ownerId(req), req.params.id, req.params.chatId, senderId(req), req.body?.body, asContactPerson(req),
    );
    return ApiResponse.created(res, { message }, 'Message sent');
});

const status = asyncHandler(async (req, res) => {
    const chat = await service.setStatus(
        ownerId(req), req.params.id, req.params.chatId, String(req.body?.status || ''), asContactPerson(req),
    );
    return ApiResponse.success(res, { chat }, 'Chat updated');
});

const myChat = asyncHandler(async (req, res) => {
    const data = await service.getMyChat(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, data, 'Chat retrieved');
});

const sendMine = asyncHandler(async (req, res) => {
    const data = await service.sendMyMessage(req.websiteClient.id, req.params.id, req.body?.body);
    return ApiResponse.created(res, data, 'Message sent');
});

module.exports = { list, messages, reply, status, myChat, sendMine };
