const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const path = require('path');
const fs = require('fs');
const { Setting } = require('../models');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const COMPRESSIBLE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * Invalidate a specific path in CloudFront (best-effort, non-blocking)
 */
const invalidateCDN = async (config, key) => {
  const distributionId = config.aws_cloudfront_distribution_id;
  if (!distributionId) return;

  try {
    const cf = new CloudFrontClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.aws_access_key || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: config.aws_secret_key || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    await cf.send(new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: { Quantity: 1, Items: [`/${key.replace(/^\//, '')}`] },
      },
    }));

    logger.info(`[CDN_INVALIDATE] Invalidated /${key}`);
  } catch (err) {
    logger.logError(err);
  }
};

/**
 * Get optimize settings from database
 */
const getOptimizeSettings = async () => {
  const settings = await Setting.findAll({
    where: { group: 'optimize', is_active: true },
    attributes: ['key', 'value'],
  });
  const config = {};
  settings.forEach(s => { config[s.key] = s.value; });
  return config;
};

/**
 * Compress image buffer using sharp if enabled
 */
const maybeCompressImage = async (file) => {
  if (!sharp || !COMPRESSIBLE_MIMES.includes(file.mimetype)) {
    return file;
  }
  try {
    const optimizeConfig = await getOptimizeSettings();
    const compressionEnabled = optimizeConfig['optimize.image_compression'] === '1';
    if (!compressionEnabled) return file;

    const quality = Math.min(100, Math.max(1, parseInt(optimizeConfig['optimize.image_quality'] || '80')));
    let compressed;

    if (file.mimetype === 'image/png') {
      compressed = await sharp(file.buffer).png({ quality }).toBuffer();
    } else if (file.mimetype === 'image/webp') {
      compressed = await sharp(file.buffer).webp({ quality }).toBuffer();
    } else {
      // jpeg, gif → convert to jpeg
      compressed = await sharp(file.buffer).jpeg({ quality }).toBuffer();
    }

    return { ...file, buffer: compressed, size: compressed.length };
  } catch (err) {
    logger.logError(err);
    return file; // fallback to original on error
  }
};

/**
 * Get media settings from database
 */
const getMediaSettings = async (companyId = 1) => {
  const settings = await Setting.findAll({
    where: { group: 'media', is_active: 1, company_id: companyId },
    attributes: ['key', 'value'],
  });

  const config = {};
  settings.forEach(s => {
    config[s.key] = s.value;
  });

  return config;
};

/**
 * Create S3 client based on driver settings
 */
