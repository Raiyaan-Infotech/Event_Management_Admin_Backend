const { DataTypes } = require('sequelize');

/**
 * The money ledger for a client.
 *
 * ── WHY THIS IS NOT client_subscription_events ──────────────────────────────
 * They answer different questions, and the Billing History screen shows both.
 * `client_subscription_events` is the LIFECYCLE log — created, plan changed,
 * cancelled, resumed. This is MONEY — an invoice raised, a payment made, a
 * refund. Merging them would mean either a lifecycle row carrying a nullable
 * amount forever, or a money row for "plan changed", which is not money.
 * The history endpoint merges the two at read time instead.
 *
 * ── `amount` IS SIGNED, FROM THE CLIENT'S SIDE ──────────────────────────────
 * An invoice raised is POSITIVE (you owe this); a payment is NEGATIVE (this
 * left you). That is what makes the design's history column — `- ₹1,499.00`
 * against a payment, `₹1,499.00` against an invoice — fall out of the data
 * rather than being decided by a switch in the UI.
 *
 * ⚠ `gateway` and `gateway_transaction_id` are null throughout and will stay
 * that way until a payment provider exists. They are here so that wiring one
 * later is an INSERT, not a migration — and so nothing has to invent a
 * reference in the meantime.
 */
module.exports = (sequelize) => {
    const ClientTransaction = sequelize.define('ClientTransaction', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        client_subscription_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        invoice_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        type: {
            type: DataTypes.ENUM('invoice', 'payment', 'refund', 'adjustment', 'setup'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('pending', 'successful', 'failed', 'completed'),
            allowNull: false,
            defaultValue: 'completed',
        },
        description: { type: DataTypes.STRING(300), allowNull: true },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        currency_code: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
        reference: { type: DataTypes.STRING(80), allowNull: true },
        gateway: { type: DataTypes.STRING(50), allowNull: true },
        gateway_transaction_id: { type: DataTypes.STRING(190), allowNull: true },

        /**
         * WHICH saved card paid this, and what it looked like at the time.
         *
         * The id is the live link — follow it for the expiry and the status.
         * The two snapshot columns are what an ARCHIVED invoice prints: they
         * are written once, at payment time, and never updated, so a receipt
         * cannot change its wording because the card row was later edited or
         * removed.
         *
         * ⚠ Both snapshot fields are DISPLAY ONLY and are a copy of what
         * `client_payment_methods` already holds. There is no card number and
         * no CVC in this table, in that one, or anywhere else — see §341 and
         * `assertNoRawCard()`.
         *
         * Null on every row until a payment provider exists.
         */
        client_payment_method_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        method_brand: { type: DataTypes.STRING(30), allowNull: true },
        method_last4: { type: DataTypes.CHAR(4), allowNull: true },
        /**
         * The rendered name, snapshot at payment time.
         *
         * A card is brand + last4; a UPI address is neither, so reassembling a
         * label from parts only works for one method type. This holds what the
         * invoice actually prints — "Visa ending in 4242", "UPI · name@bank".
         */
        method_label: { type: DataTypes.STRING(120), allowNull: true },

        occurred_at: { type: DataTypes.DATE, allowNull: false },
    }, {
        tableName: 'client_transactions',
        timestamps: true,
        // Append-only, like the subscription event log: a ledger somebody can
        // quietly remove rows from is not a ledger.
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { fields: ['website_client_id', 'occurred_at'] },
            { fields: ['invoice_id'] },
            { fields: ['client_payment_method_id'] },
        ],
    });

    return ClientTransaction;
};
