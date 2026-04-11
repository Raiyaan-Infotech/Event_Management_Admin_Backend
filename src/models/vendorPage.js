const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorPage = sequelize.define('VendorPage', {
        id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name:        { type: DataTypes.STRING(255), allowNull: false },
        description: { type: DataTypes.TEXT,        allowNull: true },
        content: { type: DataTypes.TEXT('long'), allowNull: true },
        is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
        vendor_id:   { type: DataTypes.INTEGER, allowNull: true },
        company_id:  { type: DataTypes.INTEGER, allowNull: true },
        created_by:  { type: DataTypes.INTEGER, allowNull: true },
        updated_by:  { type: DataTypes.INTEGER, allowNull: true },
        deleted_by:  { type: DataTypes.INTEGER, allowNull: true },
    }, {
        tableName:  'vendor_pages',
        timestamps: true,
        paranoid:   true,
    });

    return VendorPage;
};