const createS3Client = (config) => {
  const clientConfig = {
    region: config.aws_region || 'us-east-1',
    credentials: {
      accessKeyId: config.aws_access_key || process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: config.aws_secret_key || process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  };

  // Custom endpoint for non-AWS S3-compatible services
  if (config.aws_endpoint) {
    clientConfig.endpoint = config.aws_endpoint;
  }

  // Path style for some providers
  if (config.use_path_style_endpoint === 'yes') {
    clientConfig.forcePathStyle = true;
  }

  // Driver-specific endpoint defaults
  switch (config.driver) {
    case 'cloudflare':
      if (!config.aws_endpoint) {
        clientConfig.endpoint = `https://${config.aws_account_id || ''}.r2.cloudflarestorage.com`;
      }
      break;
    case 'digitalocean':
      if (!config.aws_endpoint) {
        clientConfig.endpoint = `https://${config.aws_region || 'nyc3'}.digitaloceanspaces.com`;
      }
      break;
    case 'wasabi':
      if (!config.aws_endpoint) {
        clientConfig.endpoint = `https://s3.${config.aws_region || 'us-east-1'}.wasabisys.com`;
      }
      break;
    case 'backblaze':
      if (!config.aws_endpoint) {
        clientConfig.endpoint = `https://s3.${config.aws_region || 'us-west-004'}.backblazeb2.com`;
      }
      break;
    case 'bunnycdn':
      if (!config.aws_endpoint) {
        clientConfig.endpoint = `https://storage.bunnycdn.com`;
      }
      break;
  }

  return new S3Client(clientConfig);
};

/**
 * Generate unique filename
 */
const generateFilename = (originalName) => {
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${name}-${timestamp}-${random}${ext}`;
};

/**
 * Upload file to configured storage
 */
const upload = async (file, options = {}, companyId = 1) => {
  try {
    // Apply image compression if enabled
    file = await maybeCompressImage(file);

    const config = await getMediaSettings(companyId);
    const driver = config.driver || 'local';
    const folder = options.folder || 'uploads';

    if (options.customPath) {
      // Crop / replace flow: upload under a NEW unique filename so the resulting
      // URL has never been seen by CloudFront (or any CDN).  This guarantees the
      // fresh cropped image is served immediately — no invalidation delay needed.
      // Then delete the old file so no stale version lingers in storage.
      const oldRelPath = options.customPath;
      const dir = path.dirname(oldRelPath);
      const newFilename = generateFilename(path.basename(oldRelPath));
      const newPath = (dir && dir !== '.') ? `${dir}/${newFilename}` : newFilename;

      let result;
      if (driver === 'local') {
        result = await uploadLocal(file, newPath);
        const oldFullPath = path.join(__dirname, '../../uploads', oldRelPath);
        if (fs.existsSync(oldFullPath)) fs.unlinkSync(oldFullPath);
      } else {
        result = await uploadS3(file, newPath, config, false);
        // Best-effort delete of old S3 object — don't fail the whole request if delete fails
        try { await deleteFile(oldRelPath, companyId); } catch (e) { logger.logError(e); }
      }
      return result;
    }

    const filename = generateFilename(file.originalname);
    const filePath = `${folder}/${filename}`;

    if (driver === 'local') {
      return await uploadLocal(file, filePath);
    }

    return await uploadS3(file, filePath, config, false);
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('File upload failed: ' + error.message);
  }
};

/**
 * Upload to local filesystem
 */
const uploadLocal = async (file, filePath) => {
  const uploadDir = path.join(__dirname, '../../uploads', path.dirname(filePath));

  // Create directory if it doesn't exist
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const fullPath = path.join(uploadDir, path.basename(filePath));
  fs.writeFileSync(fullPath, file.buffer);

  // Build absolute URL so the frontend can display it directly without
  // relying on a proxy rewrite. Falls back to relative path if APP_URL not set.
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const url = appUrl ? `${appUrl}/uploads/${filePath}` : `/uploads/${filePath}`;

  return {
    url,
    path: filePath,
    filename: path.basename(filePath),
    size: file.size,
    mimetype: file.mimetype,
    driver: 'local',
  };
};

/**
 * Upload to S3-compatible storage
 */
const uploadS3 = async (file, filePath, config, isOverwrite = false) => {
  const s3Client = createS3Client(config);
  const bucket = config.aws_bucket;

  if (!bucket) {
    throw ApiError.badRequest('Storage bucket is not configured');
  }

  // Prepend custom path if set and only if filePath doesn't already start with it
  let key = filePath;
  if (config.custom_s3_path) {
    const s3Prefix = config.custom_s3_path.replace(/\/+$/, '');
    if (!key.startsWith(`${s3Prefix}/`)) {
      key = `${s3Prefix}/${key}`;
    }
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    CacheControl: 'no-cache, no-store, must-revalidate',
  });

  await s3Client.send(command);

  // If overwriting an existing file, invalidate the CDN cache so it serves fresh content
  if (isOverwrite) {
    await invalidateCDN(config, key);
  }

  // Build the public URL
  let url;
  if (config.aws_url) {
    url = `${config.aws_url.replace(/\/+$/, '')}/${key}`;
  } else {
    url = `https://${bucket}.s3.${config.aws_region || 'us-east-1'}.amazonaws.com/${key}`;
  }

  return {
    url,
    path: key,
    filename: path.basename(filePath),
    size: file.size,
    mimetype: file.mimetype,
    driver: config.driver,
    updated_at: new Date().toISOString(),
  };
};

/**
 * Delete file from storage
 */
