const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const { logActivity: dbLogActivity } = require('../middleware/activityLogger');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      log += `\n${stack}`;
    }
    return log;
  })
);

// Console format with colors
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0 && meta.stack === undefined) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Create logs directory
const logsDir = path.join(__dirname, '../../logs');

// Daily rotate file transport for all logs
const dailyRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat,
});

// Daily rotate file transport for errors only
const errorRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: logFormat,
});

// Create logger instance
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  defaultMeta: { service: 'admin-dashboard-api' },
  transports: [
    dailyRotateTransport,
    errorRotateTransport,
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
    }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

// Helper methods for structured logging
logger.logRequest = (req, message = 'Request received') => {
  logger.info(message, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id || null,
  });
};

logger.logResponse = (req, statusCode, message = 'Response sent') => {
  const level = statusCode >= 400 ? 'warn' : 'info';
  logger[level](message, {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    userId: req.user?.id || null,
  });
};

logger.logError = (error, req = null) => {
  const meta = {
    errorName: error.name,
    errorMessage: error.message,
  };
  if (req) {
    meta.method = req.method;
    meta.url = req.originalUrl;
    meta.ip = req.ip;
    meta.userId = req.user?.id || null;
  }
  logger.error(error.message, { ...meta, stack: error.stack });
};

logger.logActivity = async (userId, action, module, description, meta = {}) => {
  // Log to database
  await dbLogActivity(userId, action, module, description, meta.oldValues, meta.newValues, null, meta.companyId || null);

  // Also log to winston
  logger.info(`Activity: ${action}`, {
    userId,
    action,
    module,
    description,
    ...meta,
  });
};

logger.logDB = (operation, model, id = null, meta = {}) => {
  logger.debug(`DB ${operation}: ${model}`, {
    operation,
    model,
    recordId: id,
    ...meta,
  });
};

module.exports = logger;
