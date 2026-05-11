const mailService = require('../services/mail.service');
const contactService = require('../services/mailContact.service');
const ApiResponse = require('../utils/apiResponse');

const getContacts = async (req, res) => {
  try {
    const contacts = await contactService.getContacts(req.mailCaller);
    return ApiResponse.success(res, contacts, 'Contacts fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const saveDraft = async (req, res) => {
  try {
    const mail = await mailService.saveDraft(req.mailCaller, req.body);
    return ApiResponse.created(res, mail, 'Draft saved.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const updateDraft = async (req, res) => {
  try {
    const mail = await mailService.updateDraft(req.mailCaller, req.params.id, req.body);
    return ApiResponse.success(res, mail, 'Draft updated.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const sendMail = async (req, res) => {
  try {
    const mail = await mailService.sendMail(req.mailCaller, req.body);
    return ApiResponse.created(res, mail, 'Mail sent.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const sendDraft = async (req, res) => {
  try {
    const mail = await mailService.sendDraft(req.mailCaller, req.params.id, req.body);
    return ApiResponse.success(res, mail, 'Draft sent.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const getInbox = async (req, res) => {
  try {
    const data = await mailService.getInbox(req.mailCaller, req.query);
    return ApiResponse.success(res, data, 'Inbox fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const getSent = async (req, res) => {
  try {
    const data = await mailService.getSent(req.mailCaller, req.query);
    return ApiResponse.success(res, data, 'Sent mails fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const getDrafts = async (req, res) => {
  try {
    const data = await mailService.getDrafts(req.mailCaller, req.query);
    return ApiResponse.success(res, data, 'Drafts fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const getById = async (req, res) => {
  try {
    const result = await mailService.getById(req.mailCaller, req.params.id);
    if (!result) return ApiResponse.notFound(res, 'Mail not found.');
    return ApiResponse.success(res, result, 'Mail fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const remove = async (req, res) => {
  try {
    await mailService.moveToTrash(req.mailCaller, req.params.id);
    return ApiResponse.success(res, null, 'Moved to trash.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const bulkRemove = async (req, res) => {
  try {
    const { ids } = req.body;
    await mailService.bulkMoveToTrash(req.mailCaller, ids);
    return ApiResponse.success(res, null, 'Moved to trash.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const getTrash = async (req, res) => {
  try {
    const data = await mailService.getTrash(req.mailCaller);
    return ApiResponse.success(res, data, 'Trash fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const restore = async (req, res) => {
  try {
    await mailService.restoreFromTrash(req.mailCaller, req.params.id);
    return ApiResponse.success(res, null, 'Mail restored.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const permanentDelete = async (req, res) => {
  try {
    await mailService.permanentDelete(req.mailCaller, req.params.id);
    return ApiResponse.success(res, null, 'Mail permanently deleted.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const toggleRead = async (req, res) => {
  try {
    await mailService.toggleRead(req.mailCaller, req.params.id);
    return ApiResponse.success(res, null, 'Read status updated.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const bulkMarkRead = async (req, res) => {
  try {
    const { ids, is_read } = req.body;
    await mailService.bulkMarkRead(req.mailCaller, ids, is_read);
    return ApiResponse.success(res, null, 'Read status updated.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const assignLabel = async (req, res) => {
  try {
    const { label } = req.body;
    await mailService.assignLabel(req.mailCaller, req.params.id, label);
    return ApiResponse.success(res, null, 'Label assigned.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const bulkAssignLabel = async (req, res) => {
  try {
    const { ids, label } = req.body;
    await mailService.bulkAssignLabel(req.mailCaller, ids, label);
    return ApiResponse.success(res, null, 'Labels assigned.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const moveToFolder = async (req, res) => {
  try {
    const { folder_id } = req.body;
    await mailService.moveToFolder(req.mailCaller, req.params.id, folder_id);
    return ApiResponse.success(res, null, 'Mail moved to folder.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const bulkMoveToFolder = async (req, res) => {
  try {
    const { ids, folder_id } = req.body;
    await mailService.bulkMoveToFolder(req.mailCaller, ids, folder_id);
    return ApiResponse.success(res, null, 'Mails moved to folder.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const getFolders = async (req, res) => {
  try {
    const data = await mailService.getFolders(req.mailCaller);
    return ApiResponse.success(res, data, 'Folders fetched.');
  } catch (e) {
    return ApiResponse.error(res, e.message);
  }
};

const createFolder = async (req, res) => {
  try {
    const folder = await mailService.createFolder(req.mailCaller, req.body.name);
    return ApiResponse.created(res, folder, 'Folder created.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const updateFolder = async (req, res) => {
  try {
    const folder = await mailService.updateFolder(req.mailCaller, req.params.id, req.body);
    return ApiResponse.success(res, folder, 'Folder updated.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

const deleteFolder = async (req, res) => {
  try {
    await mailService.deleteFolder(req.mailCaller, req.params.id);
    return ApiResponse.success(res, null, 'Folder deleted.');
  } catch (e) {
    return ApiResponse.error(res, e.message, 400);
  }
};

module.exports = {
  getContacts,
  saveDraft,
  updateDraft,
  sendMail,
  sendDraft,
  getInbox,
  getSent,
  getDrafts,
  getById,
  remove,
  bulkRemove,
  getTrash,
  restore,
  permanentDelete,
  toggleRead,
  bulkMarkRead,
  assignLabel,
  bulkAssignLabel,
  moveToFolder,
  bulkMoveToFolder,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
};
