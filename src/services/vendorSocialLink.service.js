const { VendorSocialLink, sequelize } = require('../models');
const { Op } = require('sequelize');
const ApiError = require('../utils/apiError');

// Assigns clean 1-based sequential sort_orders — call inside any transaction
// that touches sort_order to guarantee no gaps and no duplicates.
const resequence = async (vendorId, t) => {
    const items = await VendorSocialLink.findAll({
        where: { vendor_id: vendorId },
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE,
    });
    for (let i = 0; i < items.length; i++) {
        const expected = i + 1;
        if (items[i].sort_order !== expected) {
            await items[i].update({ sort_order: expected }, { transaction: t });
        }
    }
};

const getAll = async (vendorId) => {
    return VendorSocialLink.findAll({
        where: { vendor_id: vendorId },
        order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
};

const getById = async (vendorId, id) => {
    const link = await VendorSocialLink.findOne({ where: { id, vendor_id: vendorId } });
    if (!link) throw ApiError.notFound('Social link not found');
    return link;
};

const create = async (vendorId, data) => {
    return sequelize.transaction(async (t) => {
        // Lock all rows for this vendor so concurrent creates can't race
        const count = await VendorSocialLink.count({
            where: { vendor_id: vendorId },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        // User-supplied sort_order: clamp to valid range; 0 or missing → append
        const requested = data.sort_order && data.sort_order > 0 ? data.sort_order : count + 1;
        const insertAt  = Math.min(Math.max(requested, 1), count + 1);

        // Shift existing items at or after the target position up by 1
        await VendorSocialLink.increment('sort_order', {
            by: 1,
            where: { vendor_id: vendorId, sort_order: { [Op.gte]: insertAt } },
            transaction: t,
        });

        const link = await VendorSocialLink.create({
            vendor_id:  vendorId,
            icon:       data.icon       || null,
            icon_color: data.icon_color || null,
            label:      data.label,
            url:        data.url,
            is_active:  data.is_active !== undefined ? data.is_active : 1,
            sort_order: insertAt,
        }, { transaction: t });

        // Normalize — wipes out any pre-existing duplicates or gaps
        await resequence(vendorId, t);

        return link;
    });
};

const update = async (vendorId, id, data) => {
    return sequelize.transaction(async (t) => {
        const link = await VendorSocialLink.findOne({
            where: { id, vendor_id: vendorId },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        if (!link) throw ApiError.notFound('Social link not found');

        const allowed = ['icon', 'icon_color', 'label', 'url', 'is_active', 'sort_order'];
        const filtered = {};
        for (const key of allowed) {
            if (data[key] !== undefined) filtered[key] = data[key];
        }

        const orderChanging =
            data.sort_order !== undefined && data.sort_order !== link.sort_order;

        if (orderChanging) {
            const count    = await VendorSocialLink.count({ where: { vendor_id: vendorId }, transaction: t });
            const oldOrder = link.sort_order;
            const newOrder = Math.min(Math.max(data.sort_order, 1), count);

            filtered.sort_order = newOrder;

            if (newOrder > oldOrder) {
                // Moving down: shift items between old+1 and newOrder back by 1
                await VendorSocialLink.decrement('sort_order', {
                    by: 1,
                    where: {
                        vendor_id: vendorId,
                        sort_order: { [Op.gt]: oldOrder, [Op.lte]: newOrder },
                        id: { [Op.ne]: id },
                    },
                    transaction: t,
                });
            } else {
                // Moving up: shift items between newOrder and old-1 forward by 1
                await VendorSocialLink.increment('sort_order', {
                    by: 1,
                    where: {
                        vendor_id: vendorId,
                        sort_order: { [Op.gte]: newOrder, [Op.lt]: oldOrder },
                        id: { [Op.ne]: id },
                    },
                    transaction: t,
                });
            }
        }

        await link.update(filtered, { transaction: t });

        // Always resequence so any drift or pre-existing duplicates are cleaned up
        await resequence(vendorId, t);

        return link;
    });
};

const toggleActive = async (vendorId, id) => {
    const link = await VendorSocialLink.findOne({ where: { id, vendor_id: vendorId } });
    if (!link) throw ApiError.notFound('Social link not found');
    await link.update({ is_active: link.is_active ? 0 : 1 });
    return link;
};

const remove = async (vendorId, id) => {
    return sequelize.transaction(async (t) => {
        const link = await VendorSocialLink.findOne({
            where: { id, vendor_id: vendorId },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        if (!link) throw ApiError.notFound('Social link not found');
        await link.destroy({ transaction: t });
        // Close the gap left by the deleted item
        await resequence(vendorId, t);
    });
};

module.exports = { getAll, getById, create, update, toggleActive, remove };
