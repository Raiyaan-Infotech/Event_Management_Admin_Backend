const faqService = require('../services/faq.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

const getFaqs = asyncHandler(async (req, res) => {
    const result = await faqService.getFaqs(req.query);
    logger.logRequest(req, 'Get all FAQs');
    return ApiResponse.paginated(res, result.data, result.pagination);
});

const getFaqById = asyncHandler(async (req, res) => {
    const faq = await faqService.getFaqById(req.params.id);
    logger.logRequest(req, 'Get FAQ by ID');
    return ApiResponse.success(res, { faq });
});

const createFaq = asyncHandler(async (req, res) => {
    const faq = await faqService.createFaq(req.body, req.user.id);
    logger.logRequest(req, 'Create FAQ');
    return ApiResponse.created(res, { faq }, 'FAQ created successfully');
});

const updateFaq = asyncHandler(async (req, res) => {
    const faq = await faqService.updateFaq(req.params.id, req.body, req.user.id);
    logger.logRequest(req, 'Update FAQ');
    return ApiResponse.success(res, { faq }, 'FAQ updated successfully');
});

const deleteFaq = asyncHandler(async (req, res) => {
    await faqService.deleteFaq(req.params.id, req.user.id);
    logger.logRequest(req, 'Delete FAQ');
    return ApiResponse.success(res, null, 'FAQ deleted successfully');
});

module.exports = {
    getFaqs,
    getFaqById,
    createFaq,
    updateFaq,
    deleteFaq,
};
