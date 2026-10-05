const templateFontService = require('../services/templateFont.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getAll = asyncHandler(async (req, res) => {
    const fonts = await templateFontService.getAll(req.query, req.companyId);
    logger.logRequest(req, `Fetched ${fonts.length} template fonts`);
    return ApiResponse.success(res, { fonts });
});

/** Multipart with a `file` = an uploaded font; JSON with `link_url` = a linked one. */
const create = asyncHandler(async (req, res) => {
    const font = await templateFontService.create(req.body, req.file, req.user.id, req.companyId);
    logger.logRequest(req, `Added template font: ${font.name}`);
    return ApiResponse.success(res, { font }, 'Font added successfully', 201);
});

const update = asyncHandler(async (req, res) => {
    const font = await templateFontService.update(req.params.id, req.body, req.user.id, req.companyId);
    logger.logRequest(req, `Updated template font ${req.params.id}`);
    return ApiResponse.success(res, { font }, 'Font updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
    await templateFontService.remove(req.params.id, req.companyId);
    logger.logRequest(req, `Deleted template font ${req.params.id}`);
    return ApiResponse.success(res, null, 'Font deleted successfully');
});

/**
 * PUBLIC — the font file itself, for `@font-face`. A font is not a secret (it
 * is drawn on an invitation anybody with the link can open), and a browser's
 * font request carries no session.
 */
const file = asyncHandler(async (req, res) => {
    const { buffer, mime } = await templateFontService.readFile(req.params.id);
    res.set({
        'Content-Type': mime,
        'Content-Length': buffer.length,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        // The file behind an id never changes — a replacement is a new row.
        'Cache-Control': 'public, max-age=31536000, immutable',
    });
    return res.end(buffer);
});

module.exports = { getAll, create, update, deleteById, file };
