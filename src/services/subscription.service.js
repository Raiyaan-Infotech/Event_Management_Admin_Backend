const { Subscription } = require('../models');
const baseService = require('./base.service');

const MODEL_NAME = 'Subscription';

const getAll = async (query = {}, companyId = undefined) => {
    return baseService.getAll(Subscription, MODEL_NAME, query, {
        searchFields: ['name'],
        sortableFields: ['created_at', 'name', 'price'],
        companyId,
        moduleSlug: 'subscriptions',
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(Subscription, MODEL_NAME, id, { companyId });
};

const create = async (data, userId = null, companyId = undefined) => {
    return baseService.create(Subscription, MODEL_NAME, data, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    return baseService.update(Subscription, MODEL_NAME, id, data, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    return baseService.update(Subscription, MODEL_NAME, id, { is_active }, userId, companyId);
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(Subscription, MODEL_NAME, id, userId, companyId);
};

module.exports = {
    getAll,
    getById,
    create,
    update,
    updateStatus,
    deleteById,
    // Alias used by approval.service.js executeApprovedAction
    remove: deleteById,
};
