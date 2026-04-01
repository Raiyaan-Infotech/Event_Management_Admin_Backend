const { EmailConfig, Sequelize } = require("../models");
const { Op } = Sequelize;
const baseService = require("./base.service");
const logger = require("../utils/logger");
const ApiError = require("../utils/apiError");

const MODEL_NAME = "EmailConfig";

/**
 * Get all email configs
 */
const getAll = async (query = {}, companyId = undefined) => {
  return baseService.getAll(EmailConfig, MODEL_NAME, query, {
    searchFields: ["name", "from_email", "driver"],
    sortableFields: ["created_at", "name", "driver"],
    attributes: { exclude: ["password", "api_key"] },
    companyId,
    moduleSlug: 'email_configs',
  });
};

/**
 * Get email config by ID
 */
const getById = async (id, companyId = undefined) => {
  const config = await EmailConfig.findByPk(id, {
    attributes: { exclude: ["password", "api_key"] },
  });

  if (!config) {
    throw ApiError.notFound("Email configuration not found");
  }

  // Validate company ownership
  if (companyId !== undefined && companyId !== null) {
    if (config.company_id && config.company_id !== companyId) {
      throw ApiError.notFound("Email configuration not found");
    }
  }

  return config;
};

/**
 * Create email config
 */
const create = async (data, userId = null, companyId = undefined) => {
  try {
    if (data.name) {
      const exists = await EmailConfig.findOne({ where: { name: data.name, company_id: companyId ?? null } });
      if (exists) throw ApiError.badRequest(`An email config with the name "${data.name}" already exists.`);
    }
    // If this is set as default, unset other defaults (within company)
    if (data.is_default) {
      const where = { is_default: true };
      if (companyId !== undefined && companyId !== null) {
        where.company_id = companyId;
      }
      await EmailConfig.update({ is_default: false }, { where });
    }

    return baseService.create(EmailConfig, MODEL_NAME, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Update email config
 */
const update = async (id, data, userId = null, companyId = undefined) => {
  try {
    const config = await EmailConfig.findByPk(id);
    if (!config) {
      throw ApiError.notFound("Email configuration not found");
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (config.company_id && config.company_id !== companyId) {
        throw ApiError.notFound("Email configuration not found");
      }
    }

    if (data.name) {
      const exists = await EmailConfig.findOne({ where: { name: data.name, company_id: companyId ?? null, id: { [Op.ne]: id } } });
      if (exists) throw ApiError.badRequest(`An email config with the name "${data.name}" already exists.`);
    }

    // If setting as default, unset other defaults (within company)
    if (data.is_default) {
      const where = { is_default: true, id: { [require("sequelize").Op.ne]: id } };
      if (companyId !== undefined && companyId !== null) {
        where.company_id = companyId;
      }
      await EmailConfig.update({ is_default: false }, { where });
    }

    // Don't overwrite password/api_key with empty strings
    if (data.password === "" || data.password === undefined) {
      delete data.password;
    }
    if (data.api_key === "" || data.api_key === undefined) {
      delete data.api_key;
    }

    return baseService.update(EmailConfig, MODEL_NAME, id, data, userId, companyId);
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

/**
 * Delete email config
 */
const remove = async (id, userId = null, companyId = undefined) => {
  return baseService.remove(EmailConfig, MODEL_NAME, id, userId, companyId, { uniqueFields: ['name'] });
};

/**
 * Test email config connection (verifies transporter)
 */
const testConnection = async (id, testEmail = null, templateId = null) => {
  console.log("Service testConnection called with:", {
    id,
    testEmail,
    templateId,
  });

  const emailSenderService = require("./emailSender.service");
  return emailSenderService.testConfig(id, testEmail, templateId);
};

/**
 * Get default email config
 */
const getDefault = async (companyId = undefined) => {
  const where = { is_default: true, is_active: true };
  if (companyId !== undefined && companyId !== null) {
    where.company_id = companyId;
  }

  const config = await EmailConfig.findOne({ where });
  return config;
};

/**
 * Debug SMTP connectivity - tests raw socket connection
 */
const debugSmtpConnection = async (id) => {
  const net = require("net");
  const tls = require("tls");

  const config = await EmailConfig.findByPk(id);
  if (!config) {
    throw ApiError.notFound("Email configuration not found");
  }

  const results = {
    config: {
      name: config.name,
      host: config.host,
      port: config.port,
      driver: config.driver,
      encryption: config.encryption,
    },
    tests: [],
  };

  // Test 1: DNS resolution
  const dns = require("dns");
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4(config.host, (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    results.tests.push({
      name: "DNS Resolution",
      success: true,
      message: `Resolved to: ${addresses.join(", ")}`,
    });
  } catch (error) {
    results.tests.push({
      name: "DNS Resolution",
      success: false,
      message: error.message,
    });
    return results;
  }

  // Test 2: Raw TCP/TLS socket connection
  const connectionTest = await new Promise((resolve) => {
    const timeout = 15000;
    let socket;
    let resolved = false;

    const cleanup = () => {
      if (socket) {
        socket.destroy();
      }
    };

    const onConnect = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({
        name: "Socket Connection",
        success: true,
        message: `Connected to ${config.host}:${config.port} successfully`,
      });
    };

    const onError = (err) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({
        name: "Socket Connection",
        success: false,
        message: `Failed to connect: ${err.message}`,
        errorCode: err.code,
      });
    };

    const onTimeout = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({
        name: "Socket Connection",
        success: false,
        message: `Connection timed out after ${timeout / 1000}s - port may be blocked`,
      });
    };

    try {
      if (config.encryption === "ssl" || config.port === 465) {
        socket = tls.connect({
          host: config.host,
          port: config.port,
          timeout: timeout,
          rejectUnauthorized: false,
        });
      } else {
        socket = net.createConnection({
          host: config.host,
          port: config.port,
          timeout: timeout,
        });
      }

      socket.on("connect", onConnect);
      socket.on("secureConnect", onConnect);
      socket.on("error", onError);
      socket.on("timeout", onTimeout);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve({
            name: "Socket Connection",
            success: false,
            message:
              "Connection timed out - outbound port may be blocked by Render",
          });
        }
      }, timeout + 1000);
    } catch (error) {
      resolve({
        name: "Socket Connection",
        success: false,
        message: error.message,
      });
    }
  });

  results.tests.push(connectionTest);

  // Test 3: Alternative ports (if main test fails)
  if (!connectionTest.success) {
    const alternativePorts = [587, 25, 2525];
    for (const port of alternativePorts) {
      if (port === config.port) continue;

      const altTest = await new Promise((resolve) => {
        const timeout = 5000;
        let socket;
        let resolved = false;

        const cleanup = () => {
          if (socket) socket.destroy();
        };

        try {
          socket = net.createConnection({
            host: config.host,
            port: port,
            timeout: timeout,
          });

          socket.on("connect", () => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve({
              name: `Alternative Port ${port}`,
              success: true,
              message: `Port ${port} is reachable - consider using this instead`,
            });
          });

          socket.on("error", () => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(null);
          });

          socket.on("timeout", () => {
            if (resolved) return;
            resolved = true;
            cleanup();
            resolve(null);
          });

          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              cleanup();
              resolve(null);
            }
          }, timeout + 500);
        } catch (error) {
          resolve(null);
        }
      });

      if (altTest) {
        results.tests.push(altTest);
      }
    }
  }

  // Summary
  const allPassed = results.tests.every((t) => t.success);
  results.summary = allPassed
    ? "All connectivity tests passed. The issue may be with authentication or SMTP protocol."
    : "Network connectivity issues detected. Render may be blocking outbound SMTP ports.";

  return results;
};

const toggleActive = async (id, userId = null, companyId = undefined) => {
  try {
    const config = await EmailConfig.findByPk(id);
    if (!config) {
      throw ApiError.notFound("Email configuration not found");
    }

    // Validate company ownership
    if (companyId !== undefined && companyId !== null) {
      if (config.company_id && config.company_id !== companyId) {
        throw ApiError.notFound("Email configuration not found");
      }
    }

    const updatedConfig = await config.update({
      is_active: !config.is_active,
      updated_by: userId,
    });

    logger.info(
      `Email config ${id} active status toggled to ${updatedConfig.is_active}`,
    );
    return updatedConfig;
  } catch (error) {
    logger.logError(error);
    throw error;
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove,
  testConnection,
  getDefault,
  debugSmtpConnection,
  toggleActive,
};
