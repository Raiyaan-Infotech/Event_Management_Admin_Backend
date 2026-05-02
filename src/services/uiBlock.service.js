const { UiBlock, UiBlockCategory } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const REGISTER_BLOCK_DEFAULTS = {
    block_type: 'register',
    label: 'Register',
    icon: 'UserPlus',
    category_id: 1,
    description: 'Controls whether the register action appears in the website header.',
    variants: [{ key: 'variant_1', label: 'Standard' }],
    plan_ids: [1, 2, 3],
    is_active: 1,
};

const ensureCoreUiBlocks = async () => {
    await UiBlock.findOrCreate({
        where: { block_type: REGISTER_BLOCK_DEFAULTS.block_type },
        defaults: REGISTER_BLOCK_DEFAULTS,
    });
};

const getUiBlocks = async (query = {}) => {
    await ensureCoreUiBlocks();
    return baseService.getAll(UiBlock, 'UiBlock', query, {
        searchFields: ['label', 'block_type', 'description'],
        sortableFields: ['label', 'block_type', 'created_at'],
        include: [{ model: UiBlockCategory, as: 'category', attributes: ['id', 'name'] }],
    });
};

const getUiBlockById = async (id) => {
    await ensureCoreUiBlocks();
    return baseService.getById(UiBlock, 'UiBlock', id, {
        include: [{ model: UiBlockCategory, as: 'category', attributes: ['id', 'name'] }],
    });
};

const createUiBlock = async (data, userId = null) => {
    if (data.block_type) {
        const exists = await UiBlock.findOne({ where: { block_type: data.block_type } });
        if (exists) throw ApiError.badRequest(`A block with type "${data.block_type}" already exists.`);
    }
    return baseService.create(UiBlock, 'UiBlock', data, userId);
};

const updateUiBlock = async (id, data, userId = null) => {
    const block = await UiBlock.findByPk(id);
    if (!block) throw ApiError.notFound('UI Block not found');
    return baseService.update(UiBlock, 'UiBlock', id, data, userId);
};

const deleteUiBlock = async (id, userId = null) => {
    return baseService.remove(UiBlock, 'UiBlock', id, userId);
};

module.exports = { getUiBlocks, getUiBlockById, createUiBlock, updateUiBlock, deleteUiBlock };
