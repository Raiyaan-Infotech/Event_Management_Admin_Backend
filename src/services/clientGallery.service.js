const {
    Sequelize, EventGalleryItem, EventGalleryCategory, Event, EventParticipant, WebsiteClient, EventWish,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');
const { processVideo, videoPoster, videoInfo, addMusic } = require('../utils/videoProcess');
const subscriptionPlanService = require('./subscriptionPlan.service');
const notificationTrigger = require('./notificationTrigger.service');

/**
 * The event gallery — the first place the image, video and storage limits on a
 * plan mean anything (they were stored and displayed but enforced nowhere).
 *
 * Three different limits apply, and they are NOT the same shape:
 *   max_photos / max_videos — PER EVENT ("Images per event gallery"); since
 *                             2026-10-16 a Wed Wishes video also takes one
 *                             of max_videos ("Max Videos"), and (2026-10-19)
 *                             a Wed Wishes image one of max_photos
 *   storage_limit           — PER ACCOUNT, every event's media summed
 *   per-file size           — a fixed product rule, not a plan field
 */

/** Product rule, deliberately not a plan column: nobody sells a bigger photo. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;

/** Shorts (2026-10-23): a vertical clip of up to a minute and 10 MB. */
const MAX_SHORT_BYTES = 10 * 1024 * 1024;
const MAX_SHORT_SECONDS = 60;
/** A short's background music, before it is fitted to the clip. */
const MAX_MUSIC_BYTES = 10 * 1024 * 1024;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/** The order every gallery list is drawn in. */
const ITEM_ORDER = [['sort_order', 'ASC'], ['id', 'DESC']];

const cleanText = (raw, max) => {
    const text = typeof raw === 'string' ? raw.trim().slice(0, max) : '';
    return text || null;
};

/** A plan's storage ceiling in BYTES. NULL (unlimited) stays null. */
const storageBytesFor = (plan) => {
    if (!plan || plan.storage_limit === null || plan.storage_limit === undefined) return null;
    const unit = plan.storage_unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024;
    return Number(plan.storage_limit) * unit;
};

/**
 * The event, proven to belong to this client.
 *
 * Scoped `findOne` rather than `findByPk` — the same guard the guest and splash
 * services use, and the reason a gallery cannot be read or written by guessing
 * another client's event id.
 */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');

    const event = await Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        attributes: ['id', 'name', 'subscription_plan_id', 'company_id'],
    });
    if (!event) throw ApiError.notFound('That event is not on your account.');
    return event;
};

/**
 * The event as a VIEWER may see it: the host, or a participant of it.
 *
 * Writing is host-only (`resolveEvent`), reading is not — a participant opens
 * the gallery to look at the photos, which is the entire point of it. The
 * membership test is the same `participant_client_id` lookup `clientEvent`
 * uses to decide `is_owner`, so the two cannot disagree about who is in.
 */
const resolveEventForView = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');

    // The event and the membership probe do not depend on each other — read
    // together, so a guest's gallery costs one round trip here, not two.
    const [event, membership] = await Promise.all([
        Event.findByPk(eventId, {
            attributes: ['id', 'name', 'subscription_plan_id', 'company_id', 'website_client_id'],
        }),
        EventParticipant.findOne({
            where: { event_id: eventId, participant_client_id: clientId },
            attributes: ['id'],
        }),
    ]);
    if (!event) throw ApiError.notFound('That event was not found.');

    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (isOwner) return { event, isOwner };

    if (!membership) throw ApiError.notFound('That event is not on your account.');

    return { event, isOwner: false };
};

/** The name of the built-in category every event always has. */
const DEFAULT_CATEGORY_NAME = 'Gallery';

/**
 * The event's built-in "Gallery" category, created the first time it is needed.
 *
 * Every photo lives in a category: an upload that names none lands here, and
 * a deleted category's photos fall back here. Lazy rather than created with
 * the event so events that already exist need no special path, and so no event
 * creation code can forget it. The unique (event_id, is_default) key makes a
 * concurrent first call safe — the loser re-reads the winner's row.
 */
const ensureDefaultCategory = async (eventId) => {
    const find = () => EventGalleryCategory.findOne({
        where: { event_id: eventId, is_default: true },
    });
    let row = await find();
    if (row) return row;

    const event = await Event.findByPk(eventId, {
        attributes: ['id', 'website_client_id', 'company_id'],
    });
    if (!event) throw ApiError.notFound('That event was not found.');

    // A host-made category already called "Gallery" becomes the default
    // rather than leaving two with the same name.
    const named = await EventGalleryCategory.findOne({
        where: { event_id: eventId, name: DEFAULT_CATEGORY_NAME },
    });
    if (named) {
        named.is_default = true;
        await named.save();
        row = named;
    } else {
        try {
            row = await EventGalleryCategory.create({
                event_id: eventId,
                website_client_id: event.website_client_id,
                name: DEFAULT_CATEGORY_NAME,
                sort_order: 0,
                is_default: true,
                company_id: event.company_id ?? null,
            });
        } catch (e) {
            row = await find();
            if (!row) throw e;
        }
    }

    // Anything filed under no category before this existed belongs here.
    await EventGalleryItem.update(
        { category_id: row.id }, { where: { event_id: eventId, category_id: null } }
    );
    return row;
};

