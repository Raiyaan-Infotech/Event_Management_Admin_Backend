const { DataTypes } = require('sequelize');

/**
 * One single-use backup code for a website client's 2FA.
 *
 * ── WHY A ROW PER CODE AND NOT A JSON ARRAY ─────────────────────────────────
 * "Used" is a fact about ONE code. Held as an array on the client row, two codes
 * being spent at the same moment overwrite each other's update and one of them
 * silently becomes usable again — which is the one property a single-use code
 * has to have.
 *
 * ── WHY HASHED ──────────────────────────────────────────────────────────────
 * A backup code signs somebody in without the authenticator, so it is a
 * credential in exactly the way a password is. Stored readable, a database dump
 * is a list of working keys. bcrypt, like every other secret in this system.
 *
 * The consequence is the usual one and is deliberate: the plaintext codes are
 * shown ONCE, at the moment they are generated, and can never be shown again —
 * only regenerated, which invalidates the old set.
 */
module.exports = (sequelize) => {
    const ClientBackupCode = sequelize.define('ClientBackupCode', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        code_hash: { type: DataTypes.STRING(255), allowNull: false },
        /** NULL means unspent. Set once, never cleared. */
        used_at: { type: DataTypes.DATE, allowNull: true },
    }, {
        tableName: 'client_backup_codes',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { fields: ['website_client_id', 'used_at'], name: 'client_backup_codes_client' },
        ],
    });

    return ClientBackupCode;
};
