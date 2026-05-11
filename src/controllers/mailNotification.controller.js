const notifService = require('../services/mailNotification.service');
const ApiResponse = require('../utils/apiResponse');

const getNotifications = async (req, res) => {
  try {
    const data = await notifService.getUnread(req.mailCaller);
    return ApiResponse.success(res, data, 'Notifications fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const markAllRead = async (req, res) => {
  try {
    await notifService.markAllRead(req.mailCaller);
    return ApiResponse.success(res, null, 'Notifications marked as read.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

module.exports = { getNotifications, markAllRead };
