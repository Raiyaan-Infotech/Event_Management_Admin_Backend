const { DataTypes } = require('sequelize');

/**
 * One row per menu included in a plan.
 *
 * Not a flat menu_ids array on the plan, because wizard step 2 picks each menu
 * *per platform* and step 4 hangs per-menu limits off it — neither fits in a
 * list of ids.
 *
 * `limits_json` is keyed by the menu limit catalogue in
 * subscriptionPlan.service.js (e.g. { max_photos: 500, storage_gb: 100 }).
 * A missing key means "unlimited", which is what the form shows by default.
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
        for_website: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
        },
        for_mobile: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
        },
        limits_json: {
            type: DataTypes.JSON,
            allowNull: true,
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
