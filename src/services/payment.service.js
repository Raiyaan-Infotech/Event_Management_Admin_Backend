const { Payment, User } = require('../models');
const { Op } = require('sequelize');
const { parsePagination, getPaginationMeta } = require('../utils/helpers');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALLOWED_STATUSES = ['pending', 'completed', 'failed', 'refunded', 'cancelled'];

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Get paginated list of payments for a company
 */
const getAll = async (companyId, query = {}) => {
    const { page, limit, offset } = parsePagination(query);
    const { status, gateway, search } = query;

    const where = { company_id: companyId };

    if (status && ALLOWED_STATUSES.includes(status)) {
        where.status = status;
    }
    if (gateway) {
        where.gateway = gateway;
    }
    if (search) {
        where[Op.or] = [
            { gateway_transaction_id: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
        ];
    }

    const { count, rows } = await Payment.findAndCountAll({
        where,
        include: [
            {
                model: User,
                as: 'user',
                attributes: ['id', 'name', 'email'],
                required: false,
            },
        ],
        order: [['created_at', 'DESC']],
        limit,
        offset,
    });

    return {
        payments: rows,
        pagination: getPaginationMeta(count, page, limit),
    };
};

/**
 * Get a single payment by ID
 */
const getById = async (id, companyId) => {
    const payment = await Payment.findOne({
        where: { id, company_id: companyId },
        include: [
            {
                model: User,
                as: 'user',
                attributes: ['id', 'name', 'email'],
                required: false,
            },
        ],
    });

    if (!payment) {
        const error = new Error('Payment not found');
        error.statusCode = 404;
        throw error;
    }

    return payment;
};

/**
 * Create a payment record
 */
const create = async (data, companyId, userId = null) => {
    const payment = await Payment.create({
        ...data,
        company_id: companyId,
        status: data.status || 'pending',
    });
    await logger.logActivity(userId, 'create', 'Payment', `Created payment #${payment.id}`, { recordId: payment.id, companyId });
    return payment;
};

/**
 * Update payment status
 */
const updateStatus = async (id, status, companyId, userId = null) => {
    if (!ALLOWED_STATUSES.includes(status)) {
        const error = new Error(`Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }

    const payment = await Payment.findOne({ where: { id, company_id: companyId } });
    if (!payment) {
        const error = new Error('Payment not found');
        error.statusCode = 404;
        throw error;
    }

    const oldStatus = payment.status;
    await payment.update({ status });
    await logger.logActivity(userId, 'update_status', 'Payment', `Payment #${id} status changed from ${oldStatus} to ${status}`, { recordId: id, companyId, oldValues: { status: oldStatus }, newValues: { status } });
    return payment;
};

/**
 * Get summary stats for a company
 */
const getStats = async (companyId) => {
    const { sequelize } = require('../models');
    const { QueryTypes } = require('sequelize');

    const rows = await sequelize.query(
        `SELECT
       status,
       COUNT(*)          AS count,
       COALESCE(SUM(amount), 0) AS total
     FROM payments
     WHERE company_id = :companyId AND deleted_at IS NULL
     GROUP BY status`,
        {
            replacements: { companyId },
            type: QueryTypes.SELECT,
        }
    );

    const stats = {
        total_count: 0,
        total_revenue: 0,
        pending: { count: 0, total: 0 },
        completed: { count: 0, total: 0 },
        failed: { count: 0, total: 0 },
        refunded: { count: 0, total: 0 },
        cancelled: { count: 0, total: 0 },
    };

    for (const row of rows) {
        stats[row.status] = { count: Number(row.count), total: Number(row.total) };
        stats.total_count += Number(row.count);
        stats.total_revenue += row.status === 'completed' ? Number(row.total) : 0;
    }

    return stats;
};

module.exports = { getAll, getById, create, updateStatus, getStats };
