const { DataTypes } = require('sequelize');

/**
 * One row per menu included in a plan, with its display order.
 *
 * No platform and no limits here: where a menu shows is decided by the menu's
 * own per-platform Active switch, and usage limits live on the plan itself.
 */
module.exports = (sequelize) => {
    const SubscriptionPlanMenu = sequelize.define('SubscriptionPlanMenu', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        menu_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
    }, {
        tableName: 'subscription_plan_menus',
        timestamps: true,
        // No soft delete: these rows are rewritten wholesale when a plan's menu
        // selection is saved, and a deleted_at would make the UNIQUE
        // (plan_id, menu_id) index reject re-adding a menu that was removed.
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    return SubscriptionPlanMenu;
};
