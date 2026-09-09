const { DataTypes } = require('sequelize');

/**
 * Master data for the "Notification Category" dropdown on Notification
 * Templates — e.g. "Event & Invitation", "RSVP & Participation". Admin
 * managed rather than a hardcoded ENUM, same reasoning as EventCategory:
 * a fixed list can't be renamed or extended without a code deploy.
 */
module.exports = (sequelize) => {
    const NotificationCategory = sequelize.define('NotificationCategory', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
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
        tableName: 'notification_categories',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return NotificationCategory;
};
