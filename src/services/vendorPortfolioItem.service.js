const { VendorPortfolioItem, sequelize } = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

const getAll = async (type, vendorId) => {
    return VendorPortfolioItem.findAll({
        where: { type, vendor_id: vendorId },
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
};

const getById = async (id, vendorId) => {
    const item = await VendorPortfolioItem.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Item not found');
    return item;
};

const create = async (type, data, vendorId, companyId) => {
    const normalized = await mediaService.uploadDataUriFields(data, ['image_path'], { folder: 'portfolio' }, companyId);
    return sequelize.transaction(async (t) => {
        let order = normalized.sort_order || 0;

        if (order === 0) {
            const maxOrder = await VendorPortfolioItem.max('sort_order', {
                where: { type, vendor_id: vendorId },
                transaction: t
            });
            order = (maxOrder || 0) + 1;
        } else {
            // Shift existing
            await VendorPortfolioItem.increment('sort_order', {
                by: 1,
                where: { type, vendor_id: vendorId, sort_order: { [Op.gte]: order } },
                transaction: t
            });
        }

        return VendorPortfolioItem.create({
            ...normalized,
            type,
            vendor_id:  vendorId,
            company_id: companyId,
            sort_order: order
        }, { transaction: t });
    });
};

const update = async (id, data, vendorId) => {
    const item = await VendorPortfolioItem.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Item not found');
    const normalized = await mediaService.uploadDataUriFields(data, ['image_path'], { folder: 'portfolio' }, item.company_id);

    if (normalized.sort_order !== undefined && normalized.sort_order !== item.sort_order) {
        return sequelize.transaction(async (t) => {
            const oldOrder = item.sort_order;
            const newOrder = normalized.sort_order;
            const type = item.type;

            if (newOrder > oldOrder) {
                await VendorPortfolioItem.decrement('sort_order', {
                    by: 1,
                    where: {
                        type,
                        vendor_id: vendorId,
                        sort_order: { [Op.gt]: oldOrder, [Op.lte]: newOrder },
                        id: { [Op.ne]: id }
                    },
                    transaction: t
                });
            } else {
                await VendorPortfolioItem.increment('sort_order', {
                    by: 1,
                    where: {
                        type,
                        vendor_id: vendorId,
                        sort_order: { [Op.gte]: newOrder, [Op.lt]: oldOrder },
                        id: { [Op.ne]: id }
                    },
                    transaction: t
                });
            }

            await item.update(normalized, { transaction: t });
            return item;
        });
    }

    await item.update(normalized);
    return item;
};

const updateStatus = async (id, vendorId) => {
    const item = await VendorPortfolioItem.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Item not found');
    await item.update({ is_active: item.is_active ? 0 : 1 });
    return item;
};

const remove = async (id, vendorId) => {
    const item = await VendorPortfolioItem.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Item not found');
    await item.destroy();
    return true;
};

// Events (label+value rows) — replace all for vendor on save
const getEvents = async (vendorId) => {
    return VendorPortfolioItem.findAll({
        where: { type: 'event', vendor_id: vendorId },
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
};

const replaceEvents = async (items, vendorId, companyId, createdBy) => {
    await VendorPortfolioItem.destroy({ where: { type: 'event', vendor_id: vendorId }, force: true });
    if (!Array.isArray(items) || items.length === 0) return [];
    const rows = items
        .filter((it) => it && it.label && it.value)
        .map((it, idx) => ({
            type:       'event',
            label:      it.label,
            value:      it.value,
            sort_order: idx,
            vendor_id:  vendorId,
            company_id: companyId,
            created_by: createdBy,
            is_active:  1,
        }));
    if (rows.length === 0) return [];
    return VendorPortfolioItem.bulkCreate(rows);
};

module.exports = { getAll, getById, create, update, updateStatus, remove, getEvents, replaceEvents };
