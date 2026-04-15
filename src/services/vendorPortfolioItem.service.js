const { VendorPortfolioItem } = require('../models');
const ApiError = require('../utils/apiError');

const getAll = async (type, vendorId) => {
    return VendorPortfolioItem.findAll({
        where: { type, vendor_id: vendorId },
        order: [['created_at', 'DESC']],
    });
};

const getById = async (id, vendorId) => {
    const item = await VendorPortfolioItem.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Item not found');
    return item;
};

const create = async (type, data, vendorId, companyId) => {
    return VendorPortfolioItem.create({ ...data, type, vendor_id: vendorId, company_id: companyId });
};

const update = async (id, data, vendorId) => {
    const item = await VendorPortfolioItem.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Item not found');
    await item.update(data);
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
