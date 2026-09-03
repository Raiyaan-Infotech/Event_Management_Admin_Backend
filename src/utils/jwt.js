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

/**
 * Website-client tokens — the people who sign up on a tenant public site
 * (`website_clients`) and land in the client portal.
 *
 * DELIBERATELY a different `type` and different cookie names from the
 * `client` tokens above, which belong to `vendor_clients` and the older Client
 * Portal. They are two different tables; sharing a type would let a session
 * from one portal authenticate as a row id in the other.
 */
/**
 * @param {object} client
 * @param {string|null} sid  The `client_sessions.jti` this token belongs to.
 *   Carried so the auth middleware can check the session is still live — an
 *   access token without it is only revocable by waiting out its 15 minutes.
 *   OPTIONAL on purpose: tokens minted before sessions existed have no `sid`,
 *   and the middleware falls back rather than signing everybody out on deploy.
 */
const generateWebsiteClientAccessToken = (client, sid = null) => {
  return jwt.sign(
    {
      id: client.id,
      email: client.email,
      vendorId: client.vendor_id,
      companyId: client.company_id || null,
      type: 'website_client',
      ...(sid ? { sid } : {}),
    },
    getAccessSecret(),
    { expiresIn: '15m' }
  );
};

/**
 * @param {object} client
 * @param {string|null} jti  Supplied by the caller so the token and its
 *   `client_sessions` row can agree on one id. Generated here when absent,
 *   which is what every caller did before sessions were stored.
 */
const generateWebsiteClientRefreshToken = (client, jti = null) => {
  return jwt.sign(
    { id: client.id, type: 'website_client', jti: jti || uuidv4() },
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

/**
 * The 2FA login challenge — issued in place of a session when a password
 * check succeeds but a second factor is still owed.
 *
 * Short-lived on purpose (10 minutes, the same order as a login form somebody
 * is actively filling in) and carries NOTHING a session token carries: no
 * `sid`, so it cannot be presented to any `/client/*` route as if it were
 * real access. It proves only "this password was correct a moment ago" — the
 * code check still has to happen before anything is issued.
 */
const generateWebsiteClient2faChallengeToken = (client) => {
  return jwt.sign(
    { id: client.id, type: 'website_client_2fa_challenge' },
    getAccessSecret(),
    { expiresIn: '10m' }
  );
};

const verifyWebsiteClient2faChallengeToken = (token) => {
  const decoded = verifyAccessToken(token);
  return decoded?.type === 'website_client_2fa_challenge' ? decoded : null;
};

/**
 * "Trust this device for 30 days" — a cookie that outlives any one session, so
 * it works across a full logout/login rather than just within one sign-in.
 *
 * `tfa` pins the token to the two-factor record's OWN `confirmed_at`. Turning
 * 2FA off and back on gives a new `confirmed_at`, which makes every trust token
 * issued under the old enrolment stop matching — so disabling and re-enabling
 * 2FA is itself what revokes standing trust, with no separate revocation list
 * to maintain.
 *
 * ⚠ NOT pinned to a password change. `website_clients` has no
 * `password_changed_at` column (unlike every other portal's table — a gap
 * already carried from before this work), so there is nothing to pin it to yet.
 */
const generateDeviceTrustToken = (client, twoFactorConfirmedAt) => {
  return jwt.sign(
    {
      id: client.id,
      type: 'website_client_device_trust',
      tfa: twoFactorConfirmedAt ? new Date(twoFactorConfirmedAt).getTime() : null,
    },
    getRefreshSecret(),
    { expiresIn: '30d' }
  );
};

const verifyDeviceTrustToken = (token) => {
  const decoded = verifyRefreshToken(token);
  return decoded?.type === 'website_client_device_trust' ? decoded : null;
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
  generateWebsiteClientAccessToken,
  generateWebsiteClientRefreshToken,
  generateVendorHandoffToken,
  verifyVendorHandoffToken,
  generateClientHandoffToken,
  verifyClientHandoffToken,
  generateWebsiteClient2faChallengeToken,
  verifyWebsiteClient2faChallengeToken,
  generateDeviceTrustToken,
  verifyDeviceTrustToken,
};
