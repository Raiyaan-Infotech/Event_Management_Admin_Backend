/**
 * The sign-in code for an event contact person's mobile (2026-10-26). Not an
 * account — the contact person lives on the event. See
 * migrations/sql/20261026-contact-person-logins.sql.
 */
module.exports = (sequelize, DataTypes) => sequelize.define(
    'ContactPersonLogin',
    {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        vendor_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        mobile: { type: DataTypes.STRING(20), allowNull: false },
        otp_hash: { type: DataTypes.STRING(255), allowNull: true },
        otp_expires_at: { type: DataTypes.DATE, allowNull: true },
        otp_attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        last_login_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'contact_person_logins', timestamps: true, underscored: true },
);
