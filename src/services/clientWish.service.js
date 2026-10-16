const { Sequelize, Event, EventWish, EventWishBlock, EventParticipant, WebsiteClient } = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

/**
 * An event's Wishes (2026-10-16) — replaces the app's sample list.
 *
 * Who does what (Jamal's decisions):
 *   · a participant writes a wish (message + one optional photo); it is
 *     VISIBLE at once — no approval step;
 *   · a participant may edit / delete their OWN wish;
 *   · the organizer sees every wish, adds one on someone's behalf (name,
 *     optional mobile, message, photo, Show in App), edits, hides / shows,
 *     deletes, and blocks / unblocks the participant who wrote it;
 *   · a block is WISHES ONLY and per event: the person can no longer send or
 *     edit wishes there; their existing wishes stay as they are (the organizer
 *     hides or deletes them separately);
 *   · participants see every wish that is not hidden, plus their own.
 *
 * The organizer of someone else's event arrives here as the owner (see
 * eventOrganizerAccess — /events/:id/… and /wishes/:id are both pinned).
 */

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_MESSAGE = 500;
const MAX_NAME = 150;
const MEDIA_URL = /^(https?:\/\/|\/uploads\/)/i;

const EVENT_ATTRS = ['id', 'website_client_id', 'company_id'];

/** The event as the caller may see it: its owner, or one of its participants. */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');
    const event = await Event.findByPk(eventId, { attributes: EVENT_ATTRS });
    if (!event) throw ApiError.notFound('That event was not found.');

    if (Number(event.website_client_id) === Number(clientId)) {
        return { event, isOwner: true, participant: null };
    }
    const participant = await EventParticipant.findOne({
        where: { event_id: event.id, participant_client_id: clientId },
        attributes: ['id', 'name', 'mobile', 'photo'],
    });
    if (!participant) throw ApiError.notFound('That event is not on your account.');
    return { event, isOwner: false, participant };
};

const resolveWish = async (clientId, wishId) => {
    const wish = await EventWish.findByPk(Number(wishId) || 0);
    if (!wish) throw ApiError.notFound('That wish was not found.');
    const access = await resolveEvent(clientId, wish.event_id);
    return { wish, ...access };
};

const isBlocked = async (eventId, clientId) => !!(await EventWishBlock.findOne({
    where: { event_id: eventId, author_client_id: clientId },
    attributes: ['id'],
}));

const refuseBlocked = () => ApiError.forbidden('You can no longer send wishes for this event.');

const str = (v, max) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : null;
};

const photoOf = (v) => {
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !MEDIA_URL.test(v.trim())) throw ApiError.badRequest('Invalid wish photo.');
    return v.trim();
};

const mobileOf = (v) => {
    const s = str(v, 20);
    if (!s) return null;
    if (!/^\+?\d{6,15}$/.test(s.replace(/[\s-]/g, ''))) throw ApiError.badRequest('Please enter a valid mobile number.');
    return s.replace(/[\s-]/g, '');
};

/** File of a photo no longer used — removed from storage, best effort. */
const dropPhoto = (url, companyId) => (url ? mediaService.deleteByUrl(url, companyId || 1).catch(() => null) : null);

/**
 * One wish as [viewer] may see it. `status` is the organizer's tab:
 * blocked (its writer is blocked) › hidden › visible.
 */
const present = (row, { isOwner, viewerId, blocked, avatars }) => {
    const w = row.toJSON ? row.toJSON() : row;
    const mine = !!w.author_client_id && Number(w.author_client_id) === Number(viewerId);
    const authorBlocked = !!w.author_client_id && blocked.has(Number(w.author_client_id));
    let status = 'visible';
    if (Number(w.is_hidden) === 1) status = 'hidden';
    if (isOwner && authorBlocked) status = 'blocked';
    return {
        id: w.id,
        event_id: w.event_id,
        guest_name: w.guest_name,
        // Contact details are the organizer's (and the writer's own) only.
        mobile: isOwner || mine ? w.mobile : null,
        message: w.message,
        photo: w.photo,
        avatar: w.author_client_id ? avatars.get(Number(w.author_client_id)) || null : null,
        is_hidden: Number(w.is_hidden) === 1,
        status,
        added_by_organizer: !w.author_client_id,
        author_blocked: isOwner ? authorBlocked : false,
        is_mine: mine,
        can_edit: isOwner || (mine && !authorBlocked),
        can_delete: isOwner || mine,
        created_at: w.created_at,
        updated_at: w.updated_at,
    };
};

/** Participant photos of the writers, and the event's blocked writers. */
const contextFor = async (eventId, rows) => {
    const authors = [...new Set(rows.map((r) => Number(r.author_client_id)).filter(Boolean))];
    const [people, blocks] = await Promise.all([
        authors.length
            ? EventParticipant.findAll({
                where: { event_id: eventId, participant_client_id: authors },
                attributes: ['participant_client_id', 'photo'],
                raw: true,
            })
            : [],
        EventWishBlock.findAll({ where: { event_id: eventId }, attributes: ['author_client_id'], raw: true }),
    ]);
    const avatars = new Map();
    for (const p of people) {
        if (p.photo && !avatars.has(Number(p.participant_client_id))) avatars.set(Number(p.participant_client_id), p.photo);
    }
    return { avatars, blocked: new Set(blocks.map((b) => Number(b.author_client_id))) };
};

