const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Department = sequelize.define('Department', {
        id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        company_id:  { type: DataTypes.INTEGER, allowNull: true },
        name:        { type: DataTypes.STRING(200), allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        is_active:   { type: DataTypes.TINYINT, defaultValue: 1 },
    }, {
        tableName: 'departments',
        timestamps: true,
        paranoid: true,
        underscored: true,
    });

    return Department;
};
