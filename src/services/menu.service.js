const { Menu } = require('../models');
const baseService = require('./base.service');

const MODEL_NAME = 'Menu';

const getAll = async (query = {}, companyId = undefined) => {
    return baseService.getAll(Menu, MODEL_NAME, query, {
        searchFields: ['name'],
        sortableFields: ['created_at', 'name'],
        companyId,
        moduleSlug: 'menus',
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(Menu, MODEL_NAME, id, { companyId });
};

const create = async (data, userId = null, companyId = undefined) => {
    return baseService.create(Menu, MODEL_NAME, data, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    return baseService.update(Menu, MODEL_NAME, id, data, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    return baseService.update(Menu, MODEL_NAME, id, { is_active }, userId, companyId);
};

const updateDisplayStatus = async (id, display_status, userId = null, companyId = undefined) => {
    return baseService.update(Menu, MODEL_NAME, id, { display_status }, userId, companyId);
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(Menu, MODEL_NAME, id, userId, companyId);
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    updateDisplayStatus,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
