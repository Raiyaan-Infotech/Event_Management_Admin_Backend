const { Op, literal } = require('sequelize');
const { VendorClient, VendorNewsletterSend, VendorNewsletterSentLog } = require('../models');

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

const toggleClientType = async (vendorId, id) => {
    const client = await VendorClient.findOne({ where: { id, vendor_id: vendorId } });
    if (!client) throw new Error('Client not found');
    await client.update({ client_type: client.client_type === 'subscribed' ? 'unsubscribed' : 'subscribed' });
    return client;
};

const bulkUpdateClientType = async (vendorId, from, to) => {
    const [count] = await VendorClient.update(
        { client_type: to },
        { where: { vendor_id: vendorId, client_type: from } }
    );
    return count;
};

const bulkUpdateByIds = async (vendorId, ids, clientType) => {
    const [count] = await VendorClient.update(
        { client_type: clientType },
        { where: { vendor_id: vendorId, id: { [Op.in]: ids } } }
    );
    return count;
};

const createSend = async (vendorId, companyId, data) => {
    return VendorNewsletterSend.create({
        vendor_id:     vendorId,
        company_id:    companyId || null,
        template_id:   data.templateId,
        template_name: data.templateName,
        category_id:   data.categoryId || null,
        user_type:     data.userType,
        plans:         data.plans && data.plans.length > 0 ? data.plans : null,
        total_sent:    data.totalSent,
        created_by:    vendorId,
    });
};

const getNewsletterSends = async (vendorId) => {
    return VendorNewsletterSend.findAll({
        where: { vendor_id: vendorId },
        attributes: [
            'id', 'template_id', 'template_name', 'user_type', 'plans', 'total_sent', 'createdAt',
            [literal(`(SELECT COUNT(*) FROM vendor_newsletter_sent_logs WHERE campaign_id = VendorNewsletterSend.id AND status = 'sent')`),   'success_count'],
            [literal(`(SELECT COUNT(*) FROM vendor_newsletter_sent_logs WHERE campaign_id = VendorNewsletterSend.id AND status = 'failed')`), 'failed_count'],
            [literal(`(SELECT COUNT(*) FROM vendor_newsletter_sent_logs WHERE campaign_id = VendorNewsletterSend.id AND opened_at IS NOT NULL)`), 'read_count'],
            [literal(`(SELECT COUNT(*) FROM vendor_newsletter_sent_logs WHERE campaign_id = VendorNewsletterSend.id AND opened_at IS NULL AND status = 'sent')`), 'unread_count'],
        ],
        order: [['createdAt', 'DESC']],
    });
};

const createSentLog = async (vendorId, sendId, clientId, email, name, membership, template) => {
    return VendorNewsletterSentLog.create({
        vendor_id:   vendorId,
        campaign_id: sendId,
        client_id:   clientId,
        email,
        name,
        membership,
        template,
        status: 'sent',
    });
};

const getSentLogs = async (vendorId, newsletterId = null) => {
    const where = { vendor_id: vendorId };
    if (newsletterId) where.campaign_id = newsletterId;

    const logs = await VendorNewsletterSentLog.findAll({
        where,
        include: [{
            model: VendorClient,
            as: 'client',
            attributes: ['id', 'client_type'],
            required: false,
        }],
        order: [['createdAt', 'DESC']],
    });

    return logs.map((log) => {
        const json = log.toJSON();
        json.client_type = json.client?.client_type || null;
        delete json.client;
        return json;
    });
};

const markAsOpened = async (logId) => {
    return VendorNewsletterSentLog.update(
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
    createSend,
    getNewsletterSends,
    createSentLog,
    getSentLogs,
    markAsOpened,
};
