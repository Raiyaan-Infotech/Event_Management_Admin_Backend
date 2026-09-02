const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const profileService = require('../services/clientGuestProfile.service');

/**
 * Guest Profile.
 *
 * Every handler takes `req.websiteClient` and every lookup is filtered by it,
 * so "not found" and "not yours" are the same answer — distinguishing them
 * would confirm a guest exists on somebody else's account.
 *
 * ⚠ `update` here does NOT accept name, email or phone. Those belong to the
 * Guests form; see the service. The nested note / tag / reminder handlers all
 * carry `:id` as well as their own id so ownership is checked on BOTH — a note
 * id alone would let a valid note be reached through the wrong guest.
 */

const get = asyncHandler(async (req, res) => {
    const data = await profileService.getProfile(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, data, 'Guest profile retrieved');
});

const update = asyncHandler(async (req, res) => {
    const data = await profileService.updateProfile(req.websiteClient.id, req.params.id, {
        photo: req.body.photo,
        relationship: req.body.relationship,
    });
    return ApiResponse.success(res, data, 'Guest profile updated');
});

/* ── Notes ───────────────────────────────────────────────────────────────── */

const createNote = asyncHandler(async (req, res) => {
    const data = await profileService.createNote(req.websiteClient.id, req.params.id, {
        title: req.body.title,
        body: req.body.body,
        category: req.body.category,
        visibility: req.body.visibility,
        is_pinned: req.body.is_pinned,
    });
    return ApiResponse.success(res, data, 'Note added', 201);
});

const updateNote = asyncHandler(async (req, res) => {
    const data = await profileService.updateNote(
        req.websiteClient.id, req.params.id, req.params.noteId,
        {
            title: req.body.title,
            body: req.body.body,
            category: req.body.category,
            visibility: req.body.visibility,
            is_pinned: req.body.is_pinned,
        },
    );
    return ApiResponse.success(res, data, 'Note updated');
});

const deleteNote = asyncHandler(async (req, res) => {
    const data = await profileService.deleteNote(
        req.websiteClient.id, req.params.id, req.params.noteId,
    );
    return ApiResponse.success(res, data, 'Note deleted');
});

/* ── Tags ────────────────────────────────────────────────────────────────── */

const addTag = asyncHandler(async (req, res) => {
    const data = await profileService.addTag(req.websiteClient.id, req.params.id, {
        label: req.body.label,
        color: req.body.color,
    });
    return ApiResponse.success(res, data, 'Tag added', 201);
});

const removeTag = asyncHandler(async (req, res) => {
    const data = await profileService.removeTag(
        req.websiteClient.id, req.params.id, req.params.tagId,
    );
    return ApiResponse.success(res, data, 'Tag removed');
});

/* ── Reminders ───────────────────────────────────────────────────────────── */

const createReminder = asyncHandler(async (req, res) => {
    const data = await profileService.createReminder(req.websiteClient.id, req.params.id, {
        title: req.body.title,
        due_at: req.body.due_at,
        note_id: req.body.note_id,
    });
    return ApiResponse.success(res, data, 'Reminder added', 201);
});

const updateReminder = asyncHandler(async (req, res) => {
    const data = await profileService.updateReminder(
        req.websiteClient.id, req.params.id, req.params.reminderId,
        { title: req.body.title, due_at: req.body.due_at, status: req.body.status },
    );
    return ApiResponse.success(res, data, 'Reminder updated');
});

const deleteReminder = asyncHandler(async (req, res) => {
    const data = await profileService.deleteReminder(
        req.websiteClient.id, req.params.id, req.params.reminderId,
    );
    return ApiResponse.success(res, data, 'Reminder deleted');
});

module.exports = {
    get,
    update,
    createNote,
    updateNote,
    deleteNote,
    addTag,
    removeTag,
    createReminder,
    updateReminder,
    deleteReminder,
};
