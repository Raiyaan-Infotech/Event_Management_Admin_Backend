const { asyncHandler } = require('../utils/helpers');
const ApiResponse = require('../utils/apiResponse');
const service = require('../services/clientQrScan.service');

/** Scan QR + My Favourites (2026-10-28). See clientQrScan.service. */

const myQr = asyncHandler(async (req, res) => {
    const data = await service.myQr(req);
    return ApiResponse.success(res, data, 'Your QR code');
});

const scan = asyncHandler(async (req, res) => {
    const data = await service.scan(req, req.body?.token ?? req.body?.qr_token);
    return ApiResponse.success(res, data, data.type === 'event' ? 'Event QR code' : 'Contact found');
});

const listFavourites = asyncHandler(async (req, res) => {
    const data = await service.listFavourites(req, req.query);
    return ApiResponse.success(res, data, 'Favourites retrieved');
});

const setFavourite = asyncHandler(async (req, res) => {
    const contact = await service.setFavourite(req, req.params.id, req.body?.favourite);
    return ApiResponse.success(
        res,
        { contact },
        contact.is_favourite ? 'Contact saved to Favourites' : 'Removed from Favourites',
    );
});

module.exports = { myQr, scan, listFavourites, setFavourite };
