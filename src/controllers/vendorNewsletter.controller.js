const vendorNewsletterService = require('../services/vendorNewsletter.service');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');

exports.getSubscribers = async (req, res) => {
  try {
    const data = await vendorNewsletterService.getSubscribers(req.vendor.id);
    ApiResponse.success(res, data, 'Subscribers fetched', 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to fetch subscribers', 400);
  }
};

exports.getUnsubscribers = async (req, res) => {
  try {
    const data = await vendorNewsletterService.getUnsubscribers(req.vendor.id);
    ApiResponse.success(res, data, 'Unsubscribers fetched', 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to fetch unsubscribers', 400);
  }
};

exports.toggleClientType = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await vendorNewsletterService.toggleClientType(req.vendor.id, id);
    ApiResponse.success(res, result, 'Subscription toggled', 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to toggle subscription', 400);
  }
};

exports.bulkUpdateClientType = async (req, res) => {
  try {
    const { from, to } = req.body;
    const result = await vendorNewsletterService.bulkUpdateClientType(req.vendor.id, from, to);
    ApiResponse.success(res, result, 'Bulk update successful', 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to bulk update', 400);
  }
};

exports.bulkUpdateByIds = async (req, res) => {
  try {
    const { ids, client_type } = req.body;
    const result = await vendorNewsletterService.bulkUpdateByIds(req.vendor.id, ids, client_type);
    ApiResponse.success(res, result, 'Bulk update successful', 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to bulk update', 400);
  }
};

exports.sendNewsletter = async (req, res) => {
  try {
    const { user_type: userType, plans, category_id: categoryId, template_id: templateId } = req.body;
    const db = require('../models');
    const { Op } = require('sequelize');

    const template = await db.VendorEmailTemplate.findByPk(templateId);
    if (!template) return ApiResponse.notFound(res, 'Template not found');

    let where = { vendor_id: req.vendor.id, client_type: 'subscribed' };
    if (userType === 'Registered') {
      where.registration_type = 'client';
      if (plans && plans.length > 0) {
        where.plan = { [Op.in]: plans };
      }
    } else if (userType === 'Guest') {
      where.registration_type = 'guest';
    }

    const subscribers = await db.VendorClient.findAll({ where });

    const campaignId = Math.floor(Date.now() / 1000);
    let count = 0;
    for (const client of subscribers) {
      await vendorNewsletterService.createSentLog(
        req.vendor.id,
        campaignId,
        client.id,
        client.email,
        client.name,
        client.registration_type === 'guest' ? 'Guest' : (client.plan || 'Standard'),
        template.name
      );
      count++;
    }

    ApiResponse.success(res, { campaignId, count }, `Newsletter sent to ${count} recipients`, 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to send newsletter', 400);
  }
};

exports.getSentLogs = async (req, res) => {
  try {
    const data = await vendorNewsletterService.getSentLogs(req.vendor.id);
    ApiResponse.success(res, data, 'Sent logs fetched', 200);
  } catch (err) {
    ApiResponse.error(res, err.message || 'Failed to fetch sent logs', 400);
  }
};