const present = (row) => {
    const item = row.toJSON ? row.toJSON() : row;
    return {
        id: item.id,
        event_id: item.event_id,
        type: item.type,
        url: item.url,
        thumbnail_url: item.thumbnail_url || (item.type === 'image' ? item.url : null),
        file_name: item.file_name,
        mime_type: item.mime_type,
        size_bytes: Number(item.size_bytes || 0),
        category_id: item.category_id ?? null,
        caption: item.caption,
        show_in_app: item.show_in_app !== false && item.show_in_app !== 0,
        is_short: item.is_short === true || item.is_short === 1,
        title: item.title || null,
        description: item.description || null,
        duration_seconds: item.duration_seconds ?? null,
        sort_order: item.sort_order,
        created_at: item.created_at,
    };
};

/**
 * Items of events that still exist. Events are soft-deleted, so without this
 * a deleted event's photos went on filling the account's storage forever.
 */
const LIVE_EVENT = Sequelize.literal('`event_id` IN (SELECT `id` FROM `events` WHERE `deleted_at` IS NULL)');

/**
 * Bytes this ACCOUNT is holding across its live events, deleted items excluded:
 * gallery files AND Wed Wishes media ("Max Storage", 2026-10-16).
 */
const storageUsedFor = async (clientId) => {
    const where = { website_client_id: clientId, [Op.and]: [LIVE_EVENT] };
    const [galleryBytes, wishBytes] = await Promise.all([
        EventGalleryItem.sum('size_bytes', { where }),
        EventWish.sum('size_bytes', { where }),
    ]);
    return Number(galleryBytes || 0) + Number(wishBytes || 0);
};

/** Photos on one event, gallery + Wed Wishes — what "Max Photos" counts. */
const photosUsedFor = async (eventId) => {
    const [galleryPhotos, wishPhotos] = await Promise.all([
        EventGalleryItem.count({ where: { event_id: eventId, type: 'image' } }),
        EventWish.count({ where: { event_id: eventId, post_type: 'image' } }),
    ]);
    return galleryPhotos + wishPhotos;
};

/** Videos on one event, gallery + Wed Wishes — what "Max Videos" counts. */
const videosUsedFor = async (eventId) => {
    const [galleryVideos, wishVideos] = await Promise.all([
        EventGalleryItem.count({ where: { event_id: eventId, type: 'video' } }),
        EventWish.count({ where: { event_id: eventId, post_type: 'video' } }),
    ]);
    return galleryVideos + wishVideos;
};

/**
 * Remove a stored file by its URL — never throws, a missing file is not an
 * error. See mediaService.deleteByUrl for why the URL (not a path) is used.
 */
const dropFile = (url, companyId) => (url
    ? mediaService.deleteByUrl(url, companyId || 1).catch(() => false)
    : Promise.resolve(false));

/** Run [fn] over [list] a few at a time — prod is slow per call, never one by one. */
const inBatches = async (list, size, fn) => {
    for (let i = 0; i < list.length; i += size) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(list.slice(i, i + size).map(fn));
    }
};

/**
 * An event was deleted: remove its gallery — every photo / video file, video
 * poster and category cover in storage, then the rows. Called by
 * clientEvent.deleteEvent; a deleted event's media must not stay public or
 * keep counting against the account's storage.
 */
const purgeEvent = async (eventId) => {
    const [items, categories] = await Promise.all([
        EventGalleryItem.findAll({ where: { event_id: eventId }, attributes: ['url', 'thumbnail_url', 'type', 'company_id'] }),
        EventGalleryCategory.findAll({ where: { event_id: eventId }, attributes: ['cover_image', 'company_id'] }),
    ]);
    const files = [
        ...items.flatMap((i) => [
            [i.url, i.company_id],
            ...(i.thumbnail_url && i.thumbnail_url !== i.url ? [[i.thumbnail_url, i.company_id]] : []),
        ]),
        ...categories.filter((c) => c.cover_image).map((c) => [c.cover_image, c.company_id]),
    ];
    await inBatches(files, 5, ([url, companyId]) => dropFile(url, companyId));
    await EventGalleryItem.destroy({ where: { event_id: eventId }, force: true });
    await EventGalleryCategory.destroy({ where: { event_id: eventId }, force: true });
    return { files: files.length };
};

/**
 * What the gallery screen needs to draw itself before anything is chosen:
 * the counts, the limits and what is left.
 */
/**
 * Every read here is independent, so they go out together: production pays
 * ~370ms per round trip and this used to take five in a row. Pass `resolved`
 * when the caller has already checked the viewer, to skip checking it again.
 */
