const { Sequelize, SplashScreen, Event, EventGuest } = require('../models');
const { Op } = Sequelize;
const mediaService = require('./media.service');
const ApiError = require('../utils/apiError');

/**
 * Splash Screens — the screen a guest sees as an event opens.
 *
 * ── ONE EVENT, ONE SPLASH ───────────────────────────────────────────────────
 * `event_id` is required on create and UNIQUE in the database, so the app's
 * read for a given event can never be ambiguous. The duplicate is caught here
 * first so the client gets "that event already has a splash screen" instead of
 * MySQL's bare "Duplicate entry".
 *
 * `event_name` is no longer typed — it is copied from the chosen event, so the
 * text on the splash cannot drift from the event it belongs to.
 *
 * Ownership comes from the session everywhere here, same as guest groups: no
 * handler takes a client id from the request, which is what makes another
 * client's splash id a 404 rather than a read. The chosen EVENT is checked the
 * same way, so a splash cannot be filed against somebody else's event by id.
 */

const BACKGROUND_TYPES = ['image', 'video', 'solid_color', 'gradient', 'logo', 'couple_photo'];
const BUTTON_STYLES = ['filled', 'outline', 'text'];
const STATUSES = ['draft', 'active'];
const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const str = (value, max) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * The JSON config blobs are intentionally NOT schema-validated field by
 * field — each background type, and each add-on, has its own shape, and a
 * strict validator here would have to be rewritten every time a new option
 * is added to the form. What IS enforced is that this is plain JSON (not a
 * string containing JSON, not an array), so a malformed body fails loudly
 * here instead of being stored as something the form cannot read back.
 */
const asConfig = (value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw ApiError.badRequest('Configuration must be an object.');
    }
    return value;
};

/**
 * The chosen event, checked to be one of this client's own.
 *
 * A scoped `findOne`, not `findByPk` — the same guard `clientGuest.service`
 * uses for its own `event_id`, and the reason a splash cannot be attached to
 * another client's event by guessing its id.
 */
const resolveEvent = async (clientId, rawId) => {
    const eventId = Number(rawId);
    if (!eventId) throw ApiError.badRequest('Please choose an event.');

    const event = await Event.findOne({
        where: { id: eventId, website_client_id: clientId },
        attributes: ['id', 'name'],
    });
    if (!event) throw ApiError.badRequest('That event is not on your account.');
    return event;
};

/**
 * Refuses a second splash for an event before the UNIQUE index does, so the
 * message names the problem. `excludeId` lets an edit keep its own event.
 */
const assertEventFree = async (clientId, eventId, excludeId = null) => {
    const clash = await SplashScreen.findOne({
        where: {
            event_id: eventId,
            website_client_id: clientId,
            ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
        },
        attributes: ['id', 'name'],
    });
    if (clash) {
        throw ApiError.badRequest(
            `That event already has a splash screen ("${clash.name}"). Edit that one, or pick another event.`,
        );
    }
};

const normalise = async (clientId, body, { partial = false, existing = null } = {}) => {
    const data = {};
    const has = (f) => Object.prototype.hasOwnProperty.call(body, f);
    const required = (f) => !partial || has(f);

    // ── The event this splash belongs to ────────────────────────────────────
    // `event_name` is derived from it rather than taken from the body: the two
    // could otherwise disagree, and the name is what the guest actually reads.
    if (required('event_id')) {
        const event = await resolveEvent(clientId, body.event_id);
        await assertEventFree(clientId, event.id, existing ? existing.id : null);
        data.event_id = event.id;
        data.event_name = str(event.name, 100) || 'Untitled event';
    }

    if (required('name')) {
        const name = str(body.name, 150);
        if (!name) throw ApiError.badRequest('Please give this splash screen a name.');
        data.name = name;
    }
    if (required('main_title')) {
        const mainTitle = str(body.main_title, 60);
        if (!mainTitle) throw ApiError.badRequest('Please enter a main title.');
        data.main_title = mainTitle;
    }
    if (has('sub_title')) data.sub_title = str(body.sub_title, 20);
    // `event_name` is deliberately NOT read from the body — it is set above
    // from the chosen event. A client sending one is ignored rather than
    // trusted, so the splash always names the event it is actually attached to.
    if (has('tagline')) data.tagline = str(body.tagline, 150);

    if (required('background_type')) {
        const type = String(body.background_type || '').toLowerCase();
        if (!BACKGROUND_TYPES.includes(type)) throw ApiError.badRequest('Invalid background type.');
        data.background_type = type;
    }
    if (has('background_url')) data.background_url = str(body.background_url, 500);
    if (has('fallback_image_url')) data.fallback_image_url = str(body.fallback_image_url, 500);
    if (has('background_config')) data.background_config = asConfig(body.background_config);

    if (has('sound_enabled')) data.sound_enabled = !!body.sound_enabled;
    if (has('sound_url')) data.sound_url = str(body.sound_url, 500);
    if (has('sound_config')) data.sound_config = asConfig(body.sound_config);

    if (has('loader_enabled')) data.loader_enabled = !!body.loader_enabled;
    if (has('loader_config')) data.loader_config = asConfig(body.loader_config);

    // ⚠ Saved, not delivered — see the model header. Accepted here exactly
    // like any other field; the "not delivered yet" honesty lives in the API
    // response and the UI, not in a refusal to store the choice.
    if (has('animation_enabled')) data.animation_enabled = !!body.animation_enabled;
    if (has('animation_config')) data.animation_config = asConfig(body.animation_config);

    if (has('button_text')) {
        const buttonText = str(body.button_text, 25);
        if (!buttonText) throw ApiError.badRequest('Please enter button text.');
        data.button_text = buttonText;
    }
    if (has('button_style')) {
        const style = String(body.button_style || '').toLowerCase();
        if (!BUTTON_STYLES.includes(style)) throw ApiError.badRequest('Invalid button style.');
        data.button_style = style;
    }
    if (has('button_color')) {
        const color = str(body.button_color, 9);
        if (color && !HEX.test(color)) throw ApiError.badRequest('Button colour must be a hex value like #E91E63.');
        data.button_color = color;
    }

    if (has('show_couple_name')) data.show_couple_name = !!body.show_couple_name;
    if (has('show_event_date')) data.show_event_date = !!body.show_event_date;
    if (has('show_tagline')) data.show_tagline = !!body.show_tagline;

    if (has('status')) {
        const status = String(body.status || '').toLowerCase();
        if (!STATUSES.includes(status)) throw ApiError.badRequest('Invalid status.');
        data.status = status;
    }

    return data;
};

