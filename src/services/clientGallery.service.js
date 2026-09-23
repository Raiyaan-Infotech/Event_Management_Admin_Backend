const {
    Sequelize, EventGalleryItem, EventGalleryCategory, Event, EventGuest, WebsiteClient,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');
const subscriptionPlanService = require('./subscriptionPlan.service');

/**
 * The event gallery — the first place the image, video and storage limits on a
 * plan mean anything (they were stored and displayed but enforced nowhere).
 *
 * Three different limits apply, and they are NOT the same shape:
 *   max_photos / max_videos — PER EVENT ("Images per event gallery")
 *   storage_limit           — PER ACCOUNT, every event's media summed
 *   per-file size           — a fixed product rule, not a plan field
 */

/** Product rule, deliberately not a plan column: nobody sells a bigger photo. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

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

    const event = await Event.findByPk(eventId, {
        attributes: ['id', 'name', 'subscription_plan_id', 'company_id', 'website_client_id'],
    });
    if (!event) throw ApiError.notFound('That event was not found.');

    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (isOwner) return { event, isOwner };

    const membership = await EventGuest.findOne({
        where: { event_id: event.id, participant_client_id: clientId },
        attributes: ['id'],
    });
    if (!membership) throw ApiError.notFound('That event is not on your account.');

    return { event, isOwner: false };
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
        sort_order: item.sort_order,
        created_at: item.created_at,
    };
};

/** Bytes this ACCOUNT is holding across every event, deleted items excluded. */
const storageUsedFor = async (clientId) => {
    const total = await EventGalleryItem.sum('size_bytes', {
        where: { website_client_id: clientId },
    });
    return Number(total || 0);
};

/**
 * What the gallery screen needs to draw itself before anything is chosen:
 * the counts, the limits and what is left.
 */
const getUsage = async (clientId, eventId) => {
    const { event } = await resolveEventForView(clientId, eventId);

    // The plan the EVENT was created under, matching how the guest limit is
    // read — an event keeps the limits it was built against.
    const planId = event.subscription_plan_id;
    const [maxPhotos, maxVideos] = await Promise.all([
        subscriptionPlanService.getPlanLimit(planId, 'max_photos'),
        subscriptionPlanService.getPlanLimit(planId, 'max_videos'),
    ]);

    // Storage and plan belong to the event's OWNER, not to whoever is looking:
    // a participant reading the gallery must see the host's quota, not their own.
    const ownerId = event.website_client_id ?? clientId;
    const [photos, videos, storageUsed, client] = await Promise.all([
        EventGalleryItem.count({ where: { event_id: event.id, type: 'image' } }),
        EventGalleryItem.count({ where: { event_id: event.id, type: 'video' } }),
        storageUsedFor(ownerId),
        WebsiteClient.findByPk(ownerId, { attributes: ['subscription_plan_id'] }),
    ]);

    const plan = client?.subscription_plan_id
        ? await subscriptionPlanService.getById(client.subscription_plan_id).catch(() => null)
        : null;
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
    if (query.type === 'image' || query.type === 'video') where.type = query.type;
    // `?category_id=0` means Uncategorised, which is a real filter — an absent
    // parameter means "everything" and must not be confused with it.
    if (query.category_id !== undefined && query.category_id !== '') {
        const catId = Number(query.category_id);
        where.category_id = catId > 0 ? catId : null;
    }

    const items = await EventGalleryItem.findAll({
        where,
        order: [['sort_order', 'ASC'], ['id', 'DESC']],
    });

    return {
        items: items.map(present),
        categories: await listCategories(clientId, event.id),
        usage: await getUsage(clientId, eventId),
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
const listCategories = async (clientId, eventId) => {
    const rows = await EventGalleryCategory.findAll({
        where: { event_id: eventId },
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });

    const counts = await EventGalleryItem.findAll({
        where: { event_id: eventId },
        attributes: ['category_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'n']],
        group: ['category_id'],
        raw: true,
    });
    const byId = new Map(counts.map((c) => [c.category_id, Number(c.n)]));

    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon,
        sort_order: r.sort_order,
        item_count: byId.get(r.id) || 0,
    }));
};

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
        icon: typeof body.icon === 'string' ? body.icon.slice(0, 100) : null,
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        company_id: event.company_id ?? null,
    });

    return { id: row.id, name: row.name, icon: row.icon, sort_order: row.sort_order, item_count: 0 };
};

/**
 * Delete a category. Its items are NOT deleted — the FK is ON DELETE SET NULL,
 * so they fall back to Uncategorised. Removing a label must never remove the
 * photos filed under it.
 */
