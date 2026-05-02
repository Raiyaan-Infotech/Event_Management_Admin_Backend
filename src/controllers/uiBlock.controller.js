const uiBlockService = require('../services/uiBlock.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getUiBlocks = asyncHandler(async (req, res) => {
    const result = await uiBlockService.getUiBlocks(req.query, req.companyId);
    logger.logRequest(req, 'Get all UI blocks');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getUiBlockById = asyncHandler(async (req, res) => {
    const uiBlock = await uiBlockService.getUiBlockById(req.params.id, req.companyId);
    logger.logRequest(req, 'Get UI block by ID');
    return ApiResponse.success(res, { uiBlock });
});

const createUiBlock = asyncHandler(async (req, res) => {
    const uiBlock = await uiBlockService.createUiBlock(req.body, req.user?.id, req.companyId);
    logger.logRequest(req, 'Create UI block');
    return ApiResponse.created(res, { uiBlock }, 'UI block created successfully');
});

const updateUiBlock = asyncHandler(async (req, res) => {
    const uiBlock = await uiBlockService.updateUiBlock(req.params.id, req.body, req.user?.id, req.companyId);
    logger.logRequest(req, 'Update UI block');
    return ApiResponse.success(res, { uiBlock }, 'UI block updated successfully');
});

const deleteUiBlock = asyncHandler(async (req, res) => {
    await uiBlockService.deleteUiBlock(req.params.id, req.user?.id, req.companyId);
    logger.logRequest(req, 'Delete UI block');
    return ApiResponse.success(res, null, 'UI block deleted successfully');
});

module.exports = {
    getUiBlocks,
    getUiBlockById,
    createUiBlock,
    updateUiBlock,
    deleteUiBlock
};
