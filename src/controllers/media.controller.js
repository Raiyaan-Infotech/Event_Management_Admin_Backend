const mediaService = require('../services/media.service');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');

/**
 * Upload single file
 * POST /api/v1/media/upload
 */
const upload = asyncHandler(async (req, res) => {
  if (!req.file) {
    return ApiResponse.error(res, 'No file provided', 400);
  }

  const result = await mediaService.upload(req.file, {
    folder: req.body.folder || 'uploads',
    customPath: req.body.path || undefined
  }, req.companyId);

  logger.logRequest(req, 'File uploaded');
  return ApiResponse.success(res, { file: result }, 'File uploaded successfully');
});

/**
 * Upload multiple files
 * POST /api/v1/media/upload-multiple
 */
const uploadMultiple = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return ApiResponse.error(res, 'No files provided', 400);
  }

  const results = await mediaService.uploadMultiple(req.files, {
    folder: req.body.folder || 'uploads',
  }, req.companyId);

  logger.logRequest(req, `${results.length} files uploaded`);
  return ApiResponse.success(res, { files: results }, 'Files uploaded successfully');
});

/**
 * Delete file
 * DELETE /api/v1/media
 */
const deleteFile = asyncHandler(async (req, res) => {
  const { path } = req.body;

  if (!path) {
    return ApiResponse.error(res, 'File path is required', 400);
  }

  await mediaService.deleteFile(path, req.companyId);

  logger.logRequest(req, 'File deleted');
  return ApiResponse.success(res, null, 'File deleted successfully');
});

/**
 * List files in a folder
 * GET /api/v1/media/files?folder=uploads/avatars
 */
const listFiles = asyncHandler(async (req, res) => {
  const folder = req.query.folder || '';
  const result = await mediaService.listFiles(folder, req.companyId);
  return ApiResponse.success(res, result, 'Files listed successfully');
});

/**
 * Create a folder
 * POST /api/v1/media/folder
 */
const createFolder = asyncHandler(async (req, res) => {
  const { folder } = req.body;
  if (!folder) return ApiResponse.error(res, 'Folder path is required', 400);
  const result = await mediaService.createFolder(folder, req.companyId);
  return ApiResponse.success(res, result, 'Folder created successfully');
});

/**
 * Rename a file
 * POST /api/v1/media/rename
 */
const renameFile = asyncHandler(async (req, res) => {
  const { path: pathStr, new_name: newName } = req.body;
  if (!pathStr || !newName) return ApiResponse.error(res, 'Path and newName are required', 400);
  const result = await mediaService.renameFile(pathStr, newName, req.companyId);
  return ApiResponse.success(res, result, 'File renamed successfully');
});

/**
 * Copy a file
 * POST /api/v1/media/copy
 */
const copyFile = asyncHandler(async (req, res) => {
  const { path: sourcePath, target_folder: targetFolder, new_name: newName } = req.body;
  if (!sourcePath || !newName) return ApiResponse.error(res, 'sourcePath and newName are required', 400);
  const result = await mediaService.copyFile(sourcePath, targetFolder || '', newName, req.companyId);
  return ApiResponse.success(res, result, 'File copied successfully');
});

/**
 * Move a file
 * POST /api/v1/media/move
 */
const moveFile = asyncHandler(async (req, res) => {
  const { path: sourcePath, target_folder: targetFolder } = req.body;
  if (!sourcePath || targetFolder === undefined) return ApiResponse.error(res, 'sourcePath and targetFolder are required', 400);
  const result = await mediaService.moveFile(sourcePath, targetFolder, req.companyId);
  return ApiResponse.success(res, result, 'File moved successfully');
});

module.exports = {
  upload,
  uploadMultiple,
  deleteFile,
  listFiles,
  createFolder,
  renameFile,
  copyFile,
  moveFile,
};