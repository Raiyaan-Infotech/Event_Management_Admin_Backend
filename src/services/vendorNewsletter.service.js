const { VendorClient } = require('../models');

const getSubscribers = async (vendorId) => {
    return VendorClient.findAll({
        where: { vendor_id: vendorId, client_type: 'subscribed' },
        attributes: ['id', 'name', 'email', 'plan', 'client_type', 'registration_type', 'is_active'],
        order: [['created_at', 'DESC']],
    });
};

const getUnsubscribers = async (vendorId) => {
    return VendorClient.findAll({
        where: { vendor_id: vendorId, client_type: 'unsubscribed' },
        attributes: ['id', 'name', 'email', 'plan', 'client_type', 'registration_type', 'is_active'],
        order: [['created_at', 'DESC']],
    });
};

// Toggle a single client's client_type
const toggleClientType = async (id, vendorId) => {
    const client = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!client) throw new Error('Client not found');
    const newType = client.client_type === 'subscribed' ? 'unsubscribed' : 'subscribed';
    await client.update({ client_type: newType });
    return client;
};

// Bulk-flip: all subscribed → unsubscribed, or all unsubscribed → subscribed
const bulkUpdateClientType = async (from, to, vendorId) => {
    const [affectedCount] = await VendorClient.update(
        { client_type: to },
        { where: { vendor_id: vendorId, client_type: from } }
    );
    return affectedCount;
};

// Bulk-update a specific list of client IDs to a given client_type
const bulkUpdateByIds = async (ids, clientType, vendorId) => {
    const { Op } = require('sequelize');
    const [affectedCount] = await VendorClient.update(
        { client_type: clientType },
        { where: { vendor_id: vendorId, id: { [Op.in]: ids } } }
    );
    return affectedCount;
};

const createSentLog = async (vendorId, campaignId, clientId, email, name, membership, template) => {
    const VendorNewsletterSentLog = require('../models').VendorNewsletterSentLog;
    return await VendorNewsletterSentLog.create({
        vendor_id: vendorId,
        campaign_id: campaignId,
        client_id: clientId,
        email,
        name,
        membership,
        template,
        status: 'sent',
    });
};

const getSentLogs = async (vendorId) => {
    const VendorNewsletterSentLog = require('../models').VendorNewsletterSentLog;
    return await VendorNewsletterSentLog.findAll({
        where: { vendor_id: vendorId },
        order: [['createdAt', 'DESC']],
    });
};

const markAsOpened = async (logId) => {
    const VendorNewsletterSentLog = require('../models').VendorNewsletterSentLog;
    return await VendorNewsletterSentLog.update(
        { opened_at: new Date() },
        { where: { id: logId } }
    );
};

module.exports = {
    getSubscribers,
    getUnsubscribers,
    toggleClientType,
    bulkUpdateClientType,
    bulkUpdateByIds,
    createSentLog,
    getSentLogs,
    markAsOpened,
};
