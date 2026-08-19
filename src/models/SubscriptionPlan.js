const { DataTypes } = require('sequelize');

/**
 * A subscription plan, built through the 6-step wizard.
 *
 * The event_category_id / event_type_id / religion_id scope is NULLABLE on
 * purpose: NULL means "applies to all", which is what the list screen renders
 * as "All Categories" / "All Types" / "All Religions".
 */
module.exports = (sequelize) => {
    const SubscriptionPlan = sequelize.define('SubscriptionPlan', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(150),
            allowNull: false,
        },
        plan_code: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        // Signed INT, not UNSIGNED: plan_types.id is a signed INT and an FK
        // column has to match the referenced column's signedness exactly.
        plan_type_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        billing_cycle: {
            type: DataTypes.ENUM('monthly', 'quarterly', 'yearly', 'lifetime'),
            allowNull: false,
            defaultValue: 'monthly',
        },
        short_description: {
            type: DataTypes.STRING(200),
            allowNull: true,
        },
        for_website: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        for_mobile: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
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
        currency_code: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'INR',
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0.0,
        },
        trial_days: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        is_visible: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
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
        // The badge shown on this plan's card, picked in wizard step 1.
        // Nullable because most plans carry no badge, and the FK is
        // ON DELETE SET NULL so deleting a badge never deletes the plan.
        plan_badge_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // Deactivation / deletion audit — feeds the confirm + success screens.
        // No DB foreign key on the *_by columns: users.id is a signed INT while
        // these follow created_by/updated_by as INT UNSIGNED. The Sequelize
        // association still joins, exactly as created_by already does.
        deactivation_reason: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        deactivation_comments: {
            type: DataTypes.STRING(300),
            allowNull: true,
        },
        deactivated_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        deactivated_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        deletion_reason: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
        deletion_comments: {
            type: DataTypes.STRING(300),
            allowNull: true,
        },
        deleted_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
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
        tableName: 'subscription_plans',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return SubscriptionPlan;
};
