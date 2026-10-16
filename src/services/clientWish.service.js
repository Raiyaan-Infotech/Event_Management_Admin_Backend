const {
    Sequelize, Event, EventWish, EventWishBlock, EventWishLike, EventParticipant, WebsiteClient,
} = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');
const notificationService = require('./clientNotification.service');
const gallery = require('./clientGallery.service');
const subscriptionPlanService = require('./subscriptionPlan.service');
const { processVideo, videoPoster } = require('../utils/videoProcess');

const { Op } = Sequelize;

/**
 * Wed Wishes (2026-10-16) — an event's feed of wishes.
 *
 * A wish is a POST (Jamal's second mockup): Text, Image or Video, addressed
 * To Groom / To Bride / To Both (a badge — everyone still sees it), that people
 * can LIKE. No comments, no share, no reports (Jamal).
 *
 * Who does what (Jamal's decisions):
 *   · a participant posts; it is VISIBLE at once — no approval step;
 *   · a participant may edit / delete their OWN post;
 *   · the organizer sees every post, posts as the organizer ("Organizer Post"),
 *     edits, hides / shows, deletes, and blocks / unblocks a writer;
 *   · a block is WISHES ONLY and per event: no new post, edit or like; their
 *     existing posts stay (the organizer hides or deletes them separately);
 *   · participants see every post that is not hidden, plus their own.
 *
 * Media counts against the plan exactly like gallery files: a video takes one
 * of the event's `max_videos` ("Max Videos" — gallery + wishes) and its bytes
 * count in the account's storage ("Max Storage"). Same per-file caps, same
 * server-side video work (mute, playable H.264, first-frame poster).
 *
 * What participants see and may do is also the organizer's call —
 * `events.wish_settings` (the settings icon on the list, like Family's). The
 * server enforces and trims; the organizer and the writer are never trimmed.
 *
 * Content filter (Phase 2, `wish_settings.filter`): the organizer's blocked
 * words / phrases, each with what it is replaced by. A participant's post that
 * contains one is saved with the word REPLACED and flagged (`is_flagged`);
 * with auto-hide it is also hidden until the organizer reviews it, and with
 * notify the organizer gets an in-app notification. Words match whole words,
 * any case, in any script (Tamil / Hindi letters and marks count as letters).
 *
 * Block options: hide the Wed Wishes menu from the person too (`hide_menu`),
 * and optionally remove every post they made on the event.
 *
 * Text is cut by CHARACTERS (code points), not UTF-16 units, so an emoji or a
 * Tamil / Hindi letter at the limit is never split in half.
 *
 * The organizer of someone else's event arrives here as the owner (see
 * eventOrganizerAccess — /events/:id/… and /wishes/:id are both pinned).
 */

const MAX_MESSAGE = 500;
const MAX_NAME = 150;
const POST_TYPES = ['text', 'image', 'video'];
const AUDIENCES = ['groom', 'bride', 'both'];
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MEDIA_MIMES = [...IMAGE_MIMES, ...gallery.VIDEO_MIMES];
/** Multer's ceiling; the real per-type caps are checked in storeMedia. */
const MAX_UPLOAD_BYTES = Math.max(gallery.MAX_IMAGE_BYTES, gallery.MAX_VIDEO_BYTES);

const EVENT_ATTRS = [
    'id', 'name', 'website_client_id', 'organizer_client_id', 'company_id', 'wish_settings',
    'subscription_plan_id', 'organizer',
];

const SETTINGS_DEFAULTS = Object.freeze({
    allow_new: true,
    /** Participants may attach an image or a video. */
    allow_photo: true,
    details_screen: true,
    profile_photo: true,
    name: true,
    /** Participants see a post's image / video. */
    wish_photo: true,
    time: true,
});

const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

const parseJson = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) || {}; } catch { return {}; }
    }
    return typeof raw === 'object' ? raw : {};
};

const bool = (value, fallback) => (value === undefined || value === null
    ? fallback
    : value === true || value === 1 || value === '1' || value === 'true');

const storedOf = (event) => parseJson((event?.toJSON ? event.toJSON() : (event || {})).wish_settings);