const removeCategory = async (clientId, categoryId) => {
    const row = await EventGalleryCategory.findOne({
        where: { id: Number(categoryId) || 0, website_client_id: clientId },
    });
    if (!row) throw ApiError.notFound('That category was not found.');

    const eventId = row.event_id;
    await EventGalleryItem.update(
        { category_id: null }, { where: { category_id: row.id } }
    );
    await row.destroy({ force: true });

    return { removed: true, categories: await listCategories(clientId, eventId) };
};

/**
 * A category id proven to belong to THIS event, or null.
 *
 * A stray id is dropped rather than refused: it cannot leak another event's
 * photos into this gallery (the item's own event_id decides that), so the
 * worst case is an uncategorised photo, not a failed upload.
 */
const resolveCategoryId = async (eventId, raw) => {
    const id = Number(raw);
    if (!id) return null;
    const row = await EventGalleryCategory.findOne({
        where: { id, event_id: eventId }, attributes: ['id'],
    });
    return row ? row.id : null;
};

/**
 * Store one file, but only if all three limits allow it.
 *
 * Checked BEFORE the upload, so a refused file never reaches S3 — a rejected
 * upload that still consumed bandwidth and left an orphaned object is the
 * failure mode worth engineering around here.
 */
const uploadItem = async (clientId, eventId, file, body = {}) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose a file to upload.');

    const event = await resolveEvent(clientId, eventId);

    const isImage = IMAGE_MIMES.includes(file.mimetype);
    const isVideo = VIDEO_MIMES.includes(file.mimetype);
    if (!isImage && !isVideo) {
        throw ApiError.badRequest('Please choose a JPG, PNG, WEBP or GIF image, or an MP4, WebM or MOV video.');
    }

    const type = isImage ? 'image' : 'video';
    const size = Number(file.size || file.buffer.length || 0);

    const perFileCap = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (size > perFileCap) {
        throw ApiError.badRequest(
            `${isImage ? 'Images' : 'Videos'} must be ${mb(perFileCap)}MB or smaller. This file is ${mb(size)}MB.`
        );
    }

    const planId = event.subscription_plan_id;
    const countLimit = await subscriptionPlanService.getPlanLimit(
        planId, isImage ? 'max_photos' : 'max_videos'
    );
    if (countLimit !== null) {
        const used = await EventGalleryItem.count({ where: { event_id: event.id, type } });
        if (used >= countLimit) {
            throw ApiError.badRequest(
                `This event has reached its limit of ${countLimit} ${isImage ? 'image' : 'video'}${countLimit === 1 ? '' : 's'}. Please upgrade your plan to add more.`
            );
        }
    }

    // Storage is an ACCOUNT limit, so it is read from the client's CURRENT plan
    // rather than the event's — it is the account that holds the bytes.
    const client = await WebsiteClient.findByPk(clientId, { attributes: ['subscription_plan_id', 'company_id'] });
    const plan = client?.subscription_plan_id
        ? await subscriptionPlanService.getById(client.subscription_plan_id).catch(() => null)
        : null;
    const storageLimit = storageBytesFor(plan);
    if (storageLimit !== null) {
        const used = await storageUsedFor(clientId);
        if (used + size > storageLimit) {
            const left = Math.max(0, storageLimit - used);
            throw ApiError.badRequest(
                `Your plan includes ${mb(storageLimit)}MB of storage and ${mb(left)}MB is left. This file is ${mb(size)}MB.`
            );
        }
    }

    const stored = await mediaService.upload(
        file, { folder: `event-gallery/${event.id}` }, event.company_id || client?.company_id || 1
    );
    if (!stored || !stored.url) throw ApiError.badRequest('That file could not be stored.');

    const last = await EventGalleryItem.max('sort_order', { where: { event_id: event.id } });

    const item = await EventGalleryItem.create({
        event_id: event.id,
        website_client_id: clientId,
        type,
        url: stored.url,
        thumbnail_url: null,
        file_name: file.originalname || null,
        mime_type: file.mimetype,
        // The stored size, not the incoming one: images are compressed on the
        // way in, and charging for the pre-compression bytes would be wrong.
        size_bytes: Number(stored.size || size),
        category_id: await resolveCategoryId(event.id, body.category_id),
        caption: typeof body.caption === 'string' ? body.caption.slice(0, 300) : null,
        sort_order: Number.isFinite(Number(last)) ? Number(last) + 1 : 0,
        uploaded_by: clientId,
        company_id: event.company_id || client?.company_id || null,
    });

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
    await mediaService.deleteFile(item.url).catch(() => null);
    await item.destroy({ force: true });

    return { removed: true, usage: await getUsage(clientId, eventId) };
};

module.exports = {
    MAX_IMAGE_BYTES,
    MAX_VIDEO_BYTES,
    IMAGE_MIMES,
    VIDEO_MIMES,
    getUsage,
    listItems,
    listCategories,
    createCategory,
    removeCategory,
    uploadItem,
    removeItem,
};