const getUsage = async (clientId, eventId, resolved = null) => {
    const { event } = resolved || await resolveEventForView(clientId, eventId);

    // Storage and plan belong to the event's OWNER, not to whoever is looking:
    // a participant reading the gallery must see the host's quota, not their own.
    const ownerId = event.website_client_id ?? clientId;
    const [limits, photos, videos, storageUsed, plan] = await Promise.all([
        // The plan the EVENT was created under, matching how the guest limit is
        // read — an event keeps the limits it was built against.
        subscriptionPlanService.getPlanLimits(event.subscription_plan_id, ['max_photos', 'max_videos']),
        photosUsedFor(event.id),
        videosUsedFor(event.id),
        storageUsedFor(ownerId),
        subscriptionPlanService.getClientStoragePlan(ownerId).catch(() => null),
    ]);
    const maxPhotos = limits.max_photos;
    const maxVideos = limits.max_videos;
    const storageLimit = storageBytesFor(plan);

    return {
        photos: { used: photos, limit: maxPhotos },
        videos: { used: videos, limit: maxVideos },
        storage: {
            used_bytes: storageUsed,
            limit_bytes: storageLimit,
            used_mb: mb(storageUsed),
            limit_mb: storageLimit === null ? null : mb(storageLimit),
        },
        max_image_bytes: MAX_IMAGE_BYTES,
        max_video_bytes: MAX_VIDEO_BYTES,
    };
};

const listItems = async (clientId, eventId, query = {}) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);

    const where = { event_id: event.id };
    const defaultCategory = await ensureDefaultCategory(event.id);
    if (query.type === 'image' || query.type === 'video') where.type = query.type;
    // `?category_id=0` is the default Gallery — an absent parameter means
    // "everything" and must not be confused with it.
    if (query.category_id !== undefined && query.category_id !== '') {
        const catId = Number(query.category_id);
        where.category_id = catId > 0 ? catId : defaultCategory.id;
    }
    // "Show in Event App" off = the host still manages it, a guest never
    // receives it.
    if (!isOwner) where.show_in_app = true;

    // Independent once the viewer is checked and the default category exists —
    // one round trip for all three instead of one after another.
    const [items, categories, usage] = await Promise.all([
        EventGalleryItem.findAll({ where, order: ITEM_ORDER }),
        listCategories(clientId, event.id, { visibleOnly: !isOwner, defaultReady: true }),
        getUsage(clientId, eventId, { event, isOwner }),
    ]);

    return {
        items: items.map(present),
        categories,
        usage,
        /** Participants view only — the app hides its Upload button on this. */
        can_upload: isOwner,
    };
};

/**
 * The event's categories, each with how many items it holds.
 *
 * The count is what makes a chip worth showing ("Ceremony 12"), and it is
 * computed here rather than trusted to a stored counter that drifts the first
 * time an item is deleted by any other path.
 */