const deleteFile = async (filePath, companyId = 1) => {
  try {
    const config = await getMediaSettings(companyId);
    const driver = config.driver || 'local';

    if (driver === 'local') {
      const fullPath = path.join(__dirname, '../../uploads', filePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      return true;
    }

    // S3-compatible delete
    const s3Client = createS3Client(config);
    const key = config.custom_s3_path
      ? `${config.custom_s3_path.replace(/\/+$/, '')}/${filePath}`
      : filePath;

    const command = new DeleteObjectCommand({
      Bucket: config.aws_bucket,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('File deletion failed: ' + error.message);
  }
};

/**
 * Upload multiple files
 */
const uploadMultiple = async (files, options = {}, companyId = 1) => {
  const results = [];
  for (const file of files) {
    const result = await upload(file, options, companyId);
    results.push(result);
  }
  return results;
};

/**
 * List files and folders in a directory
 * folder param = '' means root
 */
const listFiles = async (folder = '', companyId = 1) => {
  try {
    const config = await getMediaSettings(companyId);
    const driver = config.driver || 'local';

    if (driver === 'local') {
      return listFilesLocal(folder);
    }
    return listFilesS3(folder, config);
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('Failed to list files: ' + error.message);
  }
};

const listFilesLocal = (folder) => {
  const base = path.join(__dirname, '../../uploads');
  const dir = folder ? path.join(base, folder) : base;

  if (!fs.existsSync(dir)) {
    return { folders: [], files: [], path: folder };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders = [];
  const files = [];

  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');

  entries.forEach(entry => {
    const relPath = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      folders.push({ name: entry.name, path: relPath, type: 'folder' });
    } else {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', jfif: 'image/jpeg', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav' };
      files.push({
        name: entry.name,
        path: relPath,
        url: appUrl ? `${appUrl}/uploads/${relPath}` : `/uploads/${relPath}`,
        size: stat.size,
        mimetype: mimeMap[ext] || 'application/octet-stream',
        type: 'file',
        created_at: stat.birthtime.toISOString(),
        updated_at: stat.mtime.toISOString(),
      });
    }
  });

  return { folders, files, path: folder, driver: 'local' };
};

const listFilesS3 = async (folder, config) => {
  const s3Client = createS3Client(config);
  const bucket = config.aws_bucket;
  if (!bucket) throw ApiError.badRequest('Storage bucket is not configured');

  const prefix = config.custom_s3_path
    ? folder ? `${config.custom_s3_path}/${folder}/` : `${config.custom_s3_path}/`
    : folder ? `${folder}/` : '';

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/',
  });

  const response = await s3Client.send(command);

  const baseUrl = config.aws_url
    ? config.aws_url.replace(/\/+$/, '')
    : `https://${bucket}.s3.${config.aws_region || 'us-east-1'}.amazonaws.com`;

  const folders = (response.CommonPrefixes || []).map(cp => {
    const fullPrefix = cp.Prefix;
    const name = fullPrefix.replace(prefix, '').replace(/\/$/, '');
    const relPath = folder ? `${folder}/${name}` : name;
    return { name, path: relPath, type: 'folder' };
  });

  const files = (response.Contents || []).filter(obj => {
    // Skip the "folder" marker objects (they end with /)
    return !obj.Key.endsWith('/');
  }).map(obj => {
    const name = path.basename(obj.Key);
    const ext = path.extname(name).toLowerCase().slice(1);
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', jfif: 'image/jpeg', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav' };
    const relKey = config.custom_s3_path ? obj.Key.replace(`${config.custom_s3_path}/`, '') : obj.Key;
    return {
      name,
      path: relKey,
      url: `${baseUrl}/${obj.Key}`,
      size: obj.Size,
      mimetype: mimeMap[ext] || 'application/octet-stream',
      type: 'file',
      created_at: obj.LastModified?.toISOString(),
      updated_at: obj.LastModified?.toISOString(),
    };
  });

  return { folders, files, path: folder, driver: config.driver };
};

/**
 * Create a folder
 */
