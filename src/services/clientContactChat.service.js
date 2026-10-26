const { Sequelize, Event, EventParticipant, WebsiteClient, EventContactChat, EventContactChatMessage } = require('../models');
const ApiError = require('../utils/apiError');

const { Op } = Sequelize;

/**
 * Contact Person chat (Jamal's "Organizer - Participant Contact Person"
 * design, 2026-10-26).
 *
 * Levels: the OWNER bought the plan; the CONTACT PERSON (organizer login)
 * runs the event; PARTICIPANTS are its guests. A participant has ONE chat per
 * event with the event TEAM — the owner and the contact person both read and
 * reply (each reply carries its sender's name). The contact person's calls
 * arrive as the owner (eventOrganizerAccess swaps req.websiteClient), with the
 * real sender passed in as [senderId].
 *
 * Status: open → resolved (a label; a new participant message reopens it) →
 * blocked (the participant can no longer send in THIS event's chat).
 */

const MAX_BODY = 2000;
const MAX_MESSAGES = 300;
const STATUSES = ['open', 'resolved', 'blocked'];

const cleanBody = (raw) => {
    const body = String(raw ?? '').trim();
    if (!body) throw ApiError.badRequest('Please type a message.');
    if (body.length > MAX_BODY) throw ApiError.badRequest(`A message can be up to ${MAX_BODY} characters.`);
    return body;
};

const preview = (body) => (body.length > 250 ? `${body.slice(0, 247)}...` : body);

/** The caller's role on the event: team (owner / contact person) or participant. */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const [event, membership] = await Promise.all([
        Event.findByPk(eventId, {
            attributes: ['id', 'name', 'website_client_id', 'organizer', 'organizer_image', 'contact_designation'],
        }),
        EventParticipant.findOne({
            where: { event_id: eventId, participant_client_id: clientId },
            attributes: ['id'],
        }),
    ]);
    if (!event) throw ApiError.notFound('That event was not found.');
    if (Number(event.website_client_id) === Number(clientId)) return { event, team: true };
    if (!membership) throw ApiError.notFound('That event is not on your account.');
    return { event, team: false };
};

/** client id → { name, photo } for the given ids (one query). */
const clientNames = async (ids) => {
    const unique = [...new Set(ids.filter(Boolean).map(Number))];
    if (!unique.length) return new Map();
    const rows = await WebsiteClient.findAll({
        where: { id: { [Op.in]: unique } },
        attributes: ['id', 'name', 'avatar_url'],
        raw: true,
    });
    return new Map(rows.map((r) => [Number(r.id), { name: r.name, photo: r.avatar_url || null }]));
};

const shapeMessages = async (rows, viewerId) => {
    const names = await clientNames(rows.map((m) => m.sender_client_id));
    return rows.map((m) => ({
        id: m.id,
        side: m.sender_side,
        mine: Number(m.sender_client_id) === Number(viewerId),
        sender_name: names.get(Number(m.sender_client_id))?.name || null,
        body: m.body,
        created_at: m.created_at,
    }));
};

const lastMessages = async (chatId) => {
    const rows = await EventContactChatMessage.findAll({
        where: { chat_id: chatId },
        order: [['id', 'DESC']],
        limit: MAX_MESSAGES,
        raw: true,
    });
    return rows.reverse();
};

/* ── Team (owner / contact person) ───────────────────────────────────────── */

const assertTeam = async (clientId, eventId) => {
    const r = await resolveEvent(clientId, eventId);
    if (!r.team) throw ApiError.forbidden('Only the event team can see participant chats.');
    return r;
};

const teamChat = async (clientId, eventId, chatId) => {
    const { event } = await assertTeam(clientId, eventId);
    const chat = await EventContactChat.findOne({ where: { id: Number(chatId) || 0, event_id: event.id } });
    if (!chat) throw ApiError.notFound('That chat was not found.');
    return { event, chat };
};

