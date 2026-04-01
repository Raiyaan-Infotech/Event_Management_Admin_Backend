const { Sequelize, FaqCategory } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const getFaqCategories = async (query = {}) => {
    return baseService.getAll(FaqCategory, 'FaqCategory', query, {
        searchFields: ['name', 'description'],
        sortableFields: ['sort_order', 'name', 'created_at'],
        moduleSlug: 'faq_categories',
    });
};

const getFaqCategoryById = async (id) => {
    return baseService.getById(FaqCategory, 'FaqCategory', id);
};

const createFaqCategory = async (data, userId = null) => {
    const companyId = data.company_id || 1;

    if (data.name) {
        const nameExists = await FaqCategory.findOne({
            where: { company_id: companyId, name: data.name }
        });
        if (nameExists) {
            throw ApiError.badRequest(`A category with the name "${data.name}" already exists.`);
        }
    }

    if (data.sort_order) {
        const exists = await FaqCategory.findOne({
            where: { company_id: companyId, sort_order: data.sort_order }
        });
        if (exists) {
            throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken for categories.`);
        }
    }
    return baseService.create(FaqCategory, 'FaqCategory', data, userId);
};

const updateFaqCategory = async (id, data, userId = null) => {
    const category = await FaqCategory.findByPk(id);
    if (!category) throw ApiError.notFound('FAQ category not found');

    const companyId = data.company_id || category.company_id;

    if (data.name) {
        const nameExists = await FaqCategory.findOne({
            where: { id: { [Op.ne]: id }, company_id: companyId, name: data.name }
        });
        if (nameExists) {
            throw ApiError.badRequest(`A category with the name "${data.name}" already exists.`);
        }
    }

    if (data.sort_order) {
        const exists = await FaqCategory.findOne({
            where: { id: { [Op.ne]: id }, company_id: companyId, sort_order: data.sort_order }
        });
        if (exists) {
            throw ApiError.badRequest(`Sort order ${data.sort_order} is already taken for categories.`);
        }
    }
    return baseService.update(FaqCategory, 'FaqCategory', id, data, userId);
};

const deleteFaqCategory = async (id, userId = null) => {
    return baseService.remove(FaqCategory, 'FaqCategory', id, userId, undefined, { uniqueFields: ['name'] });
};

module.exports = {
    getFaqCategories,
    getFaqCategoryById,
    createFaqCategory,
    updateFaqCategory,
    deleteFaqCategory,
    // Aliases used by approval.service.js
    getAll: getFaqCategories,
    getById: getFaqCategoryById,
    create: createFaqCategory,
    update: updateFaqCategory,
    remove: deleteFaqCategory,
};