/** Resolved settings for an event; `name` is always on (a wish needs a name). */
const settingsOf = (event) => {
    const stored = storedOf(event);
    const out = {};
    for (const [k, d] of Object.entries(SETTINGS_DEFAULTS)) out[k] = bool(stored[k], d);
    out.name = true;
    return out;
};

// ── Content filter ──────────────────────────────────────────────────────────

const MAX_FILTER_WORDS = 200;
const MAX_FILTER_WORD = 60;
const DEFAULT_REPLACE = '***';

/** The event's filter: on/off, words, auto-hide, notify. Off until switched on. */
const filterOf = (event) => {
    const f = parseJson(storedOf(event).filter);
    const words = [];
    const seen = new Set();
    for (const w of Array.isArray(f.words) ? f.words : []) {
        const word = str(w?.word, MAX_FILTER_WORD);
        if (!word || seen.has(word.toLowerCase())) continue;
        seen.add(word.toLowerCase());
        const replace = typeof w?.replace === 'string' ? Array.from(w.replace.trim()).slice(0, MAX_FILTER_WORD).join('') : '';
        words.push({ word, replace: replace || DEFAULT_REPLACE });
        if (words.length >= MAX_FILTER_WORDS) break;
    }
    return {
        enabled: bool(f.enabled, false),
        words,
        auto_hide: bool(f.auto_hide, true),
        notify: bool(f.notify, true),
    };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * [text] with every blocked word / phrase replaced. A match is a whole word in
 * any script — letters, digits and combining marks (Indic vowel signs) on
 * either side mean it is part of a longer word — any case.
 */
const applyFilter = (text, filter) => {
    if (!filter.enabled || !text || !filter.words.length) return { text, flagged: false };
    let out = text;
    let flagged = false;
    for (const { word, replace } of filter.words) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escapeRegex(word)}(?![\\p{L}\\p{N}\\p{M}])`, 'giu');
        out = out.replace(re, () => {
            flagged = true;
            return replace;
        });
    }
    return { text: out, flagged };
};

/** Tell the organizer a post was flagged (in-app; best effort, never throws). */
const notifyFlagged = async (event, wish) => {
    const snippet = Array.from(wish.message || '').slice(0, 120).join('');
    const ids = [...new Set([event.website_client_id, event.organizer_client_id].map(Number).filter(Boolean))];
    await Promise.all(ids.map((id) => notificationService.notify(id, {
        type: 'wish_flagged',
        title: 'A wish was flagged',
        body: `${wish.guest_name}${snippet ? `: ${snippet}` : ''}`,
        eventId: event.id,
        companyId: event.company_id ?? null,
        meta: { wish_id: wish.id },
    }).catch(() => null)));
};

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
const refuseClosed = () => ApiError.forbidden('The organizer has closed wishes for this event.');
const refuseNoMedia = () => ApiError.badRequest('Photos and videos are turned off for wishes on this event.');

/** Trimmed text cut to [max] CHARACTERS (code points) — never half an emoji. */
const str = (v, max) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) return null;
    const chars = Array.from(s);
    return chars.length > max ? chars.slice(0, max).join('').trim() : s;
};

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** A stored file no longer used — removed from storage, best effort. */
const dropFile = (url, companyId) => (url ? mediaService.deleteByUrl(url, companyId || 1).catch(() => null) : null);

const dropMediaOf = (w, companyId) => Promise.all(
    [...new Set([w.photo, w.video_url, w.thumbnail_url].filter(Boolean))].map((u) => dropFile(u, companyId)),
);

const NO_MEDIA = Object.freeze({ photo: null, video_url: null, thumbnail_url: null, duration_seconds: null, size_bytes: 0 });

/** Who is posting as the organizer: the event's organizer name, else the client's. */
const organizerName = async (event, clientId) => {
    const named = str(event.organizer, MAX_NAME);
    if (named) return named;
    const me = await WebsiteClient.findByPk(clientId, { attributes: ['name'] });
    return str(me?.name, MAX_NAME) || 'Organizer';
};

/**
 * Store an uploaded image / video for a wish, with the gallery's rules:
 * per-file cap, the event's video count (gallery + wishes), the owner's storage
 * (gallery + wishes), mute + playable video, poster / thumbnail. [replacing]
 * is the wish whose media this replaces — its own video and bytes are not
 * counted against it.
 */
const storeMedia = async (event, file, body = {}, replacing = null) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose a photo or video.');
    const isImage = IMAGE_MIMES.includes(file.mimetype);
    const isVideo = gallery.VIDEO_MIMES.includes(file.mimetype);
    if (!isImage && !isVideo) {
        throw ApiError.badRequest('Please choose a JPG, PNG or WEBP image, or an MP4, WebM or MOV video.');
    }
    const size = Number(file.size || file.buffer.length || 0);
    const cap = isImage ? gallery.MAX_IMAGE_BYTES : gallery.MAX_VIDEO_BYTES;
    if (size > cap) {
        throw ApiError.badRequest(`${isImage ? 'Images' : 'Videos'} must be ${mb(cap)}MB or smaller. This file is ${mb(size)}MB.`);
    }

    // Max Videos — per event, gallery and wishes together.
    if (isVideo) {
        const limit = await subscriptionPlanService.getPlanLimit(event.subscription_plan_id, 'max_videos');
        if (limit !== null) {
            const used = await gallery.videosUsedFor(event.id)
                - (replacing && replacing.post_type === 'video' ? 1 : 0);
            if (used >= limit) {
                throw ApiError.badRequest(
                    `This event has reached its limit of ${limit} video${limit === 1 ? '' : 's'}. Please upgrade your plan to add more.`,
                );
            }
        }
    }

    // Max Storage — per account (the event's owner), gallery and wishes together.
    const ownerId = event.website_client_id;
    const owner = await WebsiteClient.findByPk(ownerId, { attributes: ['subscription_plan_id', 'company_id'] });
    const plan = owner?.subscription_plan_id
        ? await subscriptionPlanService.getById(owner.subscription_plan_id).catch(() => null)
        : null;
    const storageLimit = gallery.storageBytesFor(plan);
    if (storageLimit !== null) {
        const used = await gallery.storageUsedFor(ownerId) - Number(replacing?.size_bytes || 0);
        if (used + size > storageLimit) {
            const left = Math.max(0, storageLimit - used);
            throw ApiError.badRequest(
                `Your plan includes ${mb(storageLimit)}MB of storage and ${mb(left)}MB is left. This file is ${mb(size)}MB.`,
            );
        }
    }

    let toStore = file;
    if (isVideo) {
        const mute = [true, 'true', 1, '1'].includes(body.mute);
        const out = await processVideo(file.buffer, file.mimetype, { mute });
        if (mute && !out.muted) throw ApiError.badRequest('The sound could not be removed from this video. Please try again.');
        if (out.applied && out.buffer.length <= gallery.MAX_VIDEO_BYTES) {
            const ext = out.mimetype === 'video/webm' ? '.webm' : '.mp4';
            toStore = {
                ...file,
                buffer: out.buffer,
                size: out.buffer.length,
                mimetype: out.mimetype,
                originalname: (file.originalname || 'video').replace(/\.[^.]+$/, '') + ext,
            };
        } else if (mute && out.applied) {
            throw ApiError.badRequest(`Videos must be ${mb(gallery.MAX_VIDEO_BYTES)}MB or smaller.`);
        }
    }

    const companyId = event.company_id || owner?.company_id || 1;
    const folder = { folder: `event-wishes/${event.id}` };
    const stored = await mediaService.upload(toStore, folder, companyId);
    if (!stored || !stored.url) throw ApiError.badRequest('That file could not be stored.');

    // Small picture for the feed: a video's first frame, a photo's ~480 px copy.
    let thumbnail = null;
    try {
        const jpeg = isVideo ? await videoPoster(toStore.buffer) : await gallery.imageThumb(toStore.buffer);
        if (jpeg) {
            const base = (toStore.originalname || 'wish').replace(/\.[^.]+$/, '');
            const t = await mediaService.upload(
                { buffer: jpeg, size: jpeg.length, mimetype: 'image/jpeg', originalname: `${base}-${isVideo ? 'poster' : 'thumb'}.jpg` },
                folder,
                companyId,
            );
            thumbnail = t?.url || null;
        }
    } catch (_) {
        thumbnail = null;
    }

    const duration = Math.round(Number(body.duration_seconds));
    return {
        post_type: isVideo ? 'video' : 'image',
        photo: isImage ? stored.url : null,
        video_url: isVideo ? stored.url : null,
        thumbnail_url: thumbnail,
        duration_seconds: isVideo && duration > 0 && duration < 3600 ? duration : null,
        size_bytes: Number(stored.size || toStore.size || size),
    };
};

/**
 * One wish as [viewer] may see it. `status` is the organizer's tab:
 * blocked (its writer is blocked) › hidden › visible.
 */
const present = (row, { isOwner, viewerId, ctx, settings = SETTINGS_DEFAULTS }) => {
    const w = row.toJSON ? row.toJSON() : row;
    const author = Number(w.author_client_id) || null;
    const mine = !!author && author === Number(viewerId);
    const authorBlocked = !!author && ctx.blocked.has(author);
    // Others get only what the organizer's settings show; the organizer and the
    // writer always see the post whole (the edit form must not lose the media).
    const whole = isOwner || mine;
    const showMedia = whole || settings.wish_photo;
    let status = 'visible';
    if (Number(w.is_hidden) === 1) status = 'hidden';
    if (isOwner && authorBlocked) status = 'blocked';
    const person = author ? ctx.people.get(author) : null;
    return {
        id: w.id,
        event_id: w.event_id,
        post_type: w.post_type || 'text',
        audience: w.audience || 'both',
        guest_name: w.guest_name,
        mobile: whole ? w.mobile : null,
        message: w.message,
        photo: showMedia ? w.photo : null,
        video_url: showMedia ? w.video_url : null,
        thumbnail_url: showMedia ? w.thumbnail_url : null,
        duration_seconds: showMedia ? w.duration_seconds : null,
        avatar: person && (whole || settings.profile_photo) ? person.photo : null,
        like_count: ctx.likes.get(w.id) || 0,
        liked_by_me: ctx.mine.has(w.id),
        is_hidden: Number(w.is_hidden) === 1,
        /** Organizer only: the content filter caught a word, not reviewed yet. */
        is_flagged: isOwner ? Number(w.is_flagged) === 1 : false,
        status,
        added_by_organizer: !author,
        author_blocked: isOwner ? authorBlocked : false,
        /** The writer's participant row — the organizer contacts them through it. */
        participant_id: isOwner && person ? person.id : null,
        is_mine: mine,
        can_edit: isOwner || (mine && !authorBlocked),
        can_delete: isOwner || mine,
        created_at: whole || settings.time ? w.created_at : null,
        updated_at: w.updated_at,
    };
};

/** Writers' participant rows, blocked writers, like counts and the viewer's likes. */
const contextFor = async (eventId, rows, viewerId) => {
    const authors = [...new Set(rows.map((r) => Number(r.author_client_id)).filter(Boolean))];
    const ids = rows.map((r) => r.id);
    const [people, blocks, counts, mine] = await Promise.all([
        authors.length
            ? EventParticipant.findAll({
                where: { event_id: eventId, participant_client_id: authors },
                attributes: ['id', 'participant_client_id', 'photo'],
                order: [['id', 'ASC']],
                raw: true,
            })
            : [],
        EventWishBlock.findAll({ where: { event_id: eventId }, attributes: ['author_client_id', 'hide_menu'], raw: true }),
        ids.length
            ? EventWishLike.findAll({
                where: { wish_id: ids },
                attributes: ['wish_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'n']],
                group: ['wish_id'],
                raw: true,
            })
            : [],
        ids.length
            ? EventWishLike.findAll({ where: { wish_id: ids, client_id: viewerId }, attributes: ['wish_id'], raw: true })
            : [],
    ]);
    const byClient = new Map();
    for (const p of people) {
        const key = Number(p.participant_client_id);
        const seen = byClient.get(key);
        if (!seen || (!seen.photo && p.photo)) byClient.set(key, { id: p.id, photo: p.photo || null });
    }
    return {
        people: byClient,
        blocked: new Set(blocks.map((b) => Number(b.author_client_id))),
        hiddenMenu: new Set(blocks.filter((b) => Number(b.hide_menu) === 1).map((b) => Number(b.author_client_id))),
        likes: new Map(counts.map((c) => [Number(c.wish_id), Number(c.n)])),
        mine: new Set(mine.map((m) => Number(m.wish_id))),
    };
};

const presentOne = async (row, clientId, isOwner, event) => {
    const ctx = await contextFor(row.event_id, [row], clientId);
    return present(row, { isOwner, viewerId: clientId, ctx, settings: settingsOf(event) });
};

const list = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    const where = { event_id: event.id };
    if (!isOwner) where[Op.or] = [{ is_hidden: 0 }, { author_client_id: clientId }];
    const rows = await EventWish.findAll({ where, order: [['created_at', 'DESC'], ['id', 'DESC']] });
    const ctx = await contextFor(event.id, rows, clientId);
    const blockedHere = !isOwner && ctx.blocked.has(Number(clientId));
    // Blocked with the menu hidden: Wed Wishes is not there for them at all.
    if (blockedHere && ctx.hiddenMenu.has(Number(clientId))) {
        throw ApiError.forbidden('Wed Wishes is not available for you on this event.');
    }
    const settings = settingsOf(event);
    const wishes = rows.map((r) => present(r, { isOwner, viewerId: clientId, ctx, settings }));

    const result = {
        wishes,
        settings,
        can_manage: isOwner,
        is_blocked: blockedHere,
        /** New Post: the organizer always; a participant when open and not blocked. */
        can_write: isOwner || (settings.allow_new && !blockedHere),
    };
    if (isOwner) {
        const count = (s) => wishes.filter((w) => w.status === s).length;
        result.counts = {
            all: wishes.length,
            visible: count('visible'),
            hidden: count('hidden'),
            blocked: count('blocked'),
            /** People blocked from Wishes on this event (the dashboard tile). */
            blocked_users: ctx.blocked.size,
            /** Caught by the content filter, not reviewed yet. */
            flagged: wishes.filter((w) => w.is_flagged).length,
        };
    }
    return result;
};

const getOne = async (clientId, wishId) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine && Number(wish.is_hidden) === 1) throw ApiError.notFound('That wish was not found.');
    if (!isOwner && !mine && !settingsOf(event).details_screen) {
        throw ApiError.forbidden('Wish details are turned off for this event.');
    }
    return presentOne(wish, clientId, isOwner, event);
};

/**
 * New post. JSON for a text post; multipart (`file`) for an image / video post.
 * Fields: message, audience; the organizer may also send guest_name (else the
 * post is signed as the organizer).
 */
const create = async (clientId, eventId, body = {}, file = null) => {
    const { event, isOwner, participant } = await resolveEvent(clientId, eventId);
    const settings = settingsOf(event);
    if (!isOwner) {
        if (await isBlocked(event.id, clientId)) throw refuseBlocked();
        if (!settings.allow_new) throw refuseClosed();
        if (file && !settings.allow_photo) throw refuseNoMedia();
    }

    const message = str(body.message, MAX_MESSAGE);
    const wantType = pick(body.post_type, POST_TYPES, file ? 'image' : 'text');
    if (wantType !== 'text' && !file) throw ApiError.badRequest('Please choose a photo or video.');
    if (wantType === 'text' && !message) throw ApiError.badRequest('Please fill all mandatory fields.');

    let who;
    if (isOwner) {
        who = {
            author_client_id: null,
            guest_name: str(body.guest_name, MAX_NAME) || await organizerName(event, clientId),
            mobile: null,
        };
    } else {
        let name = str(participant.name, MAX_NAME);
        if (!name) {
            const me = await WebsiteClient.findByPk(clientId, { attributes: ['name'] });
            name = str(me?.name, MAX_NAME) || 'Participant';
        }
        who = { author_client_id: clientId, guest_name: name, mobile: participant.mobile || null };
    }

    // The organizer's own posts are not filtered — they set the words.
    const filter = filterOf(event);
    const checked = isOwner ? { text: message, flagged: false } : applyFilter(message, filter);
    const flaggedHidden = checked.flagged && filter.auto_hide;

    const media = file ? await storeMedia(event, file, body) : { ...NO_MEDIA, post_type: 'text' };
    const row = await EventWish.create({
        ...who,
        ...media,
        audience: pick(body.audience, AUDIENCES, 'both'),
        message: checked.text || '',
        is_hidden: flaggedHidden ? 1 : 0,
        is_flagged: checked.flagged ? 1 : 0,
        event_id: event.id,
        website_client_id: event.website_client_id,
        company_id: event.company_id ?? null,
    });
    if (checked.flagged && filter.notify) await notifyFlagged(event, row);
    return presentOne(row, clientId, isOwner, event);
};

/** Who may change [wish]: the organizer, or its writer while not blocked. */
const assertCanEdit = async (wish, event, isOwner, clientId) => {
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine) throw ApiError.forbidden('Only the organizer or the writer can edit this wish.');
    if (!isOwner && await isBlocked(event.id, clientId)) throw refuseBlocked();
};

/**
 * Edit text / audience; the organizer may also hide / show (`show_in_app`).
 * `post_type: 'text'` drops the media (a post turned back into text).
 * New media goes through replaceMedia.
 */
const update = async (clientId, wishId, body = {}) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    await assertCanEdit(wish, event, isOwner, clientId);

    const has = (f) => Object.prototype.hasOwnProperty.call(body, f);
    const data = {};
    const toText = body.post_type === 'text' && wish.post_type !== 'text';
    let flaggedNow = false;
    if (has('message')) {
        data.message = str(body.message, MAX_MESSAGE) || '';
        if (!isOwner) {
            const filter = filterOf(event);
            const checked = applyFilter(data.message, filter);
            data.message = checked.text;
            if (checked.flagged) {
                flaggedNow = filter.notify;
                data.is_flagged = 1;
                if (filter.auto_hide) data.is_hidden = 1;
            }
        }
    }
    if ((toText || (wish.post_type === 'text' && has('message'))) && !(data.message ?? wish.message)) {
        throw ApiError.badRequest('Please fill all mandatory fields.');
    }
    if (has('audience')) data.audience = pick(body.audience, AUDIENCES, wish.audience);
    if (isOwner && has('show_in_app')) {
        data.is_hidden = body.show_in_app ? 0 : 1;
        // Showing a flagged post IS the review.
        if (body.show_in_app) data.is_flagged = 0;
    }
    if (isOwner && bool(body.reviewed, false)) data.is_flagged = 0;

    const before = wish.toJSON();
    if (toText) Object.assign(data, NO_MEDIA, { post_type: 'text' });
    await wish.update(data);
    if (toText) await dropMediaOf(before, event.company_id);
    if (flaggedNow) await notifyFlagged(event, wish);
    return presentOne(wish, clientId, isOwner, event);
};

/** Put a new image / video on an existing post (multipart `file`). */
const replaceMedia = async (clientId, wishId, file, body = {}) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    await assertCanEdit(wish, event, isOwner, clientId);
    if (!isOwner && !settingsOf(event).allow_photo) throw refuseNoMedia();

    const before = wish.toJSON();
    const media = await storeMedia(event, file, body, before);
    await wish.update(media);
    await dropMediaOf(before, event.company_id);
    return presentOne(wish, clientId, isOwner, event);
};

const remove = async (clientId, wishId) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine) throw ApiError.forbidden('Only the organizer or the writer can delete this wish.');
    const before = wish.toJSON();
    await wish.destroy();
    await dropMediaOf(before, event.company_id);
    return { removed: true };
};

/** Like / unlike — anyone who can see the post, except a blocked writer. */
const setLiked = async (clientId, wishId, liked) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    const mine = Number(wish.author_client_id) === Number(clientId);
    if (!isOwner && !mine && Number(wish.is_hidden) === 1) throw ApiError.notFound('That wish was not found.');
    if (!isOwner && await isBlocked(event.id, clientId)) throw refuseBlocked();

    const where = { wish_id: wish.id, client_id: clientId };
    if (liked) await EventWishLike.findOrCreate({ where, defaults: where });
    else await EventWishLike.destroy({ where });
    return presentOne(wish, clientId, isOwner, event);
};

/**
 * Block / unblock the participant who wrote [wishId] — organizer only.
 * Block options (Jamal's "Block Participant" screen): `hide_menu` (default on)
 * hides the Wed Wishes menu from them too; `remove_wishes` deletes every post
 * they made on this event, files included. Returns the wish, or null when it
 * was removed with the others.
 */
const setBlocked = async (clientId, wishId, blocked, options = {}) => {
    const { wish, event, isOwner } = await resolveWish(clientId, wishId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can block a participant.');
    if (!wish.author_client_id) throw ApiError.badRequest('This is your own post — there is no participant to block.');

    const where = { event_id: event.id, author_client_id: wish.author_client_id };
    if (!blocked) {
        await EventWishBlock.destroy({ where });
        return { wish: await presentOne(wish, clientId, true, event), removed: 0 };
    }

    const hideMenu = bool(options.hide_menu, true) ? 1 : 0;
    const [row, created] = await EventWishBlock.findOrCreate({ where, defaults: { ...where, hide_menu: hideMenu } });
    if (!created && Number(row.hide_menu) !== hideMenu) await row.update({ hide_menu: hideMenu });

    let removed = 0;
    if (bool(options.remove_wishes, false)) {
        const theirs = await EventWish.findAll({ where, raw: true });
        for (const w of theirs) {
            // eslint-disable-next-line no-await-in-loop
            await dropMediaOf(w, event.company_id);
        }
        removed = await EventWish.destroy({ where });
        return { wish: null, removed };
    }
    return { wish: await presentOne(wish, clientId, true, event), removed };
};

/**
 * Whether the Wed Wishes menu is hidden from [clientId] on these events — a
 * block with `hide_menu`. Returns the set of event ids (clientEvent drops the
 * `wishes` menu for them).
 */
const menuHiddenFor = async (clientId, eventIds) => {
    const ids = [...new Set((eventIds || []).map(Number).filter(Boolean))];
    if (!clientId || !ids.length) return new Set();
    const rows = await EventWishBlock.findAll({
        where: { author_client_id: clientId, event_id: ids, hide_menu: 1 },
        attributes: ['event_id'],
        raw: true,
    });
    return new Set(rows.map((r) => Number(r.event_id)));
};

/** Removes every wish file of a deleted event (with clientGallery.purgeEvent). */
const purgeEvent = async (eventId) => {
    const rows = await EventWish.findAll({ where: { event_id: eventId }, raw: true });
    for (const w of rows) {
        // eslint-disable-next-line no-await-in-loop
        await dropMediaOf(w, w.company_id);
    }
    await EventWish.destroy({ where: { event_id: eventId } });
};

// ── Settings (the settings icon on the Wishes list) ─────────────────────────

const getSettings = async (clientId, eventId) => {
    const { event } = await resolveEvent(clientId, eventId);
    return { event_id: event.id, settings: settingsOf(event) };
};

const updateSettings = async (clientId, eventId, body = {}) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can change wish settings.');
    const current = settingsOf(event);
    const next = {};
    for (const k of Object.keys(SETTINGS_DEFAULTS)) next[k] = bool(body[k], current[k]);
    next.name = true;
    // The content filter is saved on its own screen — keep it.
    await event.update({ wish_settings: { ...storedOf(event), ...next } });
    return { event_id: event.id, settings: next };
};

// ── Content filter settings (Wish Settings → Content Filter) ────────────────

const getFilter = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can see the content filter.');
    return { event_id: event.id, filter: filterOf(event) };
};

const updateFilter = async (clientId, eventId, body = {}) => {
    const { event, isOwner } = await resolveEvent(clientId, eventId);
    if (!isOwner) throw ApiError.forbidden('Only the organizer can change the content filter.');
    if (body.words !== undefined && !Array.isArray(body.words)) throw ApiError.badRequest('Invalid word list.');
    const current = filterOf(event);
    const merged = {
        enabled: bool(body.enabled, current.enabled),
        words: body.words === undefined ? current.words : body.words,
        auto_hide: bool(body.auto_hide, current.auto_hide),
        notify: bool(body.notify, current.notify),
    };
    // Normalised exactly as it is read back (trim, dedupe, caps, default ***).
    const filter = filterOf({ wish_settings: { filter: merged } });
    await event.update({ wish_settings: { ...storedOf(event), filter } });
    return { event_id: event.id, filter };
};

module.exports = {
    SETTINGS_DEFAULTS,
    applyFilter,
    filterOf,
    getFilter,
    updateFilter,
    menuHiddenFor,
    MAX_UPLOAD_BYTES,
    MEDIA_MIMES,
    settingsOf,
    getSettings,
    updateSettings,
    list,
    getOne,
    create,
    update,
    replaceMedia,
    remove,
    setLiked,
    setBlocked,
    purgeEvent,
};