const presentOne = async (row, clientId, isOwner) => {
    const ctx = await contextFor(row.event_id, [row]);
    return present(row, { isOwner, viewerId: clientId, ...ctx });
};

const list = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    const where = { event_id: event.id };
    if (!isOwner) {
        where[Sequelize.Op.or] = [{ is_hidden: 0 }, { author_client_id: clientId }];
    }
    const rows = await EventWish.findAll({ where, order: [['created_at', 'DESC'], ['id', 'DESC']] });
    const ctx = await contextFor(event.id, rows);
    const wishes = rows.map((r) => present(r, { isOwner, viewerId: clientId, ...ctx }));

    const result = {
        wishes,
        can_manage: isOwner,
        is_blocked: !isOwner && ctx.blocked.has(Number(clientId)),
    };
    if (isOwner) {
        const count = (s) => wishes.filter((w) => w.status === s).length;
        result.counts = {
            all: wishes.length,
            visible: count('visible'),
            hidden: count('hidden'),
            blocked: count('blocked'),
        };
    }
    return result;
};

const getOne = async (clientId, wishId) => {
    const { wish, isOwner } = await resolveWish(clientId, wishId);
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine && Number(wish.is_hidden) === 1) throw ApiError.notFound('That wish was not found.');
    return presentOne(wish, clientId, isOwner);
};

const create = async (clientId, eventId, body = {}) => {
    const { event, isOwner, participant } = await resolveEvent(clientId, eventId);
    const message = str(body.message, MAX_MESSAGE);
    const photo = body.photo === undefined ? null : photoOf(body.photo);

    let data;
    if (isOwner) {
        const name = str(body.guest_name, MAX_NAME);
        if (!name || !message) throw ApiError.badRequest('Please fill all mandatory fields.');
        data = {
            author_client_id: null,
            guest_name: name,
            mobile: mobileOf(body.mobile),
            is_hidden: body.show_in_app === false ? 1 : 0,
        };
    } else {
        if (await isBlocked(event.id, clientId)) throw refuseBlocked();
        if (!message) throw ApiError.badRequest('Please fill all mandatory fields.');
        let name = str(participant.name, MAX_NAME);
        if (!name) {
            const me = await WebsiteClient.findByPk(clientId, { attributes: ['name'] });
            name = str(me?.name, MAX_NAME) || 'Guest';
        }
        data = { author_client_id: clientId, guest_name: name, mobile: participant.mobile || null, is_hidden: 0 };
    }

    const row = await EventWish.create({
        ...data,
        message,
        photo,
        event_id: event.id,
        website_client_id: event.website_client_id,
        company_id: event.company_id ?? null,
    });
    return presentOne(row, clientId, isOwner);
};

const update = async (clientId, wishId, body = {}) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine) throw ApiError.forbidden('Only the organizer or the writer can edit this wish.');
    if (!isOwner && await isBlocked(event.id, clientId)) throw refuseBlocked();

    const has = (f) => Object.prototype.hasOwnProperty.call(body, f);
    const data = {};
    if (has('message')) {
        const message = str(body.message, MAX_MESSAGE);
        if (!message) throw ApiError.badRequest('Please fill all mandatory fields.');
        data.message = message;
    }
    if (has('photo')) data.photo = photoOf(body.photo);
    if (isOwner) {
        // The writer's own name stays theirs; only an organizer-added wish is renamed.
        if (has('guest_name') && !wish.author_client_id) {
            const name = str(body.guest_name, MAX_NAME);
            if (!name) throw ApiError.badRequest('Please fill all mandatory fields.');
            data.guest_name = name;
        }
        if (has('mobile') && !wish.author_client_id) data.mobile = mobileOf(body.mobile);
        if (has('show_in_app')) data.is_hidden = body.show_in_app ? 0 : 1;
    }

    const before = wish.photo;
    await wish.update(data);
    if (has('photo') && before && before !== wish.photo) await dropPhoto(before, event.company_id);
    return presentOne(wish, clientId, isOwner);
};

const remove = async (clientId, wishId) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine) throw ApiError.forbidden('Only the organizer or the writer can delete this wish.');
    const photo = wish.photo;
    await wish.destroy();
    await dropPhoto(photo, event.company_id);
    return { removed: true };
};

/** Block / unblock the participant who wrote [wishId] — organizer only. */
const setBlocked = async (clientId, wishId, blocked) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can block a participant.');
    if (!wish.author_client_id) throw ApiError.badRequest('This wish was added by you — there is no participant to block.');

    const where = { event_id: event.id, author_client_id: wish.author_client_id };
    if (blocked) await EventWishBlock.findOrCreate({ where, defaults: where });
    else await EventWishBlock.destroy({ where });
    return presentOne(wish, clientId, true);
};

const uploadPhoto = async (clientId, eventId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    if (!isOwner && await isBlocked(event.id, clientId)) throw refuseBlocked();
    if (!PHOTO_MIMES.includes(file.mimetype)) throw ApiError.badRequest('Please choose a JPG, PNG or WEBP image.');
    const stored = await mediaService.upload(file, { folder: `event-wishes/${event.id}` }, event.company_id || 1);
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: stored.url };
};

module.exports = {
    MAX_PHOTO_BYTES,
    PHOTO_MIMES,
    list,
    getOne,
    create,
    update,
    remove,
    setBlocked,
    uploadPhoto,
};
