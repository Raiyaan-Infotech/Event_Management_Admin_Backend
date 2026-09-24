const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const participantService = require('../services/clientParticipant.service');

/**
 * Participants of the host's events (§581) — `/client/participants`.
 *
 * The phone book is `/client/guests`; these are the people attending one
 * event. Every handler reads `req.websiteClient` for the owner, so another
 * account's participant is a 404, not a read.
 */

const list = asyncHandler(async (req, res) => {
    const { rows, pagination } = await participantService.listParticipants(req.websiteClient.id, req.query);
    return ApiResponse.paginated(res, rows, pagination, 'Participants retrieved');
});

/** The RSVP tiles — `?event_id=` for one event, otherwise all of them. */
const stats = asyncHandler(async (req, res) => {
    const data = await participantService.getParticipantStats(req.websiteClient.id, req.query);
    return ApiResponse.success(res, data, 'Participant stats retrieved');
});

/** `{ limit, used, full }` for one event — `?event_id=`. */
const capacity = asyncHandler(async (req, res) => {
    // Scoped to the caller's own event — another host's counts are not theirs.
    const data = await participantService.getParticipantCapacity(req.websiteClient.id, req.query.event_id);
    return ApiResponse.success(res, data, 'Participant capacity retrieved');
});

const getById = asyncHandler(async (req, res) => {
    const participant = await participantService.getParticipantById(req.websiteClient.id, req.params.id);
    if (!participant) throw ApiError.notFound('Participant not found.');
    return ApiResponse.success(res, { participant, guest: participant }, 'Participant retrieved');
});

const create = asyncHandler(async (req, res) => {
    const participant = await participantService.createParticipant(
        req.websiteClient.id,
        req.websiteClient.company_id,
        req.body,
    );
    return ApiResponse.created(res, { participant, guest: participant }, 'Participant added successfully');
});

const update = asyncHandler(async (req, res) => {
    const participant = await participantService.updateParticipant(req.websiteClient.id, req.params.id, req.body);
    if (!participant) throw ApiError.notFound('Participant not found.');
    return ApiResponse.success(res, { participant, guest: participant }, 'Participant updated successfully');
});

const remove = asyncHandler(async (req, res) => {
    const ok = await participantService.deleteParticipant(req.websiteClient.id, req.params.id);
    if (!ok) throw ApiError.notFound('Participant not found.');
    return ApiResponse.success(res, null, 'Participant removed');
});

module.exports = { list, stats, capacity, getById, create, update, remove };
