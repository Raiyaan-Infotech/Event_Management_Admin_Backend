const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const District = sequelize.define('District', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        state_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        country_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        slug: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        is_default: {
            type: DataTypes.TINYINT,
            defaultValue: 0,
        },
        is_active: {
            type: DataTypes.TINYINT,
            defaultValue: 1,
            comment: '0=inactive, 1=active, 2=pending',
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        updated_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
    }, {
        tableName: 'districts',
        timestamps: true,
        paranoid: true,
    });

    return District;
};