const listCategories = async (clientId, eventId, { visibleOnly = false, defaultReady = false } = {}) => {
    // `defaultReady`: the caller has just run ensureDefaultCategory itself.
    if (!defaultReady) await ensureDefaultCategory(eventId);

    // A guest's counts and covers leave out what the host has hidden, so a
    // chip never promises a photo the grid will not show.
    const visible = visibleOnly ? { show_in_app: true } : {};

    const [rows, counts, photos] = await Promise.all([
        // The default Gallery always leads the list.
        EventGalleryCategory.findAll({
            where: { event_id: eventId },
            order: [
                [Sequelize.literal('is_default IS NULL'), 'ASC'],
                ['sort_order', 'ASC'], ['id', 'ASC'],
            ],
        }),
        EventGalleryItem.findAll({
            where: { event_id: eventId, ...visible },
            attributes: ['category_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'n']],
            group: ['category_id'],
            raw: true,
        }),
        // A category with no cover of its own shows its first photo — the same
        // order the grid draws, so the thumbnail is the photo the host sees first.
        EventGalleryItem.findAll({
            where: { event_id: eventId, type: 'image', category_id: { [Op.ne]: null }, ...visible },
            attributes: ['category_id', 'url', 'thumbnail_url'],
            order: ITEM_ORDER,
            raw: true,
        }),
    ]);
    const byId = new Map(counts.map((c) => [c.category_id, Number(c.n)]));
    const firstPhoto = new Map();
    for (const p of photos) {
        // The small copy when there is one — a cover is a thumbnail.
        if (!firstPhoto.has(p.category_id)) firstPhoto.set(p.category_id, p.thumbnail_url || p.url);
    }

    return rows.map((r) => presentCategory(r, byId.get(r.id) || 0, firstPhoto.get(r.id)));
};

/**
 * The categories for the standalone endpoint, as the VIEWER may see them — the
 * host, or a participant of the event; anyone else is refused.
 */
const listCategoriesForViewer = async (clientId, eventId) => {
    const { event, isOwner } = await resolveEventForView(clientId, eventId);
    return listCategories(clientId, event.id, { visibleOnly: !isOwner });
};

const presentCategory = (r, itemCount = 0, firstPhotoUrl = null) => ({
    id: r.id,
    name: r.name,
    description: r.description || null,
    /** What the host chose. NULL when they chose nothing. */
    cover_image: r.cover_image || null,
    /** What a list should draw: the chosen cover, else the first photo. */
    cover_url: r.cover_image || firstPhotoUrl || null,
    icon: r.icon,
    sort_order: r.sort_order,
    /** The built-in Gallery: cannot be renamed or deleted. */
    is_default: r.is_default === true || r.is_default === 1,
    item_count: itemCount,
});

/**
 * Put one category at a 1-based position and renumber the event's categories
 * 0..n-1 — the form's "Display Order" is a position in the list, not a raw
 * sort_order, so two categories can never end up sharing one.
 */
const placeCategory = async (eventId, categoryId, rawPosition) => {
    const rows = await EventGalleryCategory.findAll({
        where: { event_id: eventId },
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
        attributes: ['id'],
    });
    const ids = rows.map((r) => r.id).filter((id) => id !== categoryId);
    const position = Number(rawPosition);
    const index = Number.isFinite(position) && position >= 1
        ? Math.min(Math.floor(position) - 1, ids.length)
        : ids.length;
    ids.splice(index, 0, categoryId);

    // One UPDATE with CASE — prod is ~370ms a query, so never row by row.
    const cases = ids.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ');
    await EventGalleryCategory.sequelize.query(
        `UPDATE event_gallery_categories SET sort_order = CASE id ${cases} END WHERE event_id = ? AND id IN (${ids.map(Number).join(',')})`,
        { replacements: [eventId] }
    );
};

const hasPosition = (body) =>
    body.position !== undefined && body.position !== null && body.position !== '';

const createCategory = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);

    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) throw ApiError.badRequest('Please enter a category name.');

    const clash = await EventGalleryCategory.findOne({
        where: { event_id: event.id, name },
        attributes: ['id'],
    });
    if (clash) throw ApiError.conflict(`"${name}" is already a category on this event.`);

    const last = await EventGalleryCategory.max('sort_order', { where: { event_id: event.id } });

    const row = await EventGalleryCategory.create({
        event_id: event.id,
        website_client_id: clientId,
        name,
        description: cleanText(body.description, 200),
        cover_image: cleanText(body.cover_image, 500),
        icon: typeof body.icon === 'string' ? body.icon.slice(0, 100) : null,
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        company_id: event.company_id ?? null,
    });

    // No position sent = last, which is where it already is.
    if (hasPosition(body)) {
        await placeCategory(event.id, row.id, body.position);
        await row.reload();
    }

    return presentCategory(row);
};

/**
 * Edit a category. Only the fields that were SENT change — the form sends all
 * four, but a caller that sends just a name must not blank the description.
 */
const updateCategory = async (clientId, categoryId, body = {}) => {
    const row = await EventGalleryCategory.findOne({
        where: { id: Number(categoryId) || 0, website_client_id: clientId },
    });
    if (!row) throw ApiError.notFound('That category was not found.');

    const isDefault = row.is_default === true || row.is_default === 1;
    if (isDefault && body.name !== undefined
        && String(body.name).trim() !== row.name) {
        throw ApiError.badRequest('The Gallery category cannot be renamed.');
    }
    if (body.name !== undefined && !isDefault) {
        const name = String(body.name || '').trim().slice(0, 120);
        if (!name) throw ApiError.badRequest('Please enter a category name.');

        const clash = await EventGalleryCategory.findOne({
            where: { event_id: row.event_id, name, id: { [Op.ne]: row.id } },
            attributes: ['id'],
        });
        if (clash) throw ApiError.conflict(`"${name}" is already a category on this event.`);
        row.name = name;
    }
    if (body.description !== undefined) row.description = cleanText(body.description, 200);
    // A replaced or removed cover's old file is deleted once the row is saved.
    let oldCover = null;
    if (body.cover_image !== undefined) {
        const next = cleanText(body.cover_image, 500);
        if (row.cover_image && row.cover_image !== next) oldCover = row.cover_image;
        row.cover_image = next;
    }
    await row.save();
    if (oldCover) await dropFile(oldCover, row.company_id);

    // The default always leads, so it has no position to change.
    if (hasPosition(body) && !isDefault) {
        await placeCategory(row.event_id, row.id, body.position);
    }

    const categories = await listCategories(clientId, row.event_id);
    return { category: categories.find((c) => c.id === row.id), categories };
};

/**
 * Store a category's cover image and hand back its URL — the form saves the
 * URL with the category, as the agenda form does with its images. Not a
 * gallery item: it is not counted against the event's photo limit.
 */
