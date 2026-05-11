const {
  verifyAccessToken,
  verifyRefreshToken,
  generateAccessToken,
  generateVendorAccessToken,
  generateClientAccessToken,
  COOKIE_OPTIONS,
} = require('../utils/jwt');
const { User, Role, RefreshToken, Vendor, VendorClient } = require('../models');

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
    return { type: 'admin', id: decoded.userId, companyId: decoded.companyId };
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
    return { type: 'vendor', id: decoded.id, vendorId: decoded.id };
  }
  return null;
};

const authenticateClient = async (req, res) => {
  let decoded = req.cookies.client_access_token ? verifyAccessToken(req.cookies.client_access_token) : null;

  if ((!decoded || decoded.type !== 'client') && req.cookies.client_refresh_token) {
    const refreshDecoded = verifyRefreshToken(req.cookies.client_refresh_token);
    if (refreshDecoded?.type === 'client') {
      const client = await VendorClient.findByPk(refreshDecoded.id);
      if (client && client.is_active === 1 && client.login_access === 1) {
        const newAccessToken = generateClientAccessToken(client);
        setAccessCookie(res, 'client_access_token', newAccessToken);
        decoded = verifyAccessToken(newAccessToken);
      }
    }
  }

  if (decoded && decoded.type === 'client') {
    return { type: 'client', id: decoded.id, vendorId: decoded.vendorId };
  }
  return null;
};

const byPortal = {
  admin: authenticateAdmin,
  vendor: authenticateVendor,
  client: authenticateClient,
};

const isMailAuthenticated = async (req, res, next) => {
  try {
    const portal = String(req.headers['x-portal-type'] || '').toLowerCase();

    if (byPortal[portal]) {
      const caller = await byPortal[portal](req, res);
      if (!caller) {
        return res.status(401).json({ success: false, message: `${portal} authentication required.` });
      }
      req.mailCaller = caller;
      return next();
    }

    // Fallback for older clients. Prefer the more specific portal cookies first
    // because localhost shares cookies across admin/vendor/client development ports.
    const caller =
      (await authenticateVendor(req, res)) ||
      (await authenticateClient(req, res)) ||
      (await authenticateAdmin(req, res));

    if (caller) {
      req.mailCaller = caller;
      return next();
    }

    return res.status(401).json({ success: false, message: 'Authentication required.' });
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
};

module.exports = { isMailAuthenticated };
