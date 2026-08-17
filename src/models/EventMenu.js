const { DataTypes } = require('sequelize');

/**
 * Event menu catalogue (Menu Management).
 *
 * Distinct from the `menus` model, which is the admin panel's own menu-item
 * registry. This one is scoped by event category / type / religion and is what
 * the website and the mobile app read their menu list from.
 *
 * Platform targeting lives in two booleans rather than a SET column so the list
 * filters can use an index — see scratch/setup_menu_management.js. The service
 * layer maps them to and from the `menu_type: ['website','mobile']` array the
 * API speaks.
 */
module.exports = (sequelize) => {
    const EventMenu = sequelize.define('EventMenu', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(150),
            allowNull: false,
        },
        slug: {
            type: DataTypes.STRING(180),
            allowNull: false,
        },
        // Drives the Core / Additional / Custom sections on Manage Plan Menus.
        menu_group: {
            type: DataTypes.ENUM('core', 'additional', 'custom'),
            allowNull: false,
            defaultValue: 'core',
        },
        event_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        event_type_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        religion_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        is_website: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        is_mobile: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        display_website: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        display_mobile: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        active_website: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        active_mobile: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
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
        tableName: 'event_menus',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventMenu;
};
