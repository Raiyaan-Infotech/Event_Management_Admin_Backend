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
    { id: vendor.id, email: vendor.email, companyId: vendor.company_id || null, type: 'vendor' },
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

// Client-specific token generators - separate from vendor, staff, and admin
const generateClientAccessToken = (client) => {
  return jwt.sign(
    { id: client.id, email: client.email, vendorId: client.vendor_id, companyId: client.company_id || null, type: 'client' },
    getAccessSecret(),
    { expiresIn: '15m' }
  );
};

const generateClientRefreshToken = (client) => {
  return jwt.sign(
    { id: client.id, type: 'client', jti: uuidv4() },
    getRefreshSecret(),
    { expiresIn: '7d' }
  );
};

// Vendor handoff — short-lived token to carry a vendor session across domains
// (e.g. vendor portal → website builder, which lives on a different origin).
const generateVendorHandoffToken = (vendor) => {
  return jwt.sign(
    { id: vendor.id, type: 'vendor_handoff' },
    getAccessSecret(),
    { expiresIn: '1m' }
  );
};

const verifyVendorHandoffToken = (token) => {
  const decoded = verifyAccessToken(token);
  return decoded?.type === 'vendor_handoff' ? decoded : null;
};

const generateClientHandoffToken = (client) => {
  return jwt.sign(
    { id: client.id, vendorId: client.vendor_id, type: 'client_handoff' },
    getAccessSecret(),
    { expiresIn: '1m' }
  );
};

const verifyClientHandoffToken = (token) => {
  const decoded = verifyAccessToken(token);
  return decoded?.type === 'client_handoff' ? decoded : null;
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
  generateClientAccessToken,
  generateClientRefreshToken,
  generateVendorHandoffToken,
  verifyVendorHandoffToken,
  generateClientHandoffToken,
  verifyClientHandoffToken,
};
