const jwt = require('jsonwebtoken');
const axios = require('axios');
const { PushNotificationConfig, Sequelize } = require('../models');
const { Op } = Sequelize;
const baseService = require('./base.service');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

const MODEL_NAME = 'PushNotificationConfig';

/**
 * Parse Service Account JSON safely and extract relevant fields.
 */
const parseServiceAccountJson = (jsonString) => {
  if (!jsonString) return null;
  try {
    const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    if (parsed.type && parsed.type !== 'service_account') {
      throw new Error('JSON is not a Google service_account credential file.');
    }
    return {
      project_id: parsed.project_id || null,
      client_email: parsed.client_email || null,
      private_key: parsed.private_key || null,
      raw_json: typeof jsonString === 'string' ? jsonString : JSON.stringify(jsonString, null, 2),
    };
  } catch (err) {
    throw ApiError.badRequest(`Invalid Service Account JSON: ${err.message}`);
  }
};

/**
 * Automated Handshake: Validates Google Cloud OAuth2 service account token endpoint.
 */
const performHandshake = async (clientEmail, privateKey) => {
  if (!clientEmail || !privateKey) {
    return {
      success: false,
      error: 'Client email or private key is missing.',
    };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const signedJwt = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

    const params = new URLSearchParams();
    params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.append('assertion', signedJwt);

    const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
    });

    if (response.data && response.data.access_token) {
      return { success: true };
    }
    return { success: false, error: 'Token response did not include access_token.' };
  } catch (err) {
    const errorMsg = err.response?.data?.error_description || err.response?.data?.error || err.message;
    return { success: false, error: errorMsg };
  }
};

/**
 * Get all push notification configs with pagination and search
 */
const getAll = async (query = {}) => {
  return baseService.getAll(PushNotificationConfig, MODEL_NAME, query, {
    searchFields: ['name', 'project_id', 'client_email'],
    sortableFields: ['created_at', 'name', 'is_active', 'last_verified_at'],
  });
};

/**
 * Get active routing project configuration
 */
