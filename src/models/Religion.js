const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Religion = sequelize.define('Religion', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        // A religion is scoped under an event type, the same way an event type
        // is scoped under a category. Both are stored so the Menu form can
        // filter on either without a join.
        event_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        event_type_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        icon: {
            type: DataTypes.STRING(100),
            allowNull: true,
            defaultValue: '',
        },
        color: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        is_active: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        company_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        updated_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
    }, {
        tableName: 'religions',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return Religion;
};