/** Participant Chats: every chat of the event, newest first, with counts. */
const listChats = async (clientId, eventId) => {
    const { event } = await assertTeam(clientId, eventId);
    const chats = await EventContactChat.findAll({
        where: { event_id: event.id },
        order: [['last_message_at', 'DESC'], ['id', 'DESC']],
        raw: true,
    });
    const ids = chats.map((c) => c.participant_client_id);
    const [names, guests] = await Promise.all([
        clientNames(ids),
        ids.length
            ? EventParticipant.findAll({
                where: { event_id: event.id, participant_client_id: { [Op.in]: ids } },
                attributes: ['participant_client_id', 'name', 'photo'],
                raw: true,
            })
            : [],
    ]);
    const guestOf = new Map(guests.map((g) => [Number(g.participant_client_id), g]));
    const rows = chats.map((c) => {
        const g = guestOf.get(Number(c.participant_client_id));
        const n = names.get(Number(c.participant_client_id));
        return {
            id: c.id,
            participant: {
                client_id: c.participant_client_id,
                name: g?.name || n?.name || 'Participant',
                photo: g?.photo || n?.photo || null,
            },
            status: c.status,
            last_message: c.last_message,
            last_message_at: c.last_message_at,
            unread: c.team_unread,
        };
    });
    const counts = {
        all: rows.filter((r) => r.status !== 'blocked').length,
        unread: rows.filter((r) => r.status !== 'blocked' && r.unread > 0).length,
        resolved: rows.filter((r) => r.status === 'resolved').length,
        blocked: rows.filter((r) => r.status === 'blocked').length,
    };
    return { event: { id: event.id, name: event.name }, chats: rows, counts };
};

/** One chat for the team; reading it clears the team's unread count. */
const getTeamMessages = async (clientId, eventId, chatId, senderId) => {
    const { chat } = await teamChat(clientId, eventId, chatId);
    const [rows] = await Promise.all([
        lastMessages(chat.id),
        chat.team_unread ? chat.update({ team_unread: 0 }) : null,
    ]);
    return { chat: { id: chat.id, status: chat.status }, messages: await shapeMessages(rows, senderId) };
};

const sendTeamMessage = async (clientId, eventId, chatId, senderId, rawBody) => {
    const body = cleanBody(rawBody);
    const { chat } = await teamChat(clientId, eventId, chatId);
    const msg = await EventContactChatMessage.create({
        chat_id: chat.id, sender_side: 'team', sender_client_id: senderId, body,
    });
    await chat.update({
        last_message: preview(body),
        last_message_at: new Date(),
        participant_unread: chat.participant_unread + 1,
        team_unread: 0,
    });
    return (await shapeMessages([msg.get({ plain: true })], senderId))[0];
};

const setStatus = async (clientId, eventId, chatId, status) => {
    if (!STATUSES.includes(status)) throw ApiError.badRequest('Please choose a valid status.');
    const { chat } = await teamChat(clientId, eventId, chatId);
    await chat.update({ status });
    return { id: chat.id, status: chat.status };
};

/* ── Participant ─────────────────────────────────────────────────────────── */

const assertParticipant = async (clientId, eventId) => {
    const r = await resolveEvent(clientId, eventId);
    if (r.team) throw ApiError.badRequest('This is your own event — open Participant Chats instead.');
    return r;
};

/** The participant's own chat with the event team (empty before the first message). */
const getMyChat = async (clientId, eventId) => {
    const { event } = await assertParticipant(clientId, eventId);
    const chat = await EventContactChat.findOne({ where: { event_id: event.id, participant_client_id: clientId } });
    const contact = {
        name: event.organizer || null,
        photo: event.organizer_image || null,
        designation: event.contact_designation || null,
    };
    if (!chat) return { chat: null, contact, messages: [] };
    const [rows] = await Promise.all([
        lastMessages(chat.id),
        chat.participant_unread ? chat.update({ participant_unread: 0 }) : null,
    ]);
    return {
        chat: { id: chat.id, status: chat.status },
        contact,
        messages: await shapeMessages(rows, clientId),
    };
};

const sendMyMessage = async (clientId, eventId, rawBody) => {
    const body = cleanBody(rawBody);
    const { event } = await assertParticipant(clientId, eventId);
    const [chat] = await EventContactChat.findOrCreate({
        where: { event_id: event.id, participant_client_id: clientId },
        defaults: { event_id: event.id, participant_client_id: clientId },
    });
    if (chat.status === 'blocked') {
        throw ApiError.forbidden('You can no longer send messages in this chat.');
    }
    const msg = await EventContactChatMessage.create({
        chat_id: chat.id, sender_side: 'participant', sender_client_id: clientId, body,
    });
    await chat.update({
        last_message: preview(body),
        last_message_at: new Date(),
        team_unread: chat.team_unread + 1,
        participant_unread: 0,
        // A new question reopens a resolved chat.
        status: chat.status === 'resolved' ? 'open' : chat.status,
    });
    return (await shapeMessages([msg.get({ plain: true })], clientId))[0];
};

module.exports = {
    listChats,
    getTeamMessages,
    sendTeamMessage,
    setStatus,
    getMyChat,
    sendMyMessage,
};
