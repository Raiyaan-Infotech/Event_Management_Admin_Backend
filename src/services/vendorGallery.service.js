const { VendorGallery } = require('../models');
const ApiError = require('../utils/apiError');
const mediaService = require('./media.service');

const MAX_IMAGES = 10;

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
    const images = Array.isArray(data.images) ? data.images : [];
    if (images.length < 2)          throw ApiError.badRequest('Minimum 2 images required');
    if (images.length > MAX_IMAGES) throw ApiError.badRequest(`Maximum ${MAX_IMAGES} images allowed`);
    const uploadedImages = await mediaService.uploadDataUriArray(images, { folder: 'gallery', originalName: 'gallery' }, companyId);
    return VendorGallery.create({
        event_name: data.event_name,
        city:       data.city,
        images:     uploadedImages,
        img_view:   data.img_view || 'public',
        is_active:  data.is_active !== undefined ? data.is_active : 1,
        created_by: data.created_by,
        vendor_id:  vendorId,
        company_id: companyId,
    });
};

const update = async (id, data, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    if (data.images !== undefined) {
        const images = Array.isArray(data.images) ? data.images : [];
        if (images.length < 2)          throw ApiError.badRequest('Minimum 2 images required');
        if (images.length > MAX_IMAGES) throw ApiError.badRequest(`Maximum ${MAX_IMAGES} images allowed`);
        data.images = await mediaService.uploadDataUriArray(images, { folder: 'gallery', originalName: 'gallery' }, item.company_id);
    }
    await item.update(data);
    return item;
};

const updateStatus = async (id, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    await item.update({ img_view: item.img_view === 'public' ? 'private' : 'public' });
    return item;
};

const remove = async (id, vendorId) => {
    const item = await VendorGallery.findOne({ where: { id, vendor_id: vendorId } });
    if (!item) throw ApiError.notFound('Gallery item not found');
    await item.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };
