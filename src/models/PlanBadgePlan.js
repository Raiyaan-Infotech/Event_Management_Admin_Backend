const { DataTypes } = require('sequelize');

/**
 * Which plans a badge is pinned to, when its apply_to is 'selected'.
 *
 * No soft delete and no timestamps: these rows are rewritten wholesale each
 * time a badge is saved, and a deleted_at would make the UNIQUE
 * (badge_id, plan_id) index reject re-adding a plan that was removed.
 */
module.exports = (sequelize) => {
    const PlanBadgePlan = sequelize.define('PlanBadgePlan', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        badge_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'plan_badge_plans',
        timestamps: false,
        paranoid: false,
    });

    return PlanBadgePlan;
};
