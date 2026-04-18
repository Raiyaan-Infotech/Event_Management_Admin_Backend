const { Theme } = require('../models');
const baseService = require('./base.service');
const logger = require('../utils/logger');

const MODEL_NAME = 'Theme';

const getThemes = async (query = {}, companyId = undefined) => {
    return baseService.getAll(Theme, MODEL_NAME, query, {
        searchFields: ['name'],
        sortableFields: ['name', 'created_at'],
        companyId
    });
};

const getThemeById = async (id, companyId = undefined) => {
    return baseService.getById(Theme, MODEL_NAME, id, { companyId });
};

const createTheme = async (data, userId = null, companyId = undefined) => {
    return baseService.create(Theme, MODEL_NAME, {
        ...data,
        company_id: companyId
    }, userId);
};

const updateTheme = async (id, data, userId = null, companyId = undefined) => {
    return baseService.update(Theme, MODEL_NAME, id, data, userId, { companyId });
};

const deleteTheme = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(Theme, MODEL_NAME, id, userId, { companyId });
};

module.exports = {
    getThemes,
    getThemeById,
    createTheme,
    updateTheme,
    deleteTheme
};