const getActive = async () => {
  try {
    const config = await PushNotificationConfig.findOne({
      where: { is_active: true },
    });
    logger.logDB('getActive', MODEL_NAME);
    return config;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Get push notification config by ID
 */
const getById = async (id) => {
  return baseService.getById(PushNotificationConfig, MODEL_NAME, id);
};

/**
 * Create new push notification config
 */
const create = async (data, userId = null) => {
  try {
    const {
      name,
      is_active = false,
      service_account_json,
      project_id,
      web_api_key,
      app_id,
      messaging_sender_id,
      auth_domain,
      storage_bucket,
      measurement_id,
      vapid_key,
    } = data;

    if (!name || !name.trim()) {
      throw ApiError.badRequest('Configuration Label / Name is required');
    }

    let extractedProjectId = project_id;
    let clientEmail = null;
    let privateKey = null;
    let rawJson = null;

    if (service_account_json && service_account_json.trim()) {
      const parsed = parseServiceAccountJson(service_account_json.trim());
      if (parsed) {
        extractedProjectId = parsed.project_id || extractedProjectId;
        clientEmail = parsed.client_email;
        privateKey = parsed.private_key;
        rawJson = parsed.raw_json;
      }
    }

    // Auto-set as active if this is the very first project
    const count = await PushNotificationConfig.count();
    const shouldBeActive = Boolean(is_active) || count === 0;

    const payload = {
      name: name.trim(),
      is_active: shouldBeActive,
      service_account_json: rawJson,
      project_id: extractedProjectId ? extractedProjectId.trim() : null,
      client_email: clientEmail,
      private_key: privateKey,
      web_api_key: web_api_key ? web_api_key.trim() : null,
      app_id: app_id ? app_id.trim() : null,
      messaging_sender_id: messaging_sender_id ? messaging_sender_id.trim() : null,
      auth_domain: auth_domain ? auth_domain.trim() : null,
      storage_bucket: storage_bucket ? storage_bucket.trim() : null,
      measurement_id: measurement_id ? measurement_id.trim() : null,
      vapid_key: vapid_key ? vapid_key.trim() : null,
      connection_status: 'pending',
    };

    const config = await baseService.create(PushNotificationConfig, MODEL_NAME, payload, userId);

    // If credentials provided, perform handshake
    if (clientEmail && privateKey) {
      const handshake = await performHandshake(clientEmail, privateKey);
      if (handshake.success) {
        config.connection_status = 'connected';
        config.last_verified_at = new Date();
        config.validation_error = null;
      } else {
        config.connection_status = 'error';
        config.validation_error = handshake.error;
      }
      await config.save();
    }

    return config;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update push notification config
 */
const update = async (id, data, userId = null) => {
  try {
    const config = await baseService.getById(PushNotificationConfig, MODEL_NAME, id);

    const {
      name,
      is_active,
      service_account_json,
      project_id,
      web_api_key,
      app_id,
      messaging_sender_id,
      auth_domain,
      storage_bucket,
      measurement_id,
      vapid_key,
    } = data;

    if (name !== undefined) {
      if (!name || !name.trim()) throw ApiError.badRequest('Configuration Label / Name cannot be empty');
      config.name = name.trim();
    }

    if (is_active !== undefined) {
      config.is_active = Boolean(is_active);
    }

    if (project_id !== undefined) config.project_id = project_id ? project_id.trim() : null;
    if (web_api_key !== undefined) config.web_api_key = web_api_key ? web_api_key.trim() : null;
    if (app_id !== undefined) config.app_id = app_id ? app_id.trim() : null;
    if (messaging_sender_id !== undefined) config.messaging_sender_id = messaging_sender_id ? messaging_sender_id.trim() : null;
    if (auth_domain !== undefined) config.auth_domain = auth_domain ? auth_domain.trim() : null;
    if (storage_bucket !== undefined) config.storage_bucket = storage_bucket ? storage_bucket.trim() : null;
    if (measurement_id !== undefined) config.measurement_id = measurement_id ? measurement_id.trim() : null;
    if (vapid_key !== undefined) config.vapid_key = vapid_key ? vapid_key.trim() : null;

    let credentialsChanged = false;
    if (service_account_json && service_account_json.trim()) {
      const parsed = parseServiceAccountJson(service_account_json.trim());
      if (parsed) {
        config.service_account_json = parsed.raw_json;
        config.project_id = parsed.project_id || config.project_id;
        config.client_email = parsed.client_email;
        config.private_key = parsed.private_key;
        credentialsChanged = true;
      }
    }

    await config.save();
    logger.logDB('update', MODEL_NAME, id);

    // Validate handshake if credentials changed
    if (credentialsChanged && config.client_email && config.private_key) {
      const handshake = await performHandshake(config.client_email, config.private_key);
      if (handshake.success) {
        config.connection_status = 'connected';
        config.last_verified_at = new Date();
        config.validation_error = null;
      } else {
        config.connection_status = 'error';
        config.validation_error = handshake.error;
      }
      await config.save();
    }

    return config;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Toggle or set active routing status
 */
const toggleActive = async (id, userId = null) => {
  try {
    const config = await baseService.getById(PushNotificationConfig, MODEL_NAME, id);
    config.is_active = true;
    await config.save();
    logger.logDB('toggleActive', MODEL_NAME, id);
    return config;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete push notification config
 */
const remove = async (id, userId = null) => {
  return baseService.remove(PushNotificationConfig, MODEL_NAME, id);
};

/**
 * Test handshake connection
 */
const testConnection = async (id) => {
  const config = await baseService.getById(PushNotificationConfig, MODEL_NAME, id);

  if (!config.client_email || !config.private_key) {
    config.connection_status = 'disconnected';
    config.validation_error = 'No service account credentials or private key stored.';
    await config.save();
    return {
      connected: false,
      status: config.connection_status,
      message: config.validation_error,
    };
  }

  const handshake = await performHandshake(config.client_email, config.private_key);
  if (handshake.success) {
    config.connection_status = 'connected';
    config.last_verified_at = new Date();
    config.validation_error = null;
    await config.save();
    return {
      connected: true,
      status: config.connection_status,
      last_verified_at: config.last_verified_at,
      message: 'Automated Handshake succeeded: Google Cloud OAuth2 token endpoint verified.',
    };
  } else {
    config.connection_status = 'error';
    config.validation_error = handshake.error;
    await config.save();
    return {
      connected: false,
      status: config.connection_status,
      message: handshake.error,
    };
  }
};

module.exports = {
  getAll,
  getActive,
  getById,
  create,
  update,
  remove,
  delete: remove,
  toggleActive,
  testConnection,
};
