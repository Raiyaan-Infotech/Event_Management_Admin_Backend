const { Theme } = require('../models');
const { Sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');
const { safeParseArray } = require('../utils/json');

const MODEL_NAME = 'Theme';

// header + footer are structural (always rendered by PublicNavbar/PublicFooter),
// so they are NOT required in home_blocks.
const REQUIRED_BLOCKS = ['slider', 'about_us', 'terms_conditions', 'privacy_policy'];

const getThemes = async (query = {}, companyId = undefined) => {
    if (query.plan_id) {
        const pid = Number(query.plan_id);
        const where = { is_active: 1 };
        if (companyId) where.company_id = companyId;
        const all = await Theme.findAll({ where });
        const filtered = all.filter(t => {
            const plans = safeParseArray(t.plans);
            return plans.map(Number).includes(pid);
        });
        return { data: filtered, pagination: { total: filtered.length } };
    }
    return baseService.getAll(Theme, MODEL_NAME, query, {
        searchFields: ['name'],
        sortableFields: ['name', 'created_at'],
        companyId
    });
};

const getThemeById = async (id, companyId = undefined) => {
    return baseService.getById(Theme, MODEL_NAME, id, { companyId });
};

const validateRequiredBlocks = (data) => {
    if (!data.home_blocks) return;
    const present = safeParseArray(data.home_blocks)
        .map(b => b.block_type);
    
    // Check for core requirements
    const coreRequired = ['about_us', 'terms_conditions', 'privacy_policy'];
    const missingCore = coreRequired.filter(r => !present.includes(r));
    
    // Check for at least one slider type
    const hasSlider = present.some(t => ['slider', 'simple_slider', 'advance_slider'].includes(t));
    
    const missing = [...missingCore];
    if (!hasSlider) missing.push('slider');

    if (missing.length) throw ApiError.badRequest(`Missing required blocks: ${missing.join(', ')}`);
};

const createTheme = async (data, userId = null, companyId = undefined) => {
    validateRequiredBlocks(data);
    return baseService.create(Theme, MODEL_NAME, {
        ...data,
        company_id: companyId
    }, userId);
};

const updateTheme = async (id, data, userId = null, companyId = undefined) => {
    validateRequiredBlocks(data);
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
            const plans = safeParseArray(t.plans);
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
