const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
    const Vendor = sequelize.define('Vendor', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // Company Info
        company_name:    { type: DataTypes.STRING(255), allowNull: false },
        company_logo:    { type: DataTypes.STRING(500), allowNull: true },
        country_id:      { type: DataTypes.INTEGER,     allowNull: true },
        state_id:        { type: DataTypes.INTEGER,     allowNull: true },
        city_id:         { type: DataTypes.INTEGER,     allowNull: true },
        pincode_id:      { type: DataTypes.INTEGER,     allowNull: true },
        latitude:        { type: DataTypes.DECIMAL(10, 7), allowNull: true },
        longitude:       { type: DataTypes.DECIMAL(10, 7), allowNull: true },
        reg_no:          { type: DataTypes.STRING(100), allowNull: true },
        gst_no:          { type: DataTypes.STRING(100), allowNull: true },
        company_address: { type: DataTypes.TEXT,        allowNull: true },
        about_us:        { type: DataTypes.TEXT,        allowNull: true },
        company_contact: { type: DataTypes.STRING(20),  allowNull: true },
        landline:        { type: DataTypes.STRING(20),  allowNull: true },
        company_email:   { type: DataTypes.STRING(255), allowNull: true },
        website:         { type: DataTypes.STRING(500), allowNull: true },
        youtube:         { type: DataTypes.STRING(500), allowNull: true },
        facebook:        { type: DataTypes.STRING(500), allowNull: true },
        instagram:       { type: DataTypes.STRING(500), allowNull: true },
        twitter:         { type: DataTypes.STRING(500), allowNull: true },
        linkedin:        { type: DataTypes.STRING(500), allowNull: true },
        whatsapp:        { type: DataTypes.STRING(100), allowNull: true },
        tiktok:          { type: DataTypes.STRING(500), allowNull: true },
        telegram:        { type: DataTypes.STRING(500), allowNull: true },
        pinterest:       { type: DataTypes.STRING(500), allowNull: true },

        // Vendor (Person) Info
        name:        { type: DataTypes.STRING(200), allowNull: false },
        profile:     { type: DataTypes.STRING(500), allowNull: true },
        address:     { type: DataTypes.TEXT,        allowNull: true },
        alt_address: { type: DataTypes.TEXT,        allowNull: true },
        contact:     { type: DataTypes.STRING(50),  allowNull: true },
        alt_contact: { type: DataTypes.STRING(50),  allowNull: true },
        alt_email:   { type: DataTypes.STRING(255), allowNull: true },
        email:       { type: DataTypes.STRING(255), allowNull: false, unique: true },
        password:   { type: DataTypes.STRING(255), allowNull: false },
        membership: {
            type: DataTypes.ENUM('basic', 'silver', 'gold', 'platinum'),
            defaultValue: 'basic',
        },
        copywrite:   { type: DataTypes.STRING(255), allowNull: true },
        poweredby:  { type: DataTypes.STRING(255), allowNull: true },

        // Bank Info
        bank_name: { type: DataTypes.STRING(200), allowNull: true },
        acc_no:    { type: DataTypes.STRING(100), allowNull: true },
        ifsc_code: { type: DataTypes.STRING(50),  allowNull: true },
        acc_type:  { type: DataTypes.ENUM('savings', 'current', 'overdraft'), allowNull: true },
        branch:    { type: DataTypes.STRING(200), allowNull: true },
        bank_logo: { type: DataTypes.STRING(500), allowNull: true },

        // Password reset
        password_reset_token:   { type: DataTypes.STRING(10), allowNull: true },
        password_reset_expires: { type: DataTypes.DATE,       allowNull: true },

        // Meta
        status:     { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
        company_id: { type: DataTypes.INTEGER, allowNull: true },
    }, {
        tableName: 'vendors',
        timestamps: true,
        paranoid: true,
        hooks: {
            beforeCreate: async (vendor) => {
                if (vendor.password) {
                    vendor.password = await bcrypt.hash(vendor.password, 12);
                }
            },
            beforeUpdate: async (vendor) => {
                if (vendor.changed('password')) {
                    vendor.password = await bcrypt.hash(vendor.password, 12);
                }
            },
        },
    });

    Vendor.prototype.validatePassword = async function (password) {
        return bcrypt.compare(password, this.password);
    };

    Vendor.prototype.toJSON = function () {
        const values = { ...this.get() };
        delete values.password;
        delete values.password_reset_token;
        delete values.password_reset_expires;
        return values;
    };

    return Vendor;
};