const uploadCategoryCover = async (clientId, eventId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose an image to upload.');
    const event = await resolveEvent(clientId, eventId);

    if (!IMAGE_MIMES.includes(file.mimetype)) {
        throw ApiError.badRequest('Please choose a JPG, PNG, WEBP or GIF image.');
    }
    const size = Number(file.size || file.buffer.length || 0);
    if (size > MAX_IMAGE_BYTES) {
        throw ApiError.badRequest(
            `Images must be ${mb(MAX_IMAGE_BYTES)}MB or smaller. This file is ${mb(size)}MB.`
        );
    }

    const client = await WebsiteClient.findByPk(clientId, { attributes: ['company_id'] });
    const stored = await mediaService.upload(
        file, { folder: `event-gallery/${event.id}/covers` }, event.company_id || client?.company_id || 1
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That image could not be stored.');
    return { url: stored.url };
};

/**
 * Delete a category. Its items are NOT deleted — they move to the default
 * Gallery. Removing a label must never remove the photos filed under it. The
 * default Gallery itself cannot be deleted.
 */
const removeCategory = async (clientId, categoryId) => {
    const row = await EventGalleryCategory.findOne({
        where: { id: Number(categoryId) || 0, website_client_id: clientId },
    });
    if (!row) throw ApiError.notFound('That category was not found.');

    if (row.is_default === true || row.is_default === 1) {
        throw ApiError.badRequest('The Gallery category cannot be deleted.');
    }

    const eventId = row.event_id;
    // Its photos fall back to the default Gallery, never to nowhere.
    const fallback = await ensureDefaultCategory(eventId);
    await EventGalleryItem.update(
        { category_id: fallback.id }, { where: { category_id: row.id } }
    );
    const cover = row.cover_image;
    await row.destroy({ force: true });
    // Its photos moved; its own cover image belongs to nothing now.
    if (cover) await dropFile(cover, row.company_id);

    return { removed: true, categories: await listCategories(clientId, eventId) };
};

/**
 * A category id proven to belong to THIS event, or null.
 *
 * A stray id is dropped rather than refused: it cannot leak another event's
 * photos into this gallery (the item's own event_id decides that), so the
 * worst case is a photo in the default Gallery, not a failed upload.
 */
const resolveCategoryId = async (eventId, raw) => {
    const id = Number(raw);
    if (!id) return null;
    const row = await EventGalleryCategory.findOne({
        where: { id, event_id: eventId }, attributes: ['id'],
    });
    return row ? row.id : null;
};

/** As [resolveCategoryId], but nothing chosen = the default Gallery. */
const categoryIdOrDefault = async (eventId, raw) =>
    (await resolveCategoryId(eventId, raw)) || (await ensureDefaultCategory(eventId)).id;

/**
 * Store one file, but only if all three limits allow it.
 *
 * Checked BEFORE the upload, so a refused file never reaches S3 — a rejected
 * upload that still consumed bandwidth and left an orphaned object is the
 * failure mode worth engineering around here.
 */
let sharp = null;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

/** Grid tiles are ~120 px wide at 3x density: 480 px on the SHORT side is plenty. */
const THUMB_SIDE = 480;

/**
 * A photo's grid thumbnail (Google Photos style): the short side scaled to
 * [THUMB_SIDE], JPEG 72, EXIF orientation applied — tens of KB where the
 * full photo is up to 2 MB. Grids, category covers and lists load this; the
 * viewer still opens the full photo. Returns a Buffer or null (never throws).
 */
const imageThumb = async (buffer) => {
    if (!sharp || !buffer) return null;
    try {
        return await sharp(buffer, { animated: false })
            .rotate()
            .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'outside', withoutEnlargement: true })
            .jpeg({ quality: 72, mozjpeg: true })
            .toBuffer();
    } catch (_) {
        return null;
    }
};

/** Store a photo's thumbnail as `<name>-thumb.jpg` beside it; URL or null. */
const storeImageThumb = async (imageFile, eventId, companyId) => {
    try {
        const jpeg = await imageThumb(imageFile.buffer);
        if (!jpeg) return null;
        const base = (imageFile.originalname || 'photo').replace(/\.[^.]+$/, '');
        const stored = await mediaService.upload(
            { buffer: jpeg, size: jpeg.length, mimetype: 'image/jpeg', originalname: `${base}-thumb.jpg` },
            { folder: `event-gallery/${eventId}` },
            companyId
        );
        return stored?.url || null;
    } catch (_) {
        return null;
    }
};

/**
 * Grab a video's first frame and store it as `<video name>-poster.jpg` in the
 * same folder. Returns the URL, or null (no ffmpeg, unreadable video, S3 down).
 * The poster's bytes are not charged to storage — it is a few KB of preview.
 */
const storeVideoPoster = async (videoFile, eventId, companyId) => {
    try {
        const jpeg = await videoPoster(videoFile.buffer);
        if (!jpeg) return null;
        const base = (videoFile.originalname || 'video').replace(/\.[^.]+$/, '');
        const stored = await mediaService.upload(
            { buffer: jpeg, size: jpeg.length, mimetype: 'image/jpeg', originalname: `${base}-poster.jpg` },
            { folder: `event-gallery/${eventId}` },
            companyId
        );
        return stored?.url || null;
    } catch (_) {
        return null;
    }
};

/**
 * [short] = `{ music, cover }` (either may be null) for a Short from the app's
 * Upload Shorts; null for an ordinary photo / video. A short is a video with
 * its own caps (10 MB, 1 minute), a required title, an optional description,
 * an optional cover (the host's picture instead of the first frame) and
 * optional background music that REPLACES the clip's own sound.
 *
 * `short.asVideo` (2026-10-23): an ORDINARY video sent through the same
 * pages (Upload Video) — music, cover, title and description as a short, but
 * the video's own limits (5 MB, any shape), title optional, not marked
 * `is_short`.
 */
