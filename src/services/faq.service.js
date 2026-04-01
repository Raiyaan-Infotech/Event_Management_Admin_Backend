const { Sequelize, Faq, FaqCategory } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const getFaqs = async (query = {}) => {
    return baseService.getAll(Faq, 'Faq', query, {
        searchFields: ['question', 'answer'],
        sortableFields: ['sort_order', 'created_at'],
        include: [
            { model: FaqCategory, as: 'category', attributes: ['id', 'name'] }
        ],
        moduleSlug: 'faqs',
    });
};

const getFaqById = async (id) => {
    return baseService.getById(Faq, 'Faq', id, {
        include: [
            { model: FaqCategory, as: 'category', attributes: ['id', 'name'] }
        ]
    });
};

const createFaq = async (data, userId = null) => {
    // Check if sort_order already exists in this category
    if (data.sort_order) {
        const exists = await Faq.findOne({
            where: {
                faq_category_id: data.faq_category_id,
                sort_order: data.sort_order
            }
        });
        if (exists) {
            throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken in this category.`);
        }
    }
    return baseService.create(Faq, 'Faq', data, userId);
};

const updateFaq = async (id, data, userId = null) => {
    // Check if sort_order already exists in this category (excluding self)
    if (data.sort_order) {
        const faq = await Faq.findByPk(id);
        const categoryId = data.faq_category_id || faq.faq_category_id;
        
        const exists = await Faq.findOne({
            where: {
                id: { [Op.ne]: id },
                faq_category_id: categoryId,
                sort_order: data.sort_order
            }
        });
        if (exists) {
            throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken in this category.`);
        }
    }
    return baseService.update(Faq, 'Faq', id, data, userId);
};

const deleteFaq = async (id, userId = null) => {
    return baseService.remove(Faq, 'Faq', id, userId);
};

module.exports = {
    getFaqs,
    getFaqById,
    createFaq,
    updateFaq,
    deleteFaq,
    // Aliases used by approval middleware (old data fetch) and approval.service.js (execution)
    getById: getFaqById,
    create: createFaq,
    update: updateFaq,
    remove: deleteFaq,
};
