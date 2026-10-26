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
 *
 * WHO ANSWERS (Jamal, 2026-10-26): the CONTACT PERSON is responsible — they
 * reply, resolve and block. The OWNER only READS (monitors), unless the event
 * has no separate contact person (organizer_client_id empty / the owner), in
 * which case the owner is the contact person. [asContactPerson] = the caller
 * came in through eventOrganizerAccess. Reading as the owner does not clear
 * the unread count — it belongs to whoever answers.
 */

const MAX_BODY = 2000;
const AUTO_REPLY = 'Thanks for contacting us. We are currently offline and will reply soon.';
/** One auto reply per quiet spell, not one per message. */
const AUTO_REPLY_GAP_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 300;
const STATUSES = ['open', 'resolved', 'blocked', 'removed'];

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
            attributes: [
                'id', 'name', 'website_client_id', 'contact_phone',
                'organizer', 'organizer_image', 'contact_designation',
            ],
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

/**
 * [event] names a team sender with no account (id 0 = the event's contact
 * person, who is not a client): their name is the event's contact name.
 */
const shapeMessages = async (rows, viewerId, event = null) => {
    const names = await clientNames(rows.map((m) => m.sender_client_id));
    return rows.map((m) => ({
        id: m.id,
        side: m.sender_side,
        mine: Number(m.sender_client_id) === Number(viewerId),
        sender_name: names.get(Number(m.sender_client_id))?.name
            || (m.sender_side === 'team' && Number(m.sender_client_id) === 0 ? event?.organizer || 'Contact Person' : null),
        body: m.body,
        is_auto: Boolean(m.is_auto),
        created_at: m.created_at,
    }));
};

/**
 * Who answers this event's chats, for Online / Offline: the event's contact
 * number, or the owner's own when it has none.
 */
const contactNumberOf = async (event) => {
    const contact = national(event.contact_phone);
    const owner = await WebsiteClient.findByPk(event.website_client_id, {
        attributes: ['mobile', 'vendor_id'],
        raw: true,
    });
    return { mobile: contact || national(owner?.mobile), vendorId: owner?.vendor_id || null };
};

