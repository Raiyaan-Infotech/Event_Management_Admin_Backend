const { VendorGallery } = require('../models');
const ApiError = require('../utils/apiError');

const getAll = async (vendorId) => {
    return VendorGallery.findAll({
        where: { vendor_id: vendorId },
        order: [['createdAt', 'DESC']],
    });
};

const getById = async (id, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    return item;
};

const create = async (data, vendorId, companyId) => {
    return VendorGallery.create({
        ...data,
        vendor_id:  vendorId,
        company_id: companyId,
    });
};

const update = async (id, data, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    await item.update(data);
    return item;
};

const updateStatus = async (id, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    await item.update({ is_active: item.is_active ? 0 : 1 });
    return item;
};

const remove = async (id, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    await item.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };