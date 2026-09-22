const { DataTypes } = require('sequelize');

/**
 * Event menu catalogue (Menu Management).
 *
 * Distinct from the `menus` model, which is the admin panel's own menu-item
 * registry. This one is what the website and the mobile app read their menu
 * list from.
 *
 * Scoped by event CATEGORY only. The PLAN's W/M switch
 * (subscription_plan_menus) decides which platform a menu shows on.
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
        // Shown on the View Menu page's Additional Information card.
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        remarks: {
            type: DataTypes.STRING(300),
            allowNull: true,
        },
        // Drives the Core / Additional / Custom sections on Manage Plan Menus.
        // 'portal' = a client-portal SIDEBAR section (Guests, Messages, …), not
        // an event feature: never offered by the event wizard. See
        // apply-portal-section-menus.js.
        // 'app' = a mobile APP feature (Chat, Wishes, Invite & Share, …): granted
        // by the plan alone, not chosen per event. See apply-app-feature-menus.js.
        menu_group: {
            type: DataTypes.ENUM('core', 'additional', 'custom', 'portal', 'app'),
            allowNull: false,
            defaultValue: 'core',
        },
        event_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
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
        // 1 = a default menu: a new plan starts with it ticked (the admin can
        // untick it). 0 = an add-on feature, off until a plan adds it.
        is_default: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
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
