const path = require('path');

const INSTALLED_FILE = path.join(__dirname, '../../.installed');

let _installedCache = null;

/**
 * Check if the application has been installed
 * First checks memory cache, then DB, then falls back to file
 */
const isInstalled = () => {
  return true; // Bypass for now - user wants it commented out for future use
  /* Original Logic:
  if (_installedCache === true) return true;
  const fs = require('fs');
  if (fs.existsSync(INSTALLED_FILE)) {
    _installedCache = true;
    return true;
  }
  return false;
  */
};

/**
 * Async version — checks the database directly
 * Used on server startup to set the cache from DB
 */
const checkInstalledFromDB = async () => {
  return true; // Bypass for now - user wants it commented out for future use
  /* Original Logic:
  try {
    const mysql = require('mysql2/promise');
    if (!process.env.DB_HOST || !process.env.DB_NAME) return false;
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || '',
    });
    const [rows] = await conn.query('SELECT id FROM `users` LIMIT 1');
    await conn.end();
    if (rows.length > 0) {
      _installedCache = true;
      return true;
    }
    return false;
  } catch {
    return false;
  }
  */
};

/**
 * Block setup routes if:
 * 1. Already installed
 * 2. NODE_ENV=production
 * 3. DISABLE_INSTALL=true env var is set
 */
const setupGuard = (req, res, next) => {
  // Check if disabled via env var
  if (process.env.DISABLE_INSTALL === 'true') {
    return res.status(403).json({
      success: false,
      message: 'Installation wizard has been disabled.',
    });
  }

  // Check if disabled in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      message: 'Installation wizard is not available in production.',
    });
  }

  // Check if already installed
  if (isInstalled()) {
    return res.status(403).json({
      success: false,
      message: 'Application is already installed.',
    });
  }

  next();
};

/**
 * Attach installation status to request object
 */
const checkInstalled = (req, res, next) => {
  req.isInstalled = isInstalled();
  next();
};

/**
 * Mark as installed — writes file + sets memory cache
 */
const markInstalled = () => {
  _installedCache = true;
  try {
    const fs = require('fs');
    fs.writeFileSync(INSTALLED_FILE, new Date().toISOString(), 'utf8');
  } catch {
    // File write may fail on Render — that's ok, cache is set
  }
};

module.exports = { isInstalled, checkInstalledFromDB, setupGuard, checkInstalled, markInstalled, INSTALLED_FILE };