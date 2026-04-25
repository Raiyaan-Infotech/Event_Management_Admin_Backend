const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorSocialLink = sequelize.define('VendorSocialLink', {
        id:         { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        vendor_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        icon:       { type: DataTypes.STRING(200), allowNull: true },
        icon_color: { type: DataTypes.STRING(20),  allowNull: true },
        label:      { type: DataTypes.STRING(100), allowNull: false },
        url:        { type: DataTypes.STRING(500), allowNull: false },
        is_active:  { type: DataTypes.TINYINT,    allowNull: false, defaultValue: 1 },
        sort_order: { type: DataTypes.INTEGER,    allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'vendor_social_links',
        timestamps: true,
        paranoid: true,
    });

    return VendorSocialLink;
};
