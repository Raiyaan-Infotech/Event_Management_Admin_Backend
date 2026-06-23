const { Op } = require('sequelize');
const { VendorSubscriber } = require('../models');
const baseService = require('./base.service');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'VendorSubscriber';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const getAll = async (query = {}, vendorId) => {
    const customWhere = { vendor_id: vendorId };
    const queryForBase = { ...query };

    if (queryForBase.is_active !== undefined && queryForBase.is_active !== '') {
        customWhere.is_active = Number(queryForBase.is_active);
        delete queryForBase.is_active;
    }

    return baseService.getAll(VendorSubscriber, MODEL_NAME, queryForBase, {
        searchFields: ['email'],
        sortableFields: ['created_at', 'email', 'is_active'],
        where: customWhere,
    });
};

const create = async (data, vendorId, companyId) => {
    const email = normalizeEmail(data.email);
    if (!email) throw ApiError.badRequest('Email is required');

    // Block duplicates per vendor — also reviving a soft-deleted row.
    const existing = await VendorSubscriber.findOne({
        where: { vendor_id: vendorId, email },
        paranoid: false,
    });
    if (existing) {
        if (existing.deletedAt) {
            await existing.restore();
            await existing.update({ is_active: 1 });
            return existing;
        }
        throw ApiError.conflict('This email is already subscribed.');
    }

    return VendorSubscriber.create({
        vendor_id: vendorId,
        company_id: companyId || null,
        email,
        is_active: data.is_active !== undefined ? Number(data.is_active) : 1,
    });
};

const getById = async (id, vendorId) => {
    const record = await VendorSubscriber.findOne({ where: { id, vendor_id: vendorId } });
    if (!record) throw ApiError.notFound('Subscriber not found');
    return record;
};

const update = async (id, data, vendorId) => {
    const record = await getById(id, vendorId);
    const patch = {};

    if (data.email !== undefined) {
        const email = normalizeEmail(data.email);
        if (!email) throw ApiError.badRequest('Email is required');
        if (email !== record.email) {
            const clash = await VendorSubscriber.findOne({
                where: { vendor_id: vendorId, email, id: { [Op.ne]: id } },
                paranoid: false,
            });
            if (clash) throw ApiError.conflict('This email is already subscribed.');
        }
        patch.email = email;
    }
    if (data.is_active !== undefined) patch.is_active = Number(data.is_active);

    await record.update(patch);
    return record;
};

const remove = async (id, vendorId) => {
    const record = await getById(id, vendorId);
    await record.destroy();
};

module.exports = { getAll, create, getById, update, remove, normalizeEmail };
