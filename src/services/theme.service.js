const { Theme } = require('../models');
const { Sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

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

// Find the themes assigned to a specific subscription plan ID
const getThemesByPlan = async (planId, companyId = undefined) => {
    const where = { is_active: 1 };
    if (companyId) where.company_id = companyId;

    // Use JSON_CONTAINS to search within the plans JSON array
    const themes = await Theme.findAll({
        where: {
            ...where,
            plans: { [Op.ne]: null },
        },
        having: Sequelize.literal(`JSON_CONTAINS(plans, '${Number(planId)}')`),
    });

    // Fallback: JS-level filter if DB-level doesn't work
    if (!themes || themes.length === 0) {
        const all = await Theme.findAll({ where });
        return all.filter(t => {
            const plans = Array.isArray(t.plans) ? t.plans : (typeof t.plans === 'string' ? JSON.parse(t.plans) : []);
            return plans.map(Number).includes(Number(planId));
        });
    }
    return themes;
};

module.exports = {
    getThemes,
    getThemeById,
    createTheme,
    updateTheme,
    deleteTheme,
    getThemesByPlan,
};
