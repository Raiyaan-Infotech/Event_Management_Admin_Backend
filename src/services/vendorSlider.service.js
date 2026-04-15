const { VendorSlider, VendorPage } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorSlider';

const PAGE_INCLUDE = {
    model: VendorPage,
    as: 'page',
    attributes: ['id', 'name'],
    required: false,
};

const getAll = async (query = {}, vendorId, companyId = undefined) => {
    return baseService.getAll(VendorSlider, MODEL_NAME, query, {
        searchFields:   ['title', 'description'],
        sortableFields: ['created_at', 'title', 'status', 'type'],
        where:          { vendor_id: vendorId },
        include:        [PAGE_INCLUDE],
        companyId,
        moduleSlug: 'vendor_sliders',
    });
};

const getById = async (id, vendorId) => {
    const slider = await VendorSlider.findOne({
        where:   { id, vendor_id: vendorId },
        include: [PAGE_INCLUDE],
    });
    if (!slider) throw ApiError.notFound('Slider not found');
    return slider;
};

const create = async (data, vendorId, companyId = undefined) => {
    return VendorSlider.create({ ...data, vendor_id: vendorId, company_id: companyId });
};

const update = async (id, data, vendorId) => {
    const slider = await VendorSlider.findOne({ where: { id, vendor_id: vendorId } });
    if (!slider) throw ApiError.notFound('Slider not found');
    await slider.update(data);
    return slider;
};

const updateStatus = async (id, vendorId) => {
    const slider = await VendorSlider.findOne({ where: { id, vendor_id: vendorId } });
    if (!slider) throw ApiError.notFound('Slider not found');
    await slider.update({ is_active: slider.is_active ? 0 : 1 });
    return slider;
};

const remove = async (id, vendorId) => {
    const slider = await VendorSlider.findOne({ where: { id, vendor_id: vendorId } });
    if (!slider) throw ApiError.notFound('Slider not found');
    await slider.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };
