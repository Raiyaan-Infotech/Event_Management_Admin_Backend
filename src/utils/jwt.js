const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Read secrets at call time (not module load time) so they work
// even when .env is written after server startup (install wizard)
const getAccessSecret = () => process.env.ACCESS_TOKEN_SECRET;
const getRefreshSecret = () => process.env.REFRESH_TOKEN_SECRET;

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role?.slug || null,
      companyId: user.company_id || null,
      roleLevel: user.role?.level || 0,
    },
    getAccessSecret(),
    { expiresIn: '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.id, jti: uuidv4() },
    getRefreshSecret(),
    { expiresIn: '7d' }
  );
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, getAccessSecret());
  } catch (error) {
    return null;
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, getRefreshSecret());
  } catch (error) {
    return null;
  }
};

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
};

const setTokenCookies = (res, accessToken, refreshToken) => {
  res.cookie('access_token', accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie('refresh_token', refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

const clearTokenCookies = (res) => {
  res.clearCookie('access_token', COOKIE_OPTIONS);
  res.clearCookie('refresh_token', COOKIE_OPTIONS);
};

// Vendor-specific token generators — completely separate from admin role system
const generateVendorAccessToken = (vendor) => {
  return jwt.sign(
    { id: vendor.id, email: vendor.email, type: 'vendor' },
    getAccessSecret(),
    { expiresIn: '15m' }
  );
};

const generateVendorRefreshToken = (vendor) => {
  return jwt.sign(
    { id: vendor.id, type: 'vendor' },
    getRefreshSecret(),
    { expiresIn: '7d' }
  );
};

// Staff-specific token generators — separate from vendor and admin
const generateStaffAccessToken = (staff) => {
  return jwt.sign(
    { id: staff.id, email: staff.email, vendorId: staff.vendor_id, companyId: staff.company_id || null, type: 'staff' },
    getAccessSecret(),
    { expiresIn: '15m' }
  );
};

const generateStaffRefreshToken = (staff) => {
  return jwt.sign(
    { id: staff.id, type: 'staff' },
    getRefreshSecret(),
    { expiresIn: '7d' }
  );
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setTokenCookies,
  clearTokenCookies,
  COOKIE_OPTIONS,
  generateVendorAccessToken,
  generateVendorRefreshToken,
  generateStaffAccessToken,
  generateStaffRefreshToken,
};