const contactOnline = async (event) => {
    const { mobile, vendorId } = await contactNumberOf(event);
    return require('./eventOrganizer.service').isOnline(mobile, vendorId);
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

const national = (raw) => {
    const d = String(raw || '').replace(/\D/g, '');
    return d.length >= 7 ? d.slice(-10) : null;
};

/**
 * Whether this team member answers: the contact person, or the owner when the
 * event has no SEPARATE contact person — no contact number, or the owner's
 * own (2026-10-26: the contact person is the event's contact number).
 */
const answers = async (event, asContactPerson) => {
    if (asContactPerson) return true;
    const contact = national(event.contact_phone);
    if (!contact) return true;
    const owner = await WebsiteClient.findByPk(event.website_client_id, { attributes: ['mobile'], raw: true });
    return contact === national(owner?.mobile);
};

const teamChat = async (clientId, eventId, chatId) => {
    const { event } = await assertTeam(clientId, eventId);
    const chat = await EventContactChat.findOne({ where: { id: Number(chatId) || 0, event_id: event.id } });
    if (!chat) throw ApiError.notFound('That chat was not found.');
    return { event, chat };
};

const assertAnswers = async (event, asContactPerson) => {
    if (!(await answers(event, asContactPerson))) {
        throw ApiError.forbidden('Only the contact person can reply to participants. You can read the chats.');
    }
};

/** Participant Chats: every chat of the event, newest first, with counts. */
const listChats = async (clientId, eventId, asContactPerson = false) => {
    const { event } = await assertTeam(clientId, eventId);
    const chats = await EventContactChat.findAll({
        // Removed participants are off the list until they write again.
        where: { event_id: event.id, status: { [Op.ne]: 'removed' } },
        order: [['last_message_at', 'DESC'], ['id', 'DESC']],
        raw: true,
    });
    const ids = chats.map((c) => c.participant_client_id);
    const [names, guests] = await Promise.all([
        clientNames(ids),
        ids.length
            ? EventParticipant.findAll({
                where: { event_id: event.id, participant_client_id: { [Op.in]: ids } },
                attributes: ['participant_client_id', 'name', 'photo', 'rsvp_side'],
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
                // groom / bride (RSVP answer) — the list's side filter.
                side: g?.rsvp_side || null,
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
    return {
        event: { id: event.id, name: event.name },
        can_reply: await answers(event, asContactPerson),
        chats: rows,
        counts,
    };
};

/** One chat for the team; reading it clears the team's unread count. */
const getTeamMessages = async (clientId, eventId, chatId, senderId, asContactPerson = false) => {
    const { event, chat } = await teamChat(clientId, eventId, chatId);
    const canReply = await answers(event, asContactPerson);
    const [rows] = await Promise.all([
        lastMessages(chat.id),
        // Only the one who answers clears the unread count.
        canReply && chat.team_unread ? chat.update({ team_unread: 0 }) : null,
    ]);
    return {
        chat: { id: chat.id, status: chat.status },
        can_reply: canReply,
        messages: await shapeMessages(rows, senderId, event),
    };
};

const sendTeamMessage = async (clientId, eventId, chatId, senderId, rawBody, asContactPerson = false) => {
    const body = cleanBody(rawBody);
    const { event, chat } = await teamChat(clientId, eventId, chatId);
    await assertAnswers(event, asContactPerson);
    const msg = await EventContactChatMessage.create({
        chat_id: chat.id, sender_side: 'team', sender_client_id: senderId, body,
    });
    await chat.update({
        last_message: preview(body),
        last_message_at: new Date(),
        participant_unread: chat.participant_unread + 1,
        team_unread: 0,
    });
    // The participant's bell: "<contact> replied" (in-app; never throws).
    require('./clientNotification.service').notify(chat.participant_client_id, {
        type: 'contact_chat_reply',
        title: `${event.organizer || 'The contact person'} replied`,
        body: preview(body),
        eventId: event.id,
        meta: { chat_id: chat.id },
    });
    return (await shapeMessages([msg.get({ plain: true })], senderId, event))[0];
};

const setStatus = async (clientId, eventId, chatId, status, asContactPerson = false) => {
    if (!STATUSES.includes(status)) throw ApiError.badRequest('Please choose a valid status.');
    const { event, chat } = await teamChat(clientId, eventId, chatId);
    await assertAnswers(event, asContactPerson);
    // Resolved / removed: nothing left to read (Jamal's design).
    await chat.update({ status, ...(status === 'resolved' || status === 'removed' ? { team_unread: 0 } : {}) });
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
        online: await contactOnline(event),
        event_name: event.name,
    };
    if (!chat) return { chat: null, contact, messages: [] };
    const [rows] = await Promise.all([
        lastMessages(chat.id),
        chat.participant_unread ? chat.update({ participant_unread: 0 }) : null,
    ]);
    return {
        chat: { id: chat.id, status: chat.status },
        contact,
        messages: await shapeMessages(rows, clientId, event),
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
        // A new question reopens a resolved (or removed) chat.
        status: chat.status === 'resolved' || chat.status === 'removed' ? 'open' : chat.status,
    });
    const [message] = await shapeMessages([msg.get({ plain: true })], clientId, event);

    // Contact person offline → one automatic reply per quiet spell.
    const online = await contactOnline(event);
    let autoReply = null;
    if (!online) {
        const recentAuto = await EventContactChatMessage.findOne({
            where: {
                chat_id: chat.id,
                is_auto: true,
                created_at: { [Op.gt]: new Date(Date.now() - AUTO_REPLY_GAP_MS) },
            },
            attributes: ['id'],
        });
        if (!recentAuto) {
            const auto = await EventContactChatMessage.create({
                chat_id: chat.id, sender_side: 'team', sender_client_id: 0, body: AUTO_REPLY, is_auto: true,
            });
            [autoReply] = await shapeMessages([auto.get({ plain: true })], clientId, event);
        }
    }
    return { message, auto_reply: autoReply, contact_online: online };
};

module.exports = {
    listChats,
    getTeamMessages,
    sendTeamMessage,
    setStatus,
    getMyChat,
    sendMyMessage,
};
