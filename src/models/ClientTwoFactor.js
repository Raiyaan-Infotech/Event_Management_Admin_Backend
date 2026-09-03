const { DataTypes } = require('sequelize');

/**
 * A website client's authenticator-app (TOTP) second factor.
 *
 * ── WHY A SEPARATE TABLE AND NOT COLUMNS ON `website_clients` ───────────────
 * That model's `defaultScope` already has to exclude `password` and `otp_hash`,
 * and the OTP-login path has to reach past it with `.unscoped()`. Adding a
 * shared secret to the same row means a third thing that leaks the moment
 * somebody writes a plain `findByPk`. A separate table cannot be selected by
 * accident, which rules that failure out rather than documenting it.
 *
 * ── ENROLMENT IS TWO STEPS, AND THAT IS THE POINT ───────────────────────────
 * The secret exists as soon as the QR is drawn, but `is_enabled` stays 0 until a
 * code from the authenticator proves the QR was really scanned. Enabling on
 * setup would lock out anybody who closed the tab halfway with a secret they
 * never stored.
 *
 * ── ⚠ TOTP IS AUTHENTICATOR-APP ONLY ────────────────────────────────────────
 * Not SMS. There is no SMS provider in this project — the mobile login OTP is
 * written to the server log with "NOT SENT" — so a code by text could not be
 * delivered. Google Authenticator, Authy and Microsoft Authenticator all read
 * the same `otpauth://` URI, so this needs no provider at all.
 */
module.exports = (sequelize) => {
    const ClientTwoFactor = sequelize.define('ClientTwoFactor', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
        },
        /** base32, as the authenticator apps expect it. */
        secret: { type: DataTypes.STRING(255), allowNull: false },

        is_enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        /** When a code from the app first proved the QR had been scanned. */
        confirmed_at: { type: DataTypes.DATE, allowNull: true },

        last_used_at: { type: DataTypes.DATE, allowNull: true },
        /**
         * The 30-second window a code was last accepted for.
         *
         * A TOTP code stays valid for its entire window, so without remembering
         * this the same six digits are accepted twice — which is exactly what
         * somebody who read them over a shoulder needs.
         */
        last_used_counter: { type: DataTypes.BIGINT, allowNull: true },
    }, {
        tableName: 'client_two_factor',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { unique: true, fields: ['website_client_id'], name: 'client_two_factor_client' },
        ],
        /*
          The secret is excluded by default for the same reason `password` is on
          WebsiteClient: the only code that should ever see it is the code that
          verifies a code against it, and that asks for it explicitly.
        */
        defaultScope: { attributes: { exclude: ['secret'] } },
        scopes: { withSecret: { attributes: {} } },
    });

    return ClientTwoFactor;
};
