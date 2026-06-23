const { ColorPalette } = require('../models');
const baseService = require('./base.service');

const MODEL_NAME = 'ColorPalette';

const getAll = async (query = {}, companyId = undefined) => {
    return baseService.getAll(ColorPalette, MODEL_NAME, query, {
        searchFields: ['name'],
        sortableFields: ['name', 'created_at'],
        companyId,
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(ColorPalette, MODEL_NAME, id, { companyId });
};

const create = async (data, userId = null, companyId = undefined) => {
    return baseService.create(ColorPalette, MODEL_NAME, {
        ...data,
        company_id: companyId,
    }, userId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    return baseService.update(ColorPalette, MODEL_NAME, id, data, userId, { companyId });
};

const remove = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(ColorPalette, MODEL_NAME, id, userId, { companyId });
};

module.exports = { getAll, getById, create, update, remove };
