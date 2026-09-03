const { DataTypes } = require('sequelize');

/**
 * One sign-in by a website client — the row that makes Active Sessions,
 * Authorized Devices and "log out all other sessions" possible at all.
 *
 * ── WHY THIS DID NOT EXIST UNTIL NOW ────────────────────────────────────────
 * Website-client tokens are stateless JWTs. They were signed and forgotten, so
 * there was nothing to enumerate and nothing to revoke; the Security tab said so
 * rather than shipping a Log Out button that cleared a cookie and left the token
 * working. This table is that missing row.
 *
 * ── THE JTI WAS ALREADY BEING MINTED ────────────────────────────────────────
 * `generateWebsiteClientRefreshToken` in utils/jwt.js has always put a uuid
 * `jti` into every refresh token, and nothing has ever read it. Storing that
 * value is the entire mechanism — the token already carried its own key, so
 * revocation needed no new token format and no migration of anybody's session.
 *
 * ── ONE TABLE, TWO SCREENS ──────────────────────────────────────────────────
 * Active Sessions and Authorized Devices read the SAME rows. Two tables would
 * be two copies of "which device is this", and the first symptom of them
 * drifting apart is a device you revoked still being able to sign in.
 *
 * ── ⚠ `location` IS ALWAYS NULL ─────────────────────────────────────────────
 * The design prints "Mumbai, India" against every row. That needs a GeoIP
 * lookup this project does not have. The column exists so adding one later is
 * not a migration; the screens show the IP address instead, because an IP is
 * something this system actually knows.
 */
module.exports = (sequelize) => {
    const ClientSession = sequelize.define('ClientSession', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        /** The refresh token's `jti`. Unique, so a rotated token cannot be replayed. */
        jti: {
            type: DataTypes.CHAR(36),
            allowNull: false,
            unique: true,
        },
        /**
         * Which door they came in by. The portal sends cookies; the Flutter app
         * sends `Authorization: Bearer` and cannot receive a Set-Cookie at all,
         * so the two refresh through different code paths and a session has to
         * say which it is.
         */
        transport: {
            type: DataTypes.ENUM('web', 'app'),
            allowNull: false,
            defaultValue: 'web',
        },

        /*
          Parsed from the User-Agent once, at sign-in, and then frozen.
          Re-deriving on read would let an old row change its mind about what
          device it was.
        */
        device_name: { type: DataTypes.STRING(120), allowNull: true },
        device_type: { type: DataTypes.STRING(20), allowNull: true },
        browser: { type: DataTypes.STRING(60), allowNull: true },
        os: { type: DataTypes.STRING(60), allowNull: true },

        ip_address: { type: DataTypes.STRING(45), allowNull: true },
        user_agent: { type: DataTypes.STRING(500), allowNull: true },
        /** ⚠ Always null — there is no GeoIP service. See the header. */
        location: { type: DataTypes.STRING(120), allowNull: true },

        last_active_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        expires_at: { type: DataTypes.DATE, allowNull: false },

        /*
          Revoked rather than deleted. "This session was signed out at 14:02" is
          the only question anybody asks of a session that is gone, and a deleted
          row cannot answer it.
        */
        revoked_at: { type: DataTypes.DATE, allowNull: true },
        revoked_reason: { type: DataTypes.STRING(40), allowNull: true },

        /**
         * "Trust this device for 30 days" — this device may skip the 2FA code
         * until then.
         *
         * A DATE, not a flag: it expires by comparison with the clock. A boolean
         * would need something to turn it back off, and §314 established there
         * is no scheduled job in this system that reliably runs.
         */
        trusted_until: { type: DataTypes.DATE, allowNull: true },
    }, {
        tableName: 'client_sessions',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { unique: true, fields: ['jti'], name: 'client_sessions_jti' },
            { fields: ['website_client_id', 'revoked_at', 'last_active_at'], name: 'client_sessions_client' },
        ],
    });

    /** Live means: not revoked, and not past its refresh window. */
    ClientSession.prototype.isLive = function isLive() {
        return !this.revoked_at && new Date(this.expires_at).getTime() > Date.now();
    };

    /** Trusted means: the 30-day window was set and has not run out. */
    ClientSession.prototype.isTrusted = function isTrusted() {
        return Boolean(this.trusted_until) && new Date(this.trusted_until).getTime() > Date.now();
    };

    return ClientSession;
};
