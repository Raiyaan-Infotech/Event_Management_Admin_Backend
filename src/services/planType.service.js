const { PlanType } = require('../models');
const baseService = require('./base.service');

const MODEL_NAME = 'PlanType';

const getAll = async (query = {}, companyId = undefined) => {
    return baseService.getAll(PlanType, MODEL_NAME, query, {
        searchFields: ['name'],
        sortableFields: ['created_at', 'name', 'price'],
        companyId,
        moduleSlug: 'plan_types',
    });
};

const getById = async (id, companyId = undefined) => {
    return baseService.getById(PlanType, MODEL_NAME, id, { companyId });
};

const create = async (data, userId = null, companyId = undefined) => {
    return baseService.create(PlanType, MODEL_NAME, data, userId, companyId);
};

const update = async (id, data, userId = null, companyId = undefined) => {
    return baseService.update(PlanType, MODEL_NAME, id, data, userId, companyId);
};

const updateStatus = async (id, is_active, userId = null, companyId = undefined) => {
    return baseService.update(PlanType, MODEL_NAME, id, { is_active }, userId, companyId);
};

const deleteById = async (id, userId = null, companyId = undefined) => {
    return baseService.remove(PlanType, MODEL_NAME, id, userId, companyId);
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
