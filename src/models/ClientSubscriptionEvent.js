const { DataTypes } = require('sequelize');

/**
 * What happened to a client's subscription, one row per event.
 *
 * This is the log behind the Billing History screen's "Subscription created" /
 * "Plan changed" rows, and the reason a cancellation can be explained rather
 * than merely observed.
 *
 * ── Append-only, deliberately ───────────────────────────────────────────────
 * NOT paranoid and with no `deleted_at`: a billing history somebody can quietly
 * remove rows from is not a history. Nothing in the service deletes from here;
 * rows go only when the parent subscription or client is hard-deleted, via the
 * FK cascade.
 *
 * ── Separate from client_subscriptions on purpose ───────────────────────────
 * A subscription has ONE current state and MANY things that have happened to
 * it. Collapsing the log onto the subscription row would keep only the most
 * recent, which is exactly the information a history screen does not want.
 */
module.exports = (sequelize) => {
    const ClientSubscriptionEvent = sequelize.define('ClientSubscriptionEvent', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        client_subscription_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        // Denormalised from the parent so the history can be read for a client
        // without joining through every subscription they have ever had.
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        type: {
            type: DataTypes.ENUM(
                'created',
                'change_scheduled',
                'change_cancelled',
                'change_applied',
                'plan_changed',
                'cancelled',
                'resumed',
                'renewed',
                'expired',
            ),
            allowNull: false,
        },
        from_plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        to_plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        description: {
            type: DataTypes.STRING(300),
            allowNull: true,
        },
        // Pre-tax, and NULL where the event carries no money at all — a
        // scheduled change is not a charge. NULL and 0.00 are different claims.
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
        },
        currency_code: {
            type: DataTypes.STRING(10),
            allowNull: true,
        },
        /**
         * Who caused it. A period rollover is `system` — nobody pressed
         * anything — and an admin reassigning a plan from the Clients screen is
         * `admin`, which is worth being able to tell apart from the client
         * doing it themselves.
         */
        actor: {
            type: DataTypes.ENUM('client', 'admin', 'system'),
            allowNull: false,
            defaultValue: 'client',
        },
        actor_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        occurred_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
    }, {
        tableName: 'client_subscription_events',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { fields: ['website_client_id', 'occurred_at'] },
            { fields: ['client_subscription_id'] },
        ],
    });

    return ClientSubscriptionEvent;
};
