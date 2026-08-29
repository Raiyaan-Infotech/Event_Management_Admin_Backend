const { DataTypes } = require('sequelize');

/**
 * A website client's subscription term.
 *
 * `website_clients.subscription_plan_id` says WHICH plan an account is on and
 * nothing more. This row says when the term started, when it renews, what was
 * actually charged and whether it has been cancelled — everything the Billing
 * screens ask for and none of which a bare FK can answer.
 *
 * ── The two are not duplicates ──────────────────────────────────────────────
 *   website_clients.subscription_plan_id   ENTITLEMENT — what this account may
 *                                          do right now. Read by ClientPlanGate,
 *                                          getEventOptions and templatesForPlan.
 *   client_subscriptions                   BILLING — what was bought, for how
 *                                          long, at what price.
 *
 * `clientBilling.service` is the only writer of both, so they cannot drift.
 *
 * ── price / billing_cycle / tax_rate are SNAPSHOTS ──────────────────────────
 * Copied from the plan when the term starts, never read through to it. An admin
 * raising a plan's price must not silently re-price everyone already on it, and
 * a term that has been invoiced has to keep reporting what it charged.
 *
 * `tax_rate` is EXCLUSIVE: `price` is pre-tax and tax is added on top.
 */
module.exports = (sequelize) => {
    const ClientSubscription = sequelize.define('ClientSubscription', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        // Nullable + ON DELETE SET NULL: retiring a plan must never delete
        // somebody's subscription history along with it.
        subscription_plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // Signed INT to match website_clients.company_id. An FK column has to
        // match the referenced column's type AND signedness exactly.
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        vendor_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        /**
         * Stored lifecycle. "expired" is ALSO derived at read time once
         * `current_period_end` passes — see deriveStatus() in the service.
         *
         * Storing expiry alone would need a nightly job flipping rows and would
         * leave a window where the database disagrees with the calendar.
         * Deriving it alone would lose an explicit cancellation. Both, with one
         * function that decides.
         */
        status: {
            type: DataTypes.ENUM('trialing', 'active', 'cancelled', 'expired'),
            allowNull: false,
            defaultValue: 'active',
        },
        billing_cycle: {
            type: DataTypes.ENUM('monthly', 'quarterly', 'yearly', 'lifetime'),
            allowNull: false,
            defaultValue: 'monthly',
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0.0,
        },
        currency_code: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'INR',
        },
        tax_rate: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
            defaultValue: 18.0,
        },
        started_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        current_period_start: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        // NULL means lifetime — there is no renewal date, which is different
        // from "we do not know it".
        current_period_end: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        trial_ends_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        /**
         * Cancelling keeps access until the period ends rather than cutting it
         * off mid-term. Somebody who has paid through June should have June.
         */
        cancel_at_period_end: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
        },
        cancelled_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        cancellation_reason: {
            type: DataTypes.STRING(150),
            allowNull: true,
        },
        cancellation_comments: {
            type: DataTypes.STRING(300),
            allowNull: true,
        },
        /**
         * A plan change scheduled for the end of the current period, which is
         * what the Change Plan screen's own banner promises ("effective from
         * the end of your current billing cycle").
         *
         * Applied LAZILY on read, not by a cron. Render sleeps a free instance,
         * so a scheduled job is not a thing that reliably happens; a rollover
         * that runs when somebody looks cannot be missed.
         */
        pending_plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        pending_effective_at: {
            type: DataTypes.DATE,
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
        tableName: 'client_subscriptions',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        indexes: [
            { fields: ['website_client_id', 'deleted_at', 'status'] },
            { fields: ['subscription_plan_id'] },
            { fields: ['current_period_end'] },
        ],
    });

    return ClientSubscription;
};
