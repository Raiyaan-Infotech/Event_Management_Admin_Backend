const { DataTypes } = require('sequelize');

/**
 * One FCM registration token — one installed app, on one device.
 *
 * This is the ADDRESS a push notification is sent to. Without a row here a
 * client is unreachable by push no matter how well Firebase is configured,
 * which is why `reachable(guest, 'push')` asks this table and not the guest.
 *
 * ── ⚠ THE TOKEN IS THE IDENTITY, NOT THE SESSION ────────────────────────────
 * This nearly became a column on `client_sessions`. It would have been wrong
 * in both directions: signing out and back in makes a second session for the
 * same device (a duplicate address), and a session expiring while the app
 * stays installed makes a live device with no reachable address. FCM's own
 * identity for a device is the token, so the token is UNIQUE here and
 * re-registering the same one updates rather than inserts.
 *
 * ── WHY A DEAD TOKEN IS DEACTIVATED, NOT DELETED ────────────────────────────
 * FCM answers UNREGISTERED once the app is uninstalled. That answer is worth
 * keeping: it is the honest explanation behind a recipient marked Failed.
 * Deleting the row would leave the failure with no reason, and the History
 * screen exists precisely to explain failures.
 */
module.exports = (sequelize) => {
    const ClientDeviceToken = sequelize.define('ClientDeviceToken', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        /** Whose device it is. Cascades — an account deletion takes its tokens. */
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },

        token: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },

        platform: {
            type: DataTypes.ENUM('android', 'ios', 'web'),
            allowNull: false,
            defaultValue: 'android',
        },

        /** For the person reading their own session list, not for sending. */
        device_name: { type: DataTypes.STRING(120), allowNull: true },
        app_version: { type: DataTypes.STRING(40), allowNull: true },

        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },

        /** Why FCM stopped accepting it — 'unregistered', 'invalid', … */
        disabled_reason: { type: DataTypes.STRING(120), allowNull: true },

        /**
         * Last time the app re-registered. A token FCM has not seen in months
         * is usually dead even before it says so, and this is what a future
         * clean-up would sort on.
         */
        last_seen_at: { type: DataTypes.DATE, allowNull: true },
    }, {
        tableName: 'client_device_tokens',
        underscored: true,
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    return ClientDeviceToken;
};
