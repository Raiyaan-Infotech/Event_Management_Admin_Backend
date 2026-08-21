const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const guestService = require('../services/clientGuest.service');
const groupService = require('../services/clientGuestGroup.service');
const importService = require('../services/clientGuestImport.service');
const exportService = require('../services/clientGuestExport.service');

/**
 * Guests, groups and the CSV round trip.
 *
 * Every handler reads `req.websiteClient` for the owner. No handler takes a
 * client id from the request, which is what makes another account's id a 404
 * rather than a read.
 */

/* ── Guests ─────────────────────────────────────────────────────────────── */

const list = asyncHandler(async (req, res) => {
    const { rows, pagination } = await guestService.listGuests(req.websiteClient.id, req.query);
    return ApiResponse.paginated(res, rows, pagination, 'Guests retrieved');
});

/** The five tiles. Takes the same `event_id` as the list so they agree. */
const stats = asyncHandler(async (req, res) => {
    const data = await guestService.getGuestStats(req.websiteClient.id, req.query);
    return ApiResponse.success(res, data, 'Guest stats retrieved');
});

const getById = asyncHandler(async (req, res) => {
    const guest = await guestService.getGuestById(req.websiteClient.id, req.params.id);
    if (!guest) throw ApiError.notFound('Guest not found.');
    return ApiResponse.success(res, { guest }, 'Guest retrieved');
});

const create = asyncHandler(async (req, res) => {
    const guest = await guestService.createGuest(
        req.websiteClient.id,
        req.websiteClient.company_id,
        req.body
    );
    return ApiResponse.created(res, { guest }, 'Guest added successfully');
});

const update = asyncHandler(async (req, res) => {
    const guest = await guestService.updateGuest(req.websiteClient.id, req.params.id, req.body);
    if (!guest) throw ApiError.notFound('Guest not found.');
    return ApiResponse.success(res, { guest }, 'Guest updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    const ok = await guestService.deleteGuest(req.websiteClient.id, req.params.id);
    if (!ok) throw ApiError.notFound('Guest not found.');
    return ApiResponse.success(res, null, 'Guest removed');
});

/**
 * The list's checkbox column, made useful.
 *
 * POST rather than PATCH: the body carries an action and a selection, not a
 * partial representation of one resource.
 */
const bulk = asyncHandler(async (req, res) => {
    const { guest_ids: guestIds, action, value } = req.body ?? {};
    const result = await guestService.bulkUpdate(req.websiteClient.id, guestIds, action, value);
    return ApiResponse.success(res, result, `${result.affected} guest(s) updated`);
});

/* ── Groups ─────────────────────────────────────────────────────────────── */

const listGroups = asyncHandler(async (req, res) => {
    const { rows, pagination } = await groupService.listGroups(req.websiteClient.id, req.query);
    return ApiResponse.paginated(res, rows, pagination, 'Groups retrieved');
});

/** Unpaginated, for the pickers on Add Guest and Send Message. */
const allGroups = asyncHandler(async (req, res) => {
    const rows = await groupService.listAllGroups(req.websiteClient.id);
    return ApiResponse.success(res, { groups: rows }, 'Groups retrieved');
});

const groupStats = asyncHandler(async (req, res) => {
    const data = await groupService.getGroupStats(req.websiteClient.id);
    return ApiResponse.success(res, data, 'Group stats retrieved');
});

const getGroup = asyncHandler(async (req, res) => {
    const group = await groupService.getGroupById(req.websiteClient.id, req.params.id);
    if (!group) throw ApiError.notFound('Group not found.');
    return ApiResponse.success(res, { group }, 'Group retrieved');
});

const createGroup = asyncHandler(async (req, res) => {
    const group = await groupService.createGroup(
        req.websiteClient.id,
        req.websiteClient.company_id,
        req.body
    );
    return ApiResponse.created(res, { group }, 'Group created successfully');
});

const updateGroup = asyncHandler(async (req, res) => {
    const group = await groupService.updateGroup(req.websiteClient.id, req.params.id, req.body);
    if (!group) throw ApiError.notFound('Group not found.');
    return ApiResponse.success(res, { group }, 'Group updated successfully');
});

/** Deleting a group UNGROUPS its guests; the count says how many were touched. */
const removeGroup = asyncHandler(async (req, res) => {
    const result = await groupService.deleteGroup(req.websiteClient.id, req.params.id);
    if (!result) throw ApiError.notFound('Group not found.');
    return ApiResponse.success(
        res,
        result,
        result.ungrouped_guests
            ? `Group deleted. ${result.ungrouped_guests} guest(s) are now ungrouped.`
            : 'Group deleted.'
    );
});

/* ── Import / export ────────────────────────────────────────────────────── */

/**
 * Steps 2 and 3 — Map Fields and Review & Preview. Writes nothing.
 *
 * The file arrives as text in the body rather than multipart: the browser has
 * already read it to show a preview, the cap is 10 MB, and multipart here would
 * mean wiring multer into a route that does not need a file on disk.
 */
const previewImport = asyncHandler(async (req, res) => {
    const { content, event_id: eventId } = req.body ?? {};
    if (!content) throw ApiError.badRequest('No file contents received.');

    const result = await importService.parseCsv(req.websiteClient.id, {
        content: String(content),
        defaultEventId: Number(eventId) || null,
    });
    return ApiResponse.success(res, result, 'File analysed');
});

/** Step 4 — write the valid rows. Re-analyses; never trusts the preview back. */
const commitImport = asyncHandler(async (req, res) => {
    const { content, event_id: eventId, create_groups: createGroups } = req.body ?? {};
    if (!content) throw ApiError.badRequest('No file contents received.');

    const result = await importService.commitImport(
        req.websiteClient.id,
        req.websiteClient.company_id,
        {
            content: String(content),
            defaultEventId: Number(eventId) || null,
            createGroups: !!createGroups,
        }
    );
    return ApiResponse.success(res, result, `${result.imported} guest(s) imported`);
});

/**
 * CSV out.
 *
 * Sent as a real download rather than a JSON string the browser has to
 * re-assemble — Content-Disposition is what makes "Export" behave like every
 * other export the user has ever used.
 */
const exportGuests = asyncHandler(async (req, res) => {
    const { filename, content } = await exportService.exportGuests(req.websiteClient.id, req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(content);
});

/** The design's "Download Sample CSV" link. */
const sampleCsv = asyncHandler(async (req, res) => {
    const { filename, content } = await exportService.sampleCsv(req.websiteClient.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(content);
});

module.exports = {
    list, stats, getById, create, update, remove, bulk,
    listGroups, allGroups, groupStats, getGroup, createGroup, updateGroup, removeGroup,
    previewImport, commitImport, exportGuests, sampleCsv,
};