const listSplashScreens = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 12));
    const search = String(query.search || '').trim();

    const where = { website_client_id: clientId };
    if (search) {
        where[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { main_title: { [Op.like]: `%${search}%` } },
            { event_name: { [Op.like]: `%${search}%` } },
        ];
    }

    const { rows, count } = await SplashScreen.findAndCountAll({
        where,
        order: [['updated_at', 'DESC']],
        limit,
        offset: (page - 1) * limit,
    });

    return {
        rows,
        pagination: {
            page,
            limit,
            totalItems: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
        },
    };
};

const getSplashScreenById = async (clientId, id) => {
    return SplashScreen.findOne({ where: { id, website_client_id: clientId } });
};

const createSplashScreen = async (clientId, companyId, body) => {
    const data = await normalise(clientId, body, { partial: false });
    return SplashScreen.create({ ...data, website_client_id: clientId, company_id: companyId ?? null });
};

const updateSplashScreen = async (clientId, id, body) => {
    const splash = await getSplashScreenById(clientId, id);
    if (!splash) return null;
    const data = await normalise(clientId, body, { partial: true, existing: splash });
    await splash.update(data);
    return splash;
};

/**
 * Fields the app never needs and a guest must not read: which account owns the
 * splash, which company it bills under, and the internal label the host uses
 * to tell their own splashes apart.
 */
const HOST_ONLY_FIELDS = ['website_client_id', 'company_id', 'name', 'deleted_at'];

/**
 * The splash the MOBILE APP should show as one event opens.
 *
 * Only an `active` one is served: `draft` is how a client builds a splash
 * without guests seeing it, and honouring that here is the whole point of the
 * status column. Null means "no splash for this event" — the app goes straight
 * in, which is the intended behaviour, not an error.
 *
 * ── WHO MAY READ IT ─────────────────────────────────────────────────────────
 * The event's OWNER, or a GUEST of it — the same two doors `getEventForViewer`
 * opens for the event itself, and for the same reason: a splash is shown to
 * the people invited, so an owner-only read answered null for exactly the
 * audience the feature exists for.
 *
 * Membership is `event_guests.participant_client_id`, set only by the QR join
 * flow. NOT `website_client_id` on the guest row — that names the host, and
 * reading it here would let every guest read every splash of their own host.
 *
 * The splash is matched on the event's own owner as well as its id, so a row
 * can only ever be served for an event its author actually owns.
 */
const getActiveSplashForEvent = async (clientId, rawEventId) => {
    const eventId = Number(rawEventId);
    if (!eventId) return null;

    const event = await Event.findOne({
        where: { id: eventId },
        attributes: ['id', 'website_client_id'],
    });
    if (!event) return null;

    const isOwner = Number(event.website_client_id) === Number(clientId);
    if (!isOwner) {
        const membership = await EventGuest.findOne({
            where: { event_id: event.id, participant_client_id: clientId },
            attributes: ['id'],
        });
        if (!membership) return null;
    }

    const splash = await SplashScreen.findOne({
        where: {
            event_id: event.id,
            website_client_id: event.website_client_id,
            status: 'active',
        },
    });
    if (!splash) return null;

    const presented = splash.toJSON();
    for (const field of HOST_ONLY_FIELDS) delete presented[field];
    return presented;
};

const deleteSplashScreen = async (clientId, id) => {
    const splash = await getSplashScreenById(clientId, id);
    if (!splash) return null;
    // ⚠ Unlink BEFORE the soft delete. `paranoid` keeps the row, and a kept
    // row still holds its `event_id` under the UNIQUE index — so the event
    // could never get a new splash: `assertEventFree` skips deleted rows and
    // passes, then MySQL refuses the insert with a bare "Duplicate entry".
    await splash.update({ event_id: null });
    await splash.destroy();
    return { deleted: true };
};

/**
 * Upload one media asset (image, video, or audio) and hand back its URL.
 *
 * A separate upload-then-reference step, not multipart on the main create/
 * update endpoint — the same shape as the avatar uploader, and it means the
 * six-panel form can upload a file the moment it is picked rather than
 * waiting for the whole form to be valid and submitted.
 */
const uploadMedia = async (companyId, file) => {
    if (!file || !file.buffer) throw ApiError.badRequest('Please choose a file to upload.');

    const result = await mediaService.upload(file, { folder: 'splash-screens' }, companyId || 1);
    if (!result || !result.url) throw ApiError.badRequest('That file could not be stored.');
    return { url: result.url };
};

module.exports = {
    BACKGROUND_TYPES,
    BUTTON_STYLES,
    listSplashScreens,
    getSplashScreenById,
    getActiveSplashForEvent,
    createSplashScreen,
    updateSplashScreen,
    deleteSplashScreen,
    uploadMedia,
};
