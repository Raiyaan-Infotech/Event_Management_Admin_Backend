const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/**
 * A person who signed themselves up on the public tenant website.
 *
 * Deliberately separate from `vendor_clients`, which holds clients a VENDOR
 * creates and then grants login access to (`login_access` + the handoff flow).
 * These rows are self-registered from the website's signup form.
 *
 * > Known trade-off, chosen explicitly: the same person can therefore exist in
 * > both tables with no link between them, and a website signup does NOT get a
 * > Client Portal login (that portal reads `vendor_clients`). If those two need
 * > to converge later, matching on (vendor_id, email) is the join to build.
 *
 * `vendor_id` is INT UNSIGNED to match `vendors.id` exactly — a signed INT here
 * would make the foreign key impossible, which has bitten this codebase four
 * times already.
 */
module.exports = (sequelize) => {
    const WebsiteClient = sequelize.define(
        'WebsiteClient',
        {
            id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },

            // Which tenant's website they signed up on. 1 = our own company.
            vendor_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
            // Mirrors the scoping every other admin module uses.
            company_id: { type: DataTypes.INTEGER, allowNull: true },

            name: { type: DataTypes.STRING(200), allowNull: false },
            email: { type: DataTypes.STRING(255), allowNull: false },
            dial_code: { type: DataTypes.STRING(8), allowNull: true, defaultValue: '+91' },
            mobile: { type: DataTypes.STRING(20), allowNull: true },
            password: { type: DataTypes.STRING(255), allowNull: true },

            // How the row was created. 'website' = the public signup form;
            // 'google'/'facebook' are reserved for when the provider flow is
            // wired to a real OAuth round trip.
            source: {
                type: DataTypes.ENUM('website', 'google', 'facebook', 'admin'),
                allowNull: false,
                defaultValue: 'website',
            },

            // The provider's own user id (Google `sub`, Facebook id). This, not
            // the email, is what identifies a social account: Facebook does not
            // always share an email, and a Google email can change.
            provider_id: { type: DataTypes.STRING(64), allowNull: true },
            avatar_url: { type: DataTypes.STRING(500), allowNull: true },

            // Verification is tracked but NOT enforced: there is no SMS provider
            // configured in this backend, so the signup form's OTP is still a
            // local-only UI. Kept so wiring a provider later is a flag flip.
            email_verified: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
            mobile_verified: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },

            // Mobile verification for the step that follows a social sign-in.
            // The code is stored hashed and never returned; `otp_attempts` caps
            // guessing, since six digits is only strong if you get few tries.
            otp_hash: { type: DataTypes.STRING(255), allowNull: true },
            otp_expires_at: { type: DataTypes.DATE, allowNull: true },
            otp_attempts: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },

            // 0=inactive, 1=active, 2=blocked — same convention as User/VendorClient.
            is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },

            last_login_at: { type: DataTypes.DATE, allowNull: true },

            // Null for a self-signup; set when an admin creates or edits the row.
            created_by: { type: DataTypes.INTEGER, allowNull: true },
            updated_by: { type: DataTypes.INTEGER, allowNull: true },
        },
        {
            tableName: 'website_clients',
            timestamps: true,
            paranoid: true,
            // Explicit snake_case attribute names, matching every other model
            // here. `underscored: true` maps the COLUMN but leaves the JS
            // attribute as `createdAt`, so the API would answer `createdAt`
            // while the rest of the app reads `created_at`.
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            deletedAt: 'deleted_at',
            defaultScope: {
                // A password hash must never leave the service by accident.
                attributes: { exclude: ['password', 'otp_hash'] },
            },
            scopes: {
                withPassword: { attributes: { include: ['password'] } },
            },
            hooks: {
                beforeValidate: (client) => {
                    if (client.email) client.email = normalizeEmail(client.email);
                },
                beforeCreate: async (client) => {
                    if (client.password) client.password = await bcrypt.hash(client.password, 12);
                },
                beforeUpdate: async (client) => {
                    if (client.changed('password') && client.password) {
                        client.password = await bcrypt.hash(client.password, 12);
                    }
                },
            },
        }
    );

    return WebsiteClient;
};
