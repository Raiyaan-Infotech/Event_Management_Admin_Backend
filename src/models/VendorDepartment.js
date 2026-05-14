const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorDepartment = sequelize.define('VendorDepartment', {
        id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        vendor_id:   { type: DataTypes.INTEGER, allowNull: false },
        company_id:  { type: DataTypes.INTEGER, allowNull: true },
        name:        { type: DataTypes.STRING(200), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        is_active:   { type: DataTypes.TINYINT, defaultValue: 1 },
    }, {
        tableName: 'vendor_departments',
        timestamps: true,
        paranoid: true,
        underscored: true,
    });

    return VendorDepartment;
};
