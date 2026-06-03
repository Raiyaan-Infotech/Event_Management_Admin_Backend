const { VendorHeroSection } = require('../models');
const mediaService = require('./media.service');

const EDITABLE_FIELDS = [
    'title',
    'heading',
    'description',
    'button',
    'button2',
    'image_url',
    'bg_image_url',
    'page_id',
    'page_id2',
    'variant',
    'stat1_val',
    'stat1_lbl',
    'stat1_sub',
    'stat2_val',
    'stat2_lbl',
    'stat2_sub',
    'stat3_val',
    'stat3_lbl',
    'stat3_sub',
    'is_active',
];

const normalizeInput = async (data, companyId) => {
    const filtered = {};
    for (const field of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            filtered[field] = data[field];
        }
    }

    for (const field of ['page_id', 'page_id2']) {
        if (filtered[field] === '' || filtered[field] === undefined) {
            filtered[field] = null;
        }
    }

    return mediaService.uploadDataUriFields(
        filtered,
        ['image_url', 'bg_image_url'],
        { folder: 'hero-section' },
        companyId,
    );
};

const get = async (vendorId) => {
    return VendorHeroSection.findOne({ where: { vendor_id: vendorId } });
};

const upsert = async (data, vendorId, companyId, userId) => {
    const normalized = await normalizeInput(data, companyId);
    const existing = await VendorHeroSection.findOne({
        where: { vendor_id: vendorId },
        paranoid: false,
    });

    if (existing) {
        if (existing.deletedAt) await existing.restore();
        await existing.update({
            ...normalized,
            company_id: companyId,
            updated_by: userId,
        });
        return existing;
    }

    return VendorHeroSection.create({
        ...normalized,
        vendor_id: vendorId,
        company_id: companyId,
        created_by: userId,
        updated_by: userId,
    });
};

module.exports = { get, upsert };
