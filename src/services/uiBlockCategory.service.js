const { UiBlockCategory } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const getUiBlockCategories = async (query = {}) => {
    return baseService.getAll(UiBlockCategory, 'UiBlockCategory', query, {
        searchFields: ['name', 'description'],
        sortableFields: ['name', 'created_at'],
    });
};

const getUiBlockCategoryById = async (id) => {
    return baseService.getById(UiBlockCategory, 'UiBlockCategory', id);
};

const createUiBlockCategory = async (data, userId = null) => {
    if (data.name) {
        const exists = await UiBlockCategory.findOne({ where: { name: data.name } });
        if (exists) throw ApiError.badRequest(`A category with the name "${data.name}" already exists.`);
    }
    return baseService.create(UiBlockCategory, 'UiBlockCategory', data, userId);
};

const updateUiBlockCategory = async (id, data, userId = null) => {
    const cat = await UiBlockCategory.findByPk(id);
    if (!cat) throw ApiError.notFound('UI Block Category not found');
    return baseService.update(UiBlockCategory, 'UiBlockCategory', id, data, userId);
};

const deleteUiBlockCategory = async (id, userId = null) => {
    return baseService.remove(UiBlockCategory, 'UiBlockCategory', id, userId);
};

module.exports = { getUiBlockCategories, getUiBlockCategoryById, createUiBlockCategory, updateUiBlockCategory, deleteUiBlockCategory };
