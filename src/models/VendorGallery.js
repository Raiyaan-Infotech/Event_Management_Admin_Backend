const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorGallery = sequelize.define('VendorGallery', {
        id:         { type: DataTypes.BIGINT,       primaryKey: true, autoIncrement: true },
        event_name: { type: DataTypes.STRING(255),  allowNull: false },
        city:       { type: DataTypes.STRING(255),  allowNull: false },
        event_img:  { type: DataTypes.STRING(500),  allowNull: true },
        is_active:  { type: DataTypes.TINYINT,      defaultValue: 1 },
        vendor_id:  { type: DataTypes.INTEGER,      allowNull: true },
        company_id: { type: DataTypes.INTEGER,      allowNull: true },
        created_by: { type: DataTypes.INTEGER,      allowNull: true },
        deleted_by: { type: DataTypes.INTEGER,      allowNull: true },
    }, {
        tableName:  'vendor_gallery',
        timestamps: true,
        paranoid:   true,
        underscored: false,
    });

    return VendorGallery;
};