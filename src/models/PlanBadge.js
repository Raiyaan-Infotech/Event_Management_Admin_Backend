const { DataTypes } = require('sequelize');

/**
 * A badge that can be pinned to subscription plan cards ("Most Popular",
 * "Best Value", …).
 *
 * `apply_to = 'all'` ignores plan_badge_plans entirely; `'selected'` reads it.
 * The module-level switches (badges on/off, corner position) are not here —
 * they are single values in the `settings` table under the `plan_badges` group,
 * because they belong to the module rather than to any one badge.
 */
module.exports = (sequelize) => {
    const PlanBadge = sequelize.define('PlanBadge', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        text: {
            type: DataTypes.STRING(25),
            allowNull: false,
        },
        style: {
            type: DataTypes.ENUM('default', 'rounded', 'pill', 'outline', 'soft', 'dashed'),
            allowNull: false,
            defaultValue: 'default',
        },
        color: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: '#6E22FE',
        },
        apply_to: {
            type: DataTypes.ENUM('all', 'selected'),
            allowNull: false,
            defaultValue: 'all',
        },
        is_active: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
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
        tableName: 'plan_badges',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return PlanBadge;
};