const createFolder = async (folder, companyId = 1) => {
  try {
    const config = await getMediaSettings(companyId);
    const driver = config.driver || 'local';

    if (driver === 'local') {
      const dir = path.join(__dirname, '../../uploads', folder);
      fs.mkdirSync(dir, { recursive: true });
      return { path: folder, name: path.basename(folder) };
    }

    // S3: create a zero-byte marker object with trailing slash
    const s3Client = createS3Client(config);
    const key = config.custom_s3_path ? `${config.custom_s3_path}/${folder}/` : `${folder}/`;
    await s3Client.send(new PutObjectCommand({
      Bucket: config.aws_bucket,
      Key: key,
      Body: Buffer.alloc(0),
    }));
    return { path: folder, name: path.basename(folder) };
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('Failed to create folder: ' + error.message);
  }
};

/**
 * Copy file (Local or S3)
 */
const copyFile = async (sourcePath, targetFolder, newName, companyId = 1) => {
  try {
    const config = await getMediaSettings(companyId);
    const driver = config.driver || 'local';

    // Normalize paths
    let cleanSource = sourcePath.replace(/^\//, ''); // e.g. "folder/file.jpg"
    let cleanFolder = targetFolder ? targetFolder.replace(/^\/|\/$/g, '') : '';

    // Build relative target path: "folder/newName" or just "newName"
    const targetPath = cleanFolder ? `${cleanFolder}/${newName}` : newName;

    if (driver === 'local') {
      const srcFile = path.join(__dirname, '../../uploads', cleanSource);
      // Only do path.join if targetPath isn't somehow resolving weirdly
      const destFile = path.join(__dirname, '../../uploads', targetPath);

      if (!fs.existsSync(srcFile)) throw new Error(`Source file does not exist: ${srcFile}`);

      const destDir = path.dirname(destFile);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      fs.copyFileSync(srcFile, destFile);

      return { path: targetPath, name: newName, url: `/uploads/${targetPath}` };
    } else {
      // S3
      const s3Client = createS3Client(config);
      const srcKey = config.custom_s3_path ? `${config.custom_s3_path}/${cleanSource}` : cleanSource;
      const tgtKey = config.custom_s3_path ? `${config.custom_s3_path}/${targetPath}` : targetPath;

      await s3Client.send(new CopyObjectCommand({
        Bucket: config.aws_bucket,
        CopySource: encodeURI(`${config.aws_bucket}/${srcKey}`),
        Key: tgtKey
      }));

      const baseUrl = config.aws_url || `https://${config.aws_bucket}.s3.${config.aws_region || 'us-east-1'}.amazonaws.com`;
      return { path: targetPath, name: newName, url: `${baseUrl}/${tgtKey}` };
    }
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('Failed to copy file: ' + error.message);
  }
};

/**
 * Move file (Local or S3)
 */
const moveFile = async (sourcePath, targetFolder, companyId = 1) => {
  try {
    const fileName = path.basename(sourcePath);
    const result = await copyFile(sourcePath, targetFolder, fileName, companyId);
    await deleteFile(sourcePath, companyId);
    return result;
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('Failed to move file: ' + error.message);
  }
};

/**
 * Rename file or folder (Local or S3)
 */
const renameFile = async (pathStr, newName, companyId = 1) => {
  try {
    const targetFolder = path.dirname(pathStr) === '.' ? 'uploads' : path.dirname(pathStr);
    const result = await copyFile(pathStr, targetFolder === 'uploads' ? '' : targetFolder, newName, companyId);
    await deleteFile(pathStr, companyId);
    return result;
  } catch (error) {
    logger.logError(error);
    throw ApiError.internal('Failed to rename file: ' + error.message);
  }
};

module.exports = {
  upload,
  uploadMultiple,
  deleteFile,
  listFiles,
  createFolder,
  getMediaSettings,
  copyFile,
  moveFile,
  renameFile,
  // Aliases used by approval.service.js
  // Media uploads cannot be re-executed from stored data; approval just activates the already-uploaded file
  create: async () => null,
  update: async () => null,
  remove: deleteFile,
};
