const { DataTypes } = require('sequelize');

/**
 * A subscription plan, built through the 6-step wizard.
 *
 * Scoped by event_category_id only, NULLABLE on purpose: NULL means "applies
 * to all", which the list screen renders as "All Categories".
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
        event_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // Wizard step 4 — usage limits, NULL = unlimited. See LIMIT_FIELDS in
        // subscriptionPlan.service.js for which of these are enforced.
        max_events: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        max_guests_per_event: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        // Attendance for ONE event, counted in people saying yes — including a
        // QR scanner who was never in the guest list (§571). Separate from
        // max_guests, which counts phone-book contacts on the account.
        max_rsvp_per_event: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        max_photos: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        max_videos: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        // A pair: 1–100 + MB / GB, both NULL = unlimited.
        storage_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        storage_unit: { type: DataTypes.ENUM('MB', 'GB'), allowNull: true },
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
