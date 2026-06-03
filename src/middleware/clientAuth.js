const { verifyAccessToken } = require('../utils/jwt');
const {
    clearClientCookies,
    findClientForAuthentication,
    getClientAuthenticationError,
    refreshClientSession,
} = require('../utils/clientSession');

const isClientAuthenticated = async (req, res, next) => {
    try {
        const accessToken = req.cookies.client_access_token;

        let decoded = null;
        if (accessToken) decoded = verifyAccessToken(accessToken);

        let client = null;
        if (!decoded || decoded.type !== 'client') {
            const refreshed = await refreshClientSession(req, res);
            decoded = refreshed?.decoded || null;
            client = refreshed?.client || null;
        }

        if (!decoded || decoded.type !== 'client') {
            clearClientCookies(res);
            return res.status(401).json({ success: false, message: 'Client authentication required.' });
        }

        if (!client) client = await findClientForAuthentication(decoded.id);
        const authenticationError = getClientAuthenticationError(client, decoded.iat);
        if (authenticationError) {
            clearClientCookies(res);
            return res.status(authenticationError.status).json({ success: false, message: authenticationError.message });
        }

        req.client = client;
        next();
    } catch (error) {
        clearClientCookies(res);
        return res.status(401).json({ success: false, message: 'Client authentication required.' });
    }
};

module.exports = { isClientAuthenticated };
