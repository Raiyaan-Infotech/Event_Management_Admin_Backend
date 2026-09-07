const service = require('../services/guestRegistration.service');
const sessionService = require('../services/clientSession.service');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Guest self-registration — the mobile app's "New Participant" flow.
 *
 * The first three handlers are UNAUTHENTICATED by necessity: the person has no
 * account yet. Each one is gated by a QR token that has to decrypt, which is
 * what stops this being an open account factory — see the service header.
 */

/** Step 1 — decode the scanned code into an event plus its two dropdowns. */
const resolve = asyncHandler(async (req, res) => {
    const token = req.body?.token ?? req.body?.qr_token ?? req.query?.token;
    const result = await service.resolveInvite(token);
    logger.logRequest(req, `QR resolved to event ${result.event.id}`);
    return ApiResponse.success(res, result, 'Invitation found');
});

/** Step 2a — the "Verify" button beside the mobile field. */
const requestOtp = asyncHandler(async (req, res) => {
    const result = await service.requestOtp(req.body);
    logger.logRequest(req, 'Guest registration OTP requested');
    return ApiResponse.success(res, result, 'Verification code sent.');
});

/**
 * Step 2b — the code is checked and the session is issued HERE, not at join.
 *
 * The app needs to be signed in before the final submit so that `join` runs
 * under a real identity, which is what lets it trust the verified number
 * instead of whatever the form posts.
 */
const verifyOtp = asyncHandler(async (req, res) => {
    const client = await service.verifyOtp(req.body);
    const { accessToken, refreshToken } = await sessionService.issueSession({ client, req });

    logger.logRequest(req, `Guest registration verified: client ${client.id}`);
    return ApiResponse.success(
        res,
        {
            client,
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: 15 * 60,
        },
        'Mobile number verified',
    );
});

/** Step 3 — Confirm on the review screen. Authenticated. */
const join = asyncHandler(async (req, res) => {
    const client = req.websiteClient;
    if (!client) throw ApiError.unauthorized('Please verify your mobile number first.');

    const result = await service.join(client, req.body);
    logger.logRequest(
        req,
        `Client ${client.id} ${result.created ? 'joined' : 'updated their entry for'} event ${result.event.id}`,
    );
    return ApiResponse.success(
        res,
        result,
        result.created ? 'You have joined the event' : 'Your details have been updated',
        result.created ? 201 : 200,
    );
});

/** The app's My Events for somebody who is a guest rather than a host. */
const myEvents = asyncHandler(async (req, res) => {
    const events = await service.myEvents(req.websiteClient.id);
    logger.logRequest(req, `Listed ${events.length} joined events`);
    return ApiResponse.success(res, { events });
});

module.exports = { resolve, requestOtp, verifyOtp, join, myEvents };