const uploadItem = async (clientId, eventId, file, body = {}, short = null) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose a file to upload.');

    const event = await resolveEvent(clientId, eventId);

    const isImage = IMAGE_MIMES.includes(file.mimetype);
    const isVideo = VIDEO_MIMES.includes(file.mimetype);
    if (!isImage && !isVideo) {
        throw ApiError.badRequest('Please choose a JPG, PNG, WEBP or GIF image, or an MP4, WebM or MOV video.');
    }
    if (short && !isVideo) throw ApiError.badRequest('Please choose an MP4, WebM or MOV video.');
    // A real Short (its own caps and rules), not a video sent with details.
    const isShortItem = Boolean(short) && !short.asVideo;

    const type = isImage ? 'image' : 'video';
    const size = Number(file.size || file.buffer.length || 0);

    const perFileCap = isImage ? MAX_IMAGE_BYTES : isShortItem ? MAX_SHORT_BYTES : MAX_VIDEO_BYTES;
    if (size > perFileCap) {
        throw ApiError.badRequest(
            `${isImage ? 'Images' : isShortItem ? 'Shorts' : 'Videos'} must be ${mb(perFileCap)}MB or smaller. This file is ${mb(size)}MB.`
        );
    }

    // The details' own checks, before anything is counted or stored.
    let shortTitle = null;
    let shortDescription = null;
    let shortSeconds = null;
    if (short) {
        shortTitle = cleanText(body.title, 150);
        if (isShortItem && !shortTitle) throw ApiError.badRequest('Please enter a title for the short.');
        shortDescription = cleanText(body.description, 500);
        if (short.cover && !IMAGE_MIMES.includes(short.cover.mimetype)) {
            throw ApiError.badRequest('The cover must be a JPG, PNG or WEBP image.');
        }
        if (short.music && Number(short.music.size || short.music.buffer?.length || 0) > MAX_MUSIC_BYTES) {
            throw ApiError.badRequest(`The music must be ${mb(MAX_MUSIC_BYTES)}MB or smaller.`);
        }
        // Unreadable length / shape (no ffmpeg) is let through: the app trims
        // to a minute and refuses landscape before it sends.
        const { duration: seconds, portrait } = await videoInfo(file.buffer);
        if (isShortItem && portrait === false) {
            throw ApiError.badRequest('Shorts must be a vertical (portrait) video.');
        }
        if (isShortItem && seconds !== null && seconds > MAX_SHORT_SECONDS + 1) {
            throw ApiError.badRequest(`Shorts can be up to 1 minute long. This video is ${Math.round(seconds)} seconds.`);
        }
        shortSeconds = seconds === null ? null : Math.round(seconds);
    }

    // Every limit and count is read in ONE round trip (they were six in a row,
    // ~2s on production before the file even started uploading). The counts
    // are read even when a limit turns out to be off — a cheap COUNT is far
    // cheaper than waiting for the limit first.
    //
    // Storage is an ACCOUNT limit, so it is read from the client's CURRENT plan
    // rather than the event's — it is the account that holds the bytes.
    const planId = event.subscription_plan_id;
    const [countLimit, usedCount, client, plan, usedStorage] = await Promise.all([
        subscriptionPlanService.getPlanLimit(planId, isImage ? 'max_photos' : 'max_videos'),
        isImage ? photosUsedFor(event.id) : videosUsedFor(event.id),
        WebsiteClient.findByPk(clientId, { attributes: ['subscription_plan_id', 'company_id'] }),
        subscriptionPlanService.getClientStoragePlan(clientId).catch(() => null),
        storageUsedFor(clientId),
    ]);

    let countBefore = null;
    if (countLimit !== null) {
        countBefore = usedCount;
        if (usedCount >= countLimit) {
            throw ApiError.badRequest(
                `This event has reached its limit of ${countLimit} ${isImage ? 'image' : 'video'}${countLimit === 1 ? '' : 's'}. Please upgrade your plan to add more.`
            );
        }
    }

    const storageLimit = storageBytesFor(plan);
    let storageBefore = null;
    if (storageLimit !== null) {
        const used = usedStorage;
        storageBefore = used;
        if (used + size > storageLimit) {
            const left = Math.max(0, storageLimit - used);
            throw ApiError.badRequest(
                `Your plan includes ${mb(storageLimit)}MB of storage and ${mb(left)}MB is left. This file is ${mb(size)}MB.`
            );
        }
    }

    // Videos: drop the sound when the host turned it off on the Trim screen
    // (`mute`, WhatsApp's speaker icon), and make a picture phones cannot play
    // into plain H.264. Sound is otherwise kept exactly as recorded. The result
    // is used only when it still fits the per-file cap.
    let toStore = file;
    if (isVideo && short?.music) {
        // The song replaces the clip's sound, fitted to its length.
        let out;
        try {
            // The music trim: where in the song the short's music starts.
            const musicStart = Math.min(3600, Math.max(0, Number.parseInt(body.music_start, 10) || 0));
            out = await addMusic(file.buffer, file.mimetype, short.music.buffer, { start: musicStart });
        } catch (e) {
            throw ApiError.badRequest(`The music could not be added to this ${isShortItem ? 'short' : 'video'}. Please try another song.`);
        }
        if (out.buffer.length > perFileCap) {
            throw ApiError.badRequest(`${isShortItem ? 'Shorts' : 'Videos'} must be ${mb(perFileCap)}MB or smaller once the music is added.`);
        }
        toStore = {
            ...file,
            buffer: out.buffer,
            size: out.buffer.length,
            mimetype: out.mimetype,
            originalname: `${(file.originalname || 'short').replace(/\.[^.]+$/, '')}.mp4`,
        };
    } else if (isVideo) {
        const mute = [true, 'true', 1, '1'].includes(body.mute);
        const out = await processVideo(file.buffer, file.mimetype, { mute });
        // Muting is the host's choice, not a nicety: never store with sound
        // what they asked to be silent.
        if (mute && !out.muted) {
            throw ApiError.badRequest('The sound could not be removed from this video. Please try again.');
        }
        if (out.applied && out.buffer.length <= perFileCap) {
            const ext = out.mimetype === 'video/webm' ? '.webm' : '.mp4';
            toStore = {
                ...file,
                buffer: out.buffer,
                size: out.buffer.length,
                mimetype: out.mimetype,
                originalname: file.originalname
                    ? file.originalname.replace(/\.[^.]+$/, '') + ext
                    : file.originalname,
            };
        } else if (mute && out.applied) {
            // Muted but somehow over the cap — refuse rather than keep the sound.
            throw ApiError.badRequest(`${isShortItem ? 'Shorts' : 'Videos'} must be ${mb(perFileCap)}MB or smaller.`);
        }
    }

    const stored = await mediaService.upload(
        toStore, { folder: `event-gallery/${event.id}` }, event.company_id || client?.company_id || 1
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That file could not be stored.');

    // Grid picture, stored next to the file. Video = its first frame; photo =
    // a ~480 px copy (the full photo is up to 2 MB). Best effort: none means a
    // video shows its icon and a photo's tile falls back to the full file.
    const companyForFiles = event.company_id || client?.company_id || 1;
    // A short's cover, when the host chose one, is its picture instead.
    const thumbnailUrl = short?.cover
        ? await storeImageThumb(short.cover, event.id, companyForFiles)
            || await storeVideoPoster(toStore, event.id, companyForFiles)
        : isVideo
            ? await storeVideoPoster(toStore, event.id, companyForFiles)
            : await storeImageThumb(toStore, event.id, companyForFiles);

    const last = await EventGalleryItem.max('sort_order', { where: { event_id: event.id } });

    const item = await EventGalleryItem.create({
        event_id: event.id,
        website_client_id: clientId,
        type,
        url: stored.url,
        thumbnail_url: thumbnailUrl,
        file_name: toStore.originalname || null,
        mime_type: toStore.mimetype,
        // The stored size, not the incoming one: images are compressed on the
        // way in, and charging for the pre-compression bytes would be wrong.
        size_bytes: Number(stored.size || size),
        category_id: await categoryIdOrDefault(event.id, body.category_id),
        caption: typeof body.caption === 'string' ? body.caption.slice(0, 300) : null,
        is_short: isShortItem,
        title: shortTitle,
        description: shortDescription,
        duration_seconds: shortSeconds,
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        uploaded_by: clientId,
        company_id: event.company_id || client?.company_id || null,
    });

    // Two uploads at the same moment can both pass the count check above
    // (the S3 upload sits between check and save). Re-count the items saved up
    // to and including this one: only the LATER of two racers (higher id) is
    // over and undoes itself — row and files — so the earlier one keeps the
    // last place instead of both being thrown away.
    if (countLimit !== null) {
        const upToMe = await EventGalleryItem.count({
            where: { event_id: event.id, type, id: { [Op.lte]: item.id } },
        }) + (isImage ? 0 : await EventWish.count({ where: { event_id: event.id, post_type: 'video' } }));
        if (upToMe > countLimit) {
            await item.destroy({ force: true });
            await dropFile(stored.url, item.company_id);
            if (thumbnailUrl) await dropFile(thumbnailUrl, item.company_id);
            throw ApiError.badRequest(
                `This event has reached its limit of ${countLimit} ${isImage ? 'image' : 'video'}${countLimit === 1 ? '' : 's'}. Please upgrade your plan to add more.`
            );
        }
    }

    // Tell the organizer when this upload takes photos / videos / storage past 50% / 100%.
    if (countLimit !== null && countBefore !== null) {
        notificationTrigger.checkUsageCrossing(
            event.website_client_id ?? clientId, isImage ? 'photos' : 'videos', countBefore, 1, countLimit,
            { eventName: event.name },
        );
    }
    if (storageLimit !== null && storageBefore !== null) {
        notificationTrigger.checkStorageCrossing(clientId, storageBefore, Number(stored.size || size), storageLimit);
    }

    return { item: present(item), usage: await getUsage(clientId, eventId) };
};

