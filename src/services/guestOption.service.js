const { Sequelize, EventCategory } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

/**
 * The shared body of the two guest-registration dropdown services.
 *
 * `guest_relationship_options` and `guest_food_preference_options` are the same
 * table twice over, and every rule below applies identically to both: scoped by
 * category, unique per category, ordered by `sort_order`. Writing the logic once
 * is the point — two hand-maintained copies drift, and the first symptom would
 * be a validation that fires on one dropdown and not the other.
 *
 * The two thin services that wrap this exist so each keeps its own module slug
 * (which drives permissions and the approval queue) and its own error wording.
 */

const WRITABLE_FIELDS = [
    'event_category_id', 'name', 'description', 'icon', 'color', 'sort_order', 'is_active',
];

const pickWritable = (data = {}) =>
    WRITABLE_FIELDS.reduce((acc, key) => {
        if (data[key] !== undefined) acc[key] = data[key];
        return acc;
    }, {});

/**
 * Read a category id off the request.
 *
 * Three meanings, and they are genuinely different: absent = every category,
 * the string "null" = the fallback list only, a number = that one category.
 * Without the explicit "null" an admin could never open the fallback list to
 * edit it, because there is no id to ask for.
 */
const parseCategoryId = (value) => {
    if (value === undefined || value === '') return undefined;
    if (value === 'null' || value === null) return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * Build one service bound to one model.
 *
 * @param {object} cfg
 * @param {object} cfg.Model        the Sequelize model
 * @param {string} cfg.modelName    for logging
 * @param {string} cfg.moduleSlug   permission + approval slug
 * @param {string} cfg.label        used in error messages ("relationship option")
 */
const build = ({ Model, modelName, moduleSlug, label }) => {
    /** Live rows only — a soft-deleted row must not block re-adding its name. */
    const nameTaken = async (name, categoryId, companyId, excludeId = null) => {
        const where = {
            company_id: companyId ?? null,
            event_category_id: categoryId ?? null,
            name,
        };
        if (excludeId) where.id = { [Op.ne]: excludeId };
        const hit = await Model.findOne({ where, attributes: ['id'] });
        return Boolean(hit);
    };

    const assertCategoryExists = async (categoryId) => {
        if (categoryId === null || categoryId === undefined) return; // the fallback list
        const cat = await EventCategory.findByPk(categoryId, { attributes: ['id'] });
        if (!cat) throw ApiError.badRequest('That event category does not exist.');
    };

    const getAll = async (query = {}, companyId = undefined) => {
        const listQuery = { sort_by: 'sort_order', sort_order: 'ASC', ...query };

        const categoryId = parseCategoryId(query.event_category_id);
        const where = categoryId === undefined ? undefined : { event_category_id: categoryId };

        return baseService.getAll(Model, modelName, listQuery, {
            searchFields: ['name', 'description'],
            sortableFields: ['sort_order', 'name', 'created_at'],
            companyId,
            moduleSlug,
            where,
            include: [{ model: EventCategory, as: 'category', attributes: ['id', 'name'], required: false }],
        });
    };

    const getById = async (id, companyId = undefined) =>
        baseService.getById(Model, modelName, id, { companyId });

    const create = async (data, userId = null, companyId = undefined) => {
        const payload = pickWritable(data);

        if (!payload.name || !String(payload.name).trim()) {
            throw ApiError.badRequest(`A ${label} name is required.`);
        }
        payload.name = String(payload.name).trim();

        payload.event_category_id = parseCategoryId(payload.event_category_id) ?? null;
        await assertCategoryExists(payload.event_category_id);

        if (await nameTaken(payload.name, payload.event_category_id, companyId)) {
            throw ApiError.badRequest(`"${payload.name}" is already in this list.`);
        }

        return baseService.create(Model, modelName, payload, userId, companyId);
    };

    const update = async (id, data, userId = null, companyId = undefined) => {
        const row = await Model.findByPk(id);
        if (!row) throw ApiError.notFound(`That ${label} was not found.`);

        const payload = pickWritable(data);

        // The category may be moving, so uniqueness is checked against wherever
        // the row will END UP, not where it is now.
        const targetCategory = payload.event_category_id !== undefined
            ? (parseCategoryId(payload.event_category_id) ?? null)
            : row.event_category_id;

        if (payload.event_category_id !== undefined) {
            payload.event_category_id = targetCategory;
            await assertCategoryExists(targetCategory);
        }

        if (payload.name !== undefined) {
            if (!String(payload.name).trim()) {
                throw ApiError.badRequest(`A ${label} name is required.`);
            }
            payload.name = String(payload.name).trim();
        }

        const finalName = payload.name ?? row.name;
        if (await nameTaken(finalName, targetCategory, companyId ?? row.company_id, id)) {
            throw ApiError.badRequest(`"${finalName}" is already in this list.`);
        }

        return baseService.update(Model, modelName, id, payload, userId, companyId);
    };

    const updateStatus = async (id, is_active, userId = null, companyId = undefined) =>
        baseService.update(Model, modelName, id, { is_active: is_active ? 1 : 0 }, userId, companyId);

    const deleteById = async (id, userId = null, companyId = undefined) =>
        baseService.remove(Model, modelName, id, userId, companyId);

    /**
     * The list the guest registration form should actually show.
     *
     * Falls back to the NULL-category rows when the event has no category, or
     * when its category has no list of its own — so the form is never empty.
     * Inactive rows are excluded: switching one off in admin is how you retire
     * a value without rewriting the answers that already reference it.
     */
    const listForCategory = async (categoryId, companyId = 1) => {
        const query = (where) => Model.findAll({
            where: { company_id: companyId, is_active: 1, ...where },
            attributes: ['id', 'name', 'sort_order'],
            order: [['sort_order', 'ASC'], ['name', 'ASC']],
        });

        if (categoryId) {
            const scoped = await query({ event_category_id: categoryId });
            if (scoped.length) return scoped;
        }
        return query({ event_category_id: null });
    };

    return {
        getAll,
        getById,
        create,
        update,
        updateStatus,
        deleteById,
        listForCategory,
        // Alias used by approval.service.js executeApprovedAction
        remove: deleteById,
    };
};

module.exports = { build, parseCategoryId, WRITABLE_FIELDS };
