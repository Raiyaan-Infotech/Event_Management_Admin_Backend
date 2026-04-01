const path = require('path');
const fs = require('fs');
const os = require('os');
const setupService = require('../services/setup.service');
const ApiResponse = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/helpers');
const { generateAccessToken, generateRefreshToken, setTokenCookies } = require('../utils/jwt');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Move a multer temp file to the uploads directory and return the relative path.
 * Returns null if no file was provided.
 */
const saveUploadedFile = (file, uploadPath) => {
  if (!file) return null;

  const uploadDir = path.join(__dirname, '../..', uploadPath || 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  const dest = path.join(uploadDir, filename);

  // Use copy+delete instead of rename to handle cross-drive moves (e.g. C:\Temp → D:\uploads)
  fs.copyFileSync(file.path, dest);
  fs.unlinkSync(file.path);

  return `/${uploadPath || 'uploads'}/${filename}`;
};

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/setup/status
 * Returns whether the app has been installed and if setup is disabled.
 * Always accessible — used by frontend middleware to decide routing.
 */
const getStatus = asyncHandler(async (req, res) => {
  const { isInstalled } = require('../middleware/setup');

  // Check if install is disabled
  const isDisabled = process.env.DISABLE_INSTALL === 'true' || process.env.NODE_ENV === 'production';

  return ApiResponse.success(res, {
    installed: isInstalled(),
    disabled: isDisabled,
  });
});

/**
 * POST /api/v1/setup/check
 * Pre-flight checks: Node version, backend reachable, write permissions.
 */
const preflightCheck = asyncHandler(async (req, res) => {
  const checks = [];

  // 1. Backend reachable — if we're here, it's reachable
  checks.push({
    key: 'backend',
    label: 'Backend reachable',
    passed: true,
    detail: `Running on port ${process.env.PORT || 5000}`,
  });

  // 2. Node.js version >= 18
  const nodeVersion = process.version; // e.g. "v20.11.0"
  const major = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
  checks.push({
    key: 'node',
    label: 'Node.js version',
    passed: major >= 18,
    detail: `${nodeVersion} (requires >= 18)`,
  });

  // 3. Write permission — can we write .env at backend root?
  const backendRoot = path.join(__dirname, '../..');
  let canWrite = false;
  try {
    fs.accessSync(backendRoot, fs.constants.W_OK);
    canWrite = true;
  } catch {
    canWrite = false;
  }
  checks.push({
    key: 'write',
    label: 'Write permissions',
    passed: canWrite,
    detail: canWrite
      ? 'Backend directory is writable'
      : 'Cannot write to backend directory — check permissions',
  });

  // 4. OS info (informational)
  checks.push({
    key: 'os',
    label: 'Operating system',
    passed: true,
    detail: `${os.type()} ${os.release()} (${os.arch()})`,
  });

  const allPassed = checks.every(c => c.passed);

  return ApiResponse.success(
    res,
    { checks, allPassed },
    allPassed ? 'All pre-flight checks passed' : 'Some checks failed'
  );
});

/**
 * POST /api/v1/setup/test-db
 * Test MySQL connection with provided credentials.
 * Body: { db_host, db_port, db_name, db_user, db_password }
 */
const testDatabase = asyncHandler(async (req, res) => {
  const { db_host, db_port, db_name, db_user, db_password } = req.body;

  if (!db_host || !db_user) {
    return ApiResponse.badRequest(res, 'db_host and db_user are required');
  }

  const result = await setupService.testConnection({
    db_host,
    db_port: db_port || 3306,
    db_name: db_name || 'admin',
    db_user,
    db_password: db_password || '',
  });

  return ApiResponse.success(res, result, 'Database connection successful');
});

/**
 * POST /api/v1/setup/configure
 * Write .env file + create database + run schema SQL.
 * Body: { db_host, db_port, db_name, db_user, db_password, domain, upload_path, max_file_size }
 */
const configure = asyncHandler(async (req, res) => {
  const {
    db_host,
    db_port,
    db_name,
    db_user,
    db_password,
    domain,
    upload_path,
    max_file_size,
  } = req.body;

  if (!db_host || !db_user || !db_name) {
    return ApiResponse.badRequest(res, 'db_host, db_user, and db_name are required');
  }

  const config = {
    db_host,
    db_port: db_port || 3306,
    db_name,
    db_user,
    db_password: db_password || '',
    domain: domain || 'http://localhost:3000',
    upload_path: upload_path || 'uploads',
    max_file_size: max_file_size || 10485760,
  };

  // Step 1: Write .env (secrets auto-generated server-side)
  setupService.writeEnvFile(config);

  // Step 2: Create database
  await setupService.createDatabase(config);

  // Step 3: Run schema (tables + FK constraints + base seeds)
  await setupService.runSchema(config);

  return ApiResponse.success(
    res,
    { configured: true },
    'Database configured successfully'
  );
});

/**
 * POST /api/v1/setup/company  (multipart — logo, favicon)
 * Insert company + modules + permissions + settings.
 * Stores company data in session for use by finalize.
 * Body: { name, slug, copyright, timezone, language, currency, email, phone }
 * Files: logo, favicon
 */
const createCompany = asyncHandler(async (req, res) => {
  const {
    name,
    slug,
    copyright,
    timezone,
    language,
    currency,
    email,
    phone,
    // DB config forwarded from frontend state (needed to connect before .env is loaded)
    db_host,
    db_port,
    db_name,
    db_user,
    db_password,
    upload_path,
    max_file_size,
    domain,
  } = req.body;

  if (!name || !slug) {
    return ApiResponse.badRequest(res, 'Company name and slug are required');
  }

  const config = {
    db_host,
    db_port: db_port || 3306,
    db_name,
    db_user,
    db_password: db_password || '',
    domain: domain || 'http://localhost:3000',
    upload_path: upload_path || 'uploads',
    max_file_size: max_file_size || 10485760,
  };

  // Handle file uploads
  const logoPath = saveUploadedFile(req.files?.logo?.[0], upload_path || 'uploads');
  const faviconPath = saveUploadedFile(req.files?.favicon?.[0], upload_path || 'uploads');

  const companyData = {
    name,
    slug,
    copyright: copyright || name,
    timezone: timezone || 'UTC',
    language: language || 'en',
    currency: currency || 'USD',
    email: email || null,
    phone: phone || null,
    logo: logoPath,
    favicon: faviconPath,
  };

  const companyId = await setupService.createCompany(companyData, config);

  return ApiResponse.created(
    res,
    { company_id: companyId, ...companyData },
    'Company created successfully'
  );
});

/**
 * POST /api/v1/setup/admin  (multipart — avatar)
 * Create the super admin user + developer role + super admin role.
 * Body: { full_name, email, password, company_id, db_host, db_port, db_name, db_user, db_password }
 * Files: avatar (optional)
 */
const createAdmin = asyncHandler(async (req, res) => {
  const {
    full_name,
    email,
    password,
    company_id,
    db_host,
    db_port,
    db_name,
    db_user,
    db_password,
    upload_path,
  } = req.body;

  if (!full_name || !email || !password || !company_id) {
    return ApiResponse.badRequest(res, 'full_name, email, password, and company_id are required');
  }

  const config = {
    db_host,
    db_port: db_port || 3306,
    db_name,
    db_user,
    db_password: db_password || '',
  };

  // Handle avatar upload
  const avatarPath = saveUploadedFile(req.files?.avatar?.[0], upload_path || 'uploads');

  const adminData = {
    full_name,
    email,
    password,
    avatar: avatarPath,
  };

  const user = await setupService.createAdmin(adminData, parseInt(company_id, 10), config);

  return ApiResponse.created(res, { user }, 'Super admin created successfully');
});

/**
 * POST /api/v1/setup/finalize
 * 1. Seed translation keys + English translations
 * 2. Mark installed (.installed file)
 * 3. Generate JWT tokens for auto-login
 * 4. Set HttpOnly cookies → frontend redirects to /admin
 * Body: { user_id, company_id, email, full_name, role_id, db_* config }
 */
const finalize = asyncHandler(async (req, res) => {
  const {
    user_id,
    company_id,
    email,
    full_name,
    role_id,
    db_host,
    db_port,
    db_name,
    db_user,
    db_password,
  } = req.body;

  if (!user_id || !company_id) {
    return ApiResponse.badRequest(res, 'user_id and company_id are required');
  }

  const config = {
    db_host,
    db_port: db_port || 3306,
    db_name,
    db_user,
    db_password: db_password || '',
  };

  // 1. Seed translation keys + English translations scoped to company
  await setupService.seedTranslations(parseInt(company_id, 10), config);

  // 2. Mark as installed — locks all setup routes
  setupService.markInstalled();

  // 3. Build minimal user object for JWT generation (matches auth.controller.js pattern)
  const user = {
    id: parseInt(user_id, 10),
    full_name,
    email,
    role_id: parseInt(role_id, 10),
    company_id: parseInt(company_id, 10),
    is_active: 1,
  };

  // 4. Generate tokens (same helpers as auth.controller.js)
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // 5. Store refresh token in DB (raw query — Sequelize may not be loaded yet)
  try {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: db_host,
      port: parseInt(db_port, 10) || 3306,
      database: db_name,
      user: db_user,
      password: db_password || '',
    });

    await conn.query(
      `INSERT INTO \`refresh_tokens\` (token, user_id, ip_address, user_agent, expires_at, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), 1, NOW(), NOW())`,
      [
        refreshToken,
        user.id,
        req.ip || null,
        req.get('User-Agent') || null,
      ]
    );

    await conn.end();
  } catch (err) {
    // Non-fatal — user can log in manually
    console.warn('[Setup] Could not store refresh token:', err.message);
  }

  // 6. Set HttpOnly JWT cookies (same helper as auth.controller.js)
  setTokenCookies(res, accessToken, refreshToken);

  // 7. Set app_installed cookie — frontend middleware uses this for fast-path detection
  res.cookie('app_installed', 'true', {
    httpOnly: false, // readable by Next.js middleware (edge runtime)
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
    path: '/',
  });

  // 8. Schedule server restart so all routes load with the new .env
  //    The response is sent first, then the process restarts.
  //    - nodemon: touching a watched file triggers restart
  //    - pm2/systemd: process.exit(1) triggers auto-restart
  setTimeout(() => {
    console.log('[Setup] Installation complete. Restarting server to load all routes...');
    // Touch server.js to trigger nodemon file-change restart
    const serverFile = path.join(__dirname, '..', 'server.js');
    try {
      const now = new Date();
      fs.utimesSync(serverFile, now, now);
    } catch {
      // Fallback: exit with code 1 so process managers (pm2) restart
      process.exit(1);
    }
  }, 1500); // 1.5s delay to ensure response is sent

  return ApiResponse.success(
    res,
    {
      installed: true,
      restart: true, // tells frontend to wait for restart
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
      },
    },
    'Setup complete! Server is restarting...'
  );
});

module.exports = {
  getStatus,
  preflightCheck,
  testDatabase,
  configure,
  createCompany,
  createAdmin,
  finalize,
};