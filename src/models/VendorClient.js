const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorClient = sequelize.define('VendorClient', {
        id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        vendor_id:        { type: DataTypes.INTEGER, allowNull: false },
        client_id:        { type: DataTypes.STRING(50),  allowNull: true },
        name:             { type: DataTypes.STRING(200), allowNull: false },
        mobile:           { type: DataTypes.STRING(20),  allowNull: false },
        email:            { type: DataTypes.STRING(255), allowNull: false },
        profile_pic:      { type: DataTypes.TEXT('long'), allowNull: true },
        registration_type: {
            type: DataTypes.ENUM('guest', 'client'),
            defaultValue: 'client',
        },
        plan: {
            type: DataTypes.ENUM('silver', 'gold', 'platinum', 'standard', 'not_subscribed'),
            defaultValue: 'not_subscribed',
        },
        // 0=inactive, 1=active, 2=blocked  (consistent with User model is_active pattern)
        is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
        address:  { type: DataTypes.TEXT,        allowNull: true },
        country:  { type: DataTypes.STRING(100), allowNull: true },
        state:    { type: DataTypes.STRING(100), allowNull: true },
        district: { type: DataTypes.STRING(100), allowNull: true },
        city:     { type: DataTypes.STRING(100), allowNull: true },
        locality: { type: DataTypes.STRING(100), allowNull: true },
        pincode:  { type: DataTypes.STRING(20),  allowNull: true },
        company_id: { type: DataTypes.INTEGER, allowNull: true },
    }, {
        tableName: 'vendor_clients',
        timestamps: true,
        paranoid: true,
        underscored: true,
    });

    return VendorClient;
};
