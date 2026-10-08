const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const participantSettingsService = require('../services/clientParticipantSettings.service');

/**
 * Participant Settings — GET, PUT /client/events/:id/participant-settings
 */

const getSettings = asyncHandler(async (req, res) => {
    const data = await participantSettingsService.get(req.websiteClient.id, req.params.id);
    return ApiResponse.success(res, data, 'Participant settings retrieved');
});

const updateSettings = asyncHandler(async (req, res) => {
    const {
        profile_screen, profile_photo, name, relationship, attendance_status,
    } = req.body;
    const data = await participantSettingsService.update(req.websiteClient.id, req.params.id, {
        profile_screen, profile_photo, name, relationship, attendance_status,
    });
    logger.logRequest(req, `Client ${req.websiteClient.id} updated participant settings of event ${req.params.id}`);
    return ApiResponse.success(res, data, 'Participant settings saved');
});

module.exports = {
    getSettings,
    updateSettings,
};
