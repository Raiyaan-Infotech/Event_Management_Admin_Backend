const { VendorPage } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorPage';

const getAll = async (query = {}, vendorId, companyId = undefined) => {
    return baseService.getAll(VendorPage, MODEL_NAME, query, {
        searchFields:  ['name', 'description'],
        sortableFields: ['created_at', 'name', 'status'],
        where: { vendor_id: vendorId },
        companyId,
        moduleSlug: 'vendor_pages',
    });
};

const getById = async (id, vendorId, companyId = undefined) => {
    const page = await VendorPage.findOne({ where: { id, vendor_id: vendorId } });
    if (!page) throw ApiError.notFound('Page not found');
    return page;
};

const create = async (data, vendorId, companyId = undefined) => {
    const existing = await VendorPage.findOne({ where: { name: data.name, vendor_id: vendorId } });
    if (existing) throw ApiError.conflict('A page with this name already exists');
    return VendorPage.create({ ...data, vendor_id: vendorId, company_id: companyId });
};

const update = async (id, data, vendorId, companyId = undefined) => {
    const page = await VendorPage.findOne({ where: { id, vendor_id: vendorId } });
    if (!page) throw ApiError.notFound('Page not found');

    if (data.name && data.name !== page.name) {
        const { Op } = require('sequelize');
        const existing = await VendorPage.findOne({
            where: { name: data.name, vendor_id: vendorId, id: { [Op.ne]: id } },
        });
        if (existing) throw ApiError.conflict('A page with this name already exists');
    }

    await page.update(data);
    return page;
};

const updateStatus = async (id, status, vendorId) => {
    const page = await VendorPage.findOne({ where: { id, vendor_id: vendorId } });
    if (!page) throw ApiError.notFound('Page not found');
    await page.update({ is_active: page.is_active ? 0 : 1 });
    return page;
};

const remove = async (id, vendorId) => {
    const page = await VendorPage.findOne({ where: { id, vendor_id: vendorId } });
    if (!page) throw ApiError.notFound('Page not found');
    await page.destroy();
    return true;
};

module.exports = { getAll, getById, create, update, updateStatus, remove };