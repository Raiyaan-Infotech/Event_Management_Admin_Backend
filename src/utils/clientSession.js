const {
  ClientRefreshToken,
  VendorClient,
  Vendor,
  sequelize,
} = require('../models');
const {
  COOKIE_OPTIONS,
  generateClientAccessToken,
  generateClientRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('./jwt');

const CLIENT_ACCESS_MAX_AGE = 15 * 60 * 1000;
const CLIENT_REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const clearClientCookies = (res) => {
  res.clearCookie('client_access_token', COOKIE_OPTIONS);
  res.clearCookie('client_refresh_token', COOKIE_OPTIONS);
};

const setClientCookies = (res, accessToken, refreshToken) => {
  res.cookie('client_access_token', accessToken, {
    ...COOKIE_OPTIONS,
    maxAge: CLIENT_ACCESS_MAX_AGE,
  });
  res.cookie('client_refresh_token', refreshToken, {
    ...COOKIE_OPTIONS,
    maxAge: CLIENT_REFRESH_MAX_AGE,
  });
};

const getClientRequestMetadata = (req) => ({
  ip_address: req.ip || req.socket?.remoteAddress || null,
  user_agent: req.get?.('user-agent') || null,
});

const createClientRefreshToken = async (client, token, req, transaction = null) => {
  return ClientRefreshToken.create({
    token,
    client_id: client.id,
    ...getClientRequestMetadata(req),
    expires_at: new Date(Date.now() + CLIENT_REFRESH_MAX_AGE),
    is_active: 1,
  }, { transaction });
};

const findClientForAuthentication = async (clientId) => {
  return VendorClient.findByPk(clientId, {
    include: [{ model: Vendor, as: 'vendor', attributes: ['id', 'company_id', 'status'] }],
  });
};

const getClientAuthenticationError = (client, issuedAt) => {
  if (!client) return { status: 401, message: 'Client account not found.' };
  if (client.is_active !== 1) {
    return { status: 403, message: 'Your account is inactive. Please contact the vendor.' };
  }
  if (client.login_access !== 1) {
    return { status: 403, message: 'Your login access has been revoked.' };
  }
  if (client.vendor && client.vendor.status !== 'active') {
    return { status: 403, message: 'Vendor account is suspended. Please contact support.' };
  }
  if (client.password_changed_at && issuedAt && client.password_changed_at.getTime() > issuedAt * 1000) {
    return { status: 401, message: 'Your password was changed. Please login again.' };
  }
  return null;
};

const startClientSession = async (req, res, client) => {
  const accessToken = generateClientAccessToken(client);
  const refreshToken = generateClientRefreshToken(client);

  await createClientRefreshToken(client, refreshToken, req);
  setClientCookies(res, accessToken, refreshToken);
};

const revokeClientRefreshToken = async (token, clientId = null) => {
  if (!token) return;
  const where = { token };
  if (clientId) where.client_id = clientId;
  await ClientRefreshToken.update({ is_active: 0 }, { where });
};

const revokeAllClientRefreshTokens = async (clientId) => {
  await ClientRefreshToken.update({ is_active: 0 }, {
    where: { client_id: clientId, is_active: 1 },
  });
};

const refreshClientSession = async (req, res) => {
  const currentToken = req.cookies.client_refresh_token;
  if (!currentToken) return null;

  const decoded = verifyRefreshToken(currentToken);
  if (!decoded || decoded.type !== 'client') return null;

  const storedToken = await ClientRefreshToken.findOne({
    where: { token: currentToken, client_id: decoded.id, is_active: 1 },
  });
  if (!storedToken || storedToken.expires_at <= new Date()) {
    await revokeClientRefreshToken(currentToken, decoded.id);
    return null;
  }

  const client = await findClientForAuthentication(decoded.id);
  if (getClientAuthenticationError(client, decoded.iat)) {
    await revokeClientRefreshToken(currentToken, decoded.id);
    return null;
  }

  const accessToken = generateClientAccessToken(client);
  const refreshToken = generateClientRefreshToken(client);

  await sequelize.transaction(async (transaction) => {
    const [revokedCount] = await ClientRefreshToken.update(
      { is_active: 0 },
      { where: { id: storedToken.id, is_active: 1 }, transaction },
    );
    if (revokedCount !== 1) throw new Error('Client refresh token was already used.');
    await createClientRefreshToken(client, refreshToken, req, transaction);
  });

  setClientCookies(res, accessToken, refreshToken);
  return { client, decoded: verifyAccessToken(accessToken) };
};

module.exports = {
  clearClientCookies,
  findClientForAuthentication,
  getClientAuthenticationError,
  refreshClientSession,
  revokeAllClientRefreshTokens,
  revokeClientRefreshToken,
  startClientSession,
};