/**
 * Remove an item — the row AND the file, together.
 *
 * A HARD delete on purpose. A soft-deleted row whose S3 object is already gone
 * is a row that can be "restored" into a broken image, and the bytes are freed
 * either way, so there is nothing for the row to still represent. The file is
 * deleted first: an orphaned object nobody can reach is a worse outcome than a
 * row briefly outliving its file.
 *
 * Host only — `website_client_id` is the owner, so a participant cannot delete
 * somebody else's photos.
 */
const removeItem = async (clientId, itemId) => {
    const item = await EventGalleryItem.findOne({
        where: { id: Number(itemId) || 0, website_client_id: clientId },
    });
    if (!item) throw ApiError.notFound('That gallery item was not found.');

    const eventId = item.event_id;
    await dropFile(item.url, item.company_id);
    // Its own thumbnail / poster (older photo rows have none, or the same URL).
    if (item.thumbnail_url && item.thumbnail_url !== item.url) {
        await dropFile(item.thumbnail_url, item.company_id);
    }
    await item.destroy({ force: true });

    return { removed: true, usage: await getUsage(clientId, eventId) };
};

/**
 * Edit one item: its caption, whether guests see it, and / or its category.
 * Host only — `website_client_id` is the owner.
 */
const updateItem = async (clientId, itemId, body = {}) => {
    const item = await EventGalleryItem.findOne({
        where: { id: Number(itemId) || 0, website_client_id: clientId },
    });
    if (!item) throw ApiError.notFound('That gallery item was not found.');

    if (body.caption !== undefined) item.caption = cleanText(body.caption, 300);
    if (body.show_in_app !== undefined) {
        item.show_in_app = [true, 'true', 1, '1'].includes(body.show_in_app);
    }
    if (body.category_id !== undefined) {
        const wanted = Number(body.category_id);
        if (wanted > 0) {
            // Unlike an upload, a move names its target on purpose — a category
            // that is not on this event is refused, not silently dropped.
            const categoryId = await resolveCategoryId(item.event_id, wanted);
            if (!categoryId) throw ApiError.notFound('That category was not found.');
            item.category_id = categoryId;
        } else {
            item.category_id = (await ensureDefaultCategory(item.event_id)).id;
        }
    }
    await item.save();

    return { item: present(item), categories: await listCategories(clientId, item.event_id) };
};

