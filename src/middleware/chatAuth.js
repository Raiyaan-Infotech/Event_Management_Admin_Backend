const {
  verifyAccessToken,
  verifyRefreshToken,
  generateAccessToken,
  generateVendorAccessToken,
  COOKIE_OPTIONS,
} = require('../utils/jwt');
const { User, Role, RefreshToken, Vendor } = require('../models');
const {
  clearClientCookies,
  findClientForAuthentication,
  getClientAuthenticationError,
  refreshClientSession,
} = require('../utils/clientSession');

const setAccessCookie = (res, name, token) => {
  res.cookie(name, token, {
    ...COOKIE_OPTIONS,
    maxAge: 15 * 60 * 1000,
  });
};

const authenticateAdmin = async (req, res) => {
  let decoded = req.cookies.access_token ? verifyAccessToken(req.cookies.access_token) : null;

  if (!decoded && req.cookies.refresh_token) {
    const refreshDecoded = verifyRefreshToken(req.cookies.refresh_token);
    if (refreshDecoded?.userId) {
      const storedToken = await RefreshToken.findOne({
        where: { token: req.cookies.refresh_token, user_id: refreshDecoded.userId, is_active: true },
      });
      const user = storedToken && storedToken.expires_at > new Date()
        ? await User.findByPk(refreshDecoded.userId, { include: [{ model: Role, as: 'role' }] })
        : null;

      if (user && user.is_active === 1 && user.login_access === 1) {
        const newAccessToken = generateAccessToken(user);
        setAccessCookie(res, 'access_token', newAccessToken);
        decoded = verifyAccessToken(newAccessToken);
      }
    }
  }

  if (decoded && !decoded.type) {
    return { type: 'admin', id: decoded.userId, companyId: decoded.companyId || null };
  }
  return null;
};

const authenticateVendor = async (req, res) => {
  let decoded = req.cookies.vendor_access_token ? verifyAccessToken(req.cookies.vendor_access_token) : null;

  if ((!decoded || decoded.type !== 'vendor') && req.cookies.vendor_refresh_token) {
    const refreshDecoded = verifyRefreshToken(req.cookies.vendor_refresh_token);
    if (refreshDecoded?.type === 'vendor') {
      const vendor = await Vendor.findByPk(refreshDecoded.id);
      if (vendor && vendor.status === 'active') {
        const newAccessToken = generateVendorAccessToken(vendor);
        setAccessCookie(res, 'vendor_access_token', newAccessToken);
        decoded = verifyAccessToken(newAccessToken);
      }
    }
  }

  if (decoded && decoded.type === 'vendor') {
    return { type: 'vendor', id: decoded.id, vendorId: decoded.id, companyId: decoded.companyId || null };
  }
  return null;
};

const authenticateClient = async (req, res) => {
  let decoded = req.cookies.client_access_token ? verifyAccessToken(req.cookies.client_access_token) : null;
  let client = null;

  if ((!decoded || decoded.type !== 'client') && req.cookies.client_refresh_token) {
    const refreshed = await refreshClientSession(req, res);
    decoded = refreshed?.decoded || null;
    client = refreshed?.client || null;
  }

  if (decoded && decoded.type === 'client') {
    if (!client) client = await findClientForAuthentication(decoded.id);
    if (getClientAuthenticationError(client, decoded.iat)) {
      clearClientCookies(res);
      return null;
    }
    return {
      type: 'client',
      id: decoded.id,
      vendorId: decoded.vendorId || client.vendor_id || null,
      companyId: client.company_id || decoded.companyId || null,
    };
  }
  return null;
};

const byPortal = {
  admin: authenticateAdmin,
  vendor: authenticateVendor,
  client: authenticateClient,
};

const authenticateChatRequest = async (req, res) => {
  const portal = String(req.headers['x-portal-type'] || '').toLowerCase();

  if (byPortal[portal]) {
    return byPortal[portal](req, res);
  }

  return (
    (await authenticateVendor(req, res)) ||
    (await authenticateClient(req, res)) ||
    (await authenticateAdmin(req, res))
  );
};

const isChatAuthenticated = async (req, res, next) => {
  try {
    const actor = await authenticateChatRequest(req, res);
    if (!actor) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    req.chatActor = actor;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
};

module.exports = { isChatAuthenticated, authenticateChatRequest };