/**
 * Save a new order for the items that were sent.
 *
 * The app reorders ONE category at a time, so the ids are usually a subset of
 * the event's items. They take back the same slots they already held in the
 * full list — the other categories' photos do not move in the All view.
 */
const reorderItems = async (clientId, eventId, body = {}) => {
    const event = await resolveEvent(clientId, eventId);
    if (!Array.isArray(body.ids)) throw ApiError.badRequest('Invalid gallery order.');

    const rows = await EventGalleryItem.findAll({
        where: { event_id: event.id }, order: ITEM_ORDER, attributes: ['id'],
    });
    const all = rows.map((r) => r.id);
    const known = new Set(all);
    const sent = [...new Set(body.ids.map(Number))].filter((id) => known.has(id));
    const moving = new Set(sent);

    let next = 0;
    const order = all.map((id) => (moving.has(id) ? sent[next++] : id));

    // One UPDATE with CASE — prod is ~370ms a query, so never row by row.
    if (order.length) {
        const cases = order.map((id, i) => `WHEN ${Number(id)} THEN ${i}`).join(' ');
        await EventGalleryItem.sequelize.query(
            `UPDATE event_gallery_items SET sort_order = CASE id ${cases} END WHERE event_id = ? AND id IN (${order.map(Number).join(',')})`,
            { replacements: [event.id] }
        );
    }
    return { reordered: true };
};

module.exports = {
    MAX_IMAGE_BYTES,
    MAX_VIDEO_BYTES,
    MAX_SHORT_BYTES,
    MAX_MUSIC_BYTES,
    IMAGE_MIMES,
    VIDEO_MIMES,
    getUsage,
    storageUsedFor,
    storageBytesFor,
    photosUsedFor,
    videosUsedFor,
    listItems,
    listCategories,
    listCategoriesForViewer,
    createCategory,
    updateCategory,
    uploadCategoryCover,
    removeCategory,
    uploadItem,
    /** Upload Shorts: multer `fields` → the clip, its music and its cover. */
    // `kind: 'video'` = Upload Video through the same pages (video limits).
    uploadShort: (clientId, eventId, files = {}, body = {}) => uploadItem(
        clientId, eventId, files.file?.[0], body,
        {
            music: files.music?.[0] || null,
            cover: files.cover?.[0] || null,
            asVideo: body.kind === 'video',
        },
    ),
    updateItem,
    reorderItems,
    removeItem,
    purgeEvent,
    imageThumb,
};
