const { DataTypes } = require('sequelize');

/**
 * A card (or other instrument) a client has saved for future payments.
 *
 * ── ⚠ THE CARD IS NOT HERE, AND MUST NEVER BE ───────────────────────────────
 * There is no attribute for a card number and none for a CVC. The gateway takes
 * the card directly from the browser and returns a TOKEN; that token, plus the
 * brand, last four and expiry, is all this row holds.
 *
 *  · A full card number in this database would make this project a party to
 *    PCI DSS — assessment, segmentation, key rotation, breach liability.
 *  · A CVC may not be retained after authorisation by anyone, compliant or not.
 *
 * If a future change makes it tempting to "just store the number for now":
 * don't. `addPaymentMethod` in clientBilling.service.js actively REFUSES a body
 * that looks like a PAN, so the refusal survives somebody editing the form.
 *
 * ── TWO MODES ───────────────────────────────────────────────────────────────
 * TOKENISED — a provider took the card and this row holds their token.
 * MANUAL    — no provider exists; money arrives out of band and a payment is
 *             recorded by hand afterwards. The row is then not a chargeable
 *             instrument at all but a RECORD OF HOW THE CLIENT PAYS: a UPI
 *             address, or a bank account named by its last four and IFSC.
 *
 * A manual row has `gateway = 'manual'`, no token, and `is_verified = 0` —
 * the client typed it and nobody checked it. A tokenised row is verified by
 * construction, because the provider did the checking.
 *
 * ── SOFT DELETE, DELIBERATELY ───────────────────────────────────────────────
 * A card the client removes is still named by the invoices it paid ("Visa ····
 * 4242"). Hard-deleting the row would blank the payment method on last year's
 * receipts, so removal is `deleted_at` plus `status = 'removed'`.
 */
module.exports = (sequelize) => {
    const ClientPaymentMethod = sequelize.define('ClientPaymentMethod', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        /**
         * Which provider holds the card.
         *
         * Stored per ROW rather than assumed globally: the day a second gateway
         * is added, or the first is swapped out, every existing row still says
         * who to ask about it. A single-provider assumption baked into the code
         * is what makes that migration painful.
         */
        gateway: {
            type: DataTypes.STRING(30),
            allowNull: false,
        },
        gateway_customer_id: {
            type: DataTypes.STRING(120),
            allowNull: true,
        },
        /**
         * The token that stands in for the card. Useless without the provider's
         * secret key.
         *
         * NULL for a manual row: there is no provider to issue one, and
         * inventing a token would put a value in the unique index that looks
         * like it could charge something.
         */
        gateway_payment_method_id: {
            type: DataTypes.STRING(120),
            allowNull: true,
        },

        /* ── Display only. Cannot be used to charge anything. ─────────────── */
        brand: {
            type: DataTypes.STRING(30),
            allowNull: true,
        },
        last4: {
            type: DataTypes.CHAR(4),
            allowNull: true,
        },
        exp_month: {
            type: DataTypes.TINYINT.UNSIGNED,
            allowNull: true,
        },
        exp_year: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: true,
        },
        holder_name: {
            type: DataTypes.STRING(120),
            allowNull: true,
        },

        /* ── Manual methods ───────────────────────────────────────────────
           A UPI ID is a payment ADDRESS, not a credential — knowing it lets
           somebody pay you, never charge you. The bank fields are the last four
           and the IFSC, which is a public branch routing code. There is
           deliberately no column for a full account number: last four is enough
           to recognise an account and to match a statement line, and the rest is
           liability with no extra use. */
        upi_id: {
            type: DataTypes.STRING(120),
            allowNull: true,
        },
        bank_name: {
            type: DataTypes.STRING(120),
            allowNull: true,
        },
        account_last4: {
            type: DataTypes.CHAR(4),
            allowNull: true,
        },
        ifsc: {
            type: DataTypes.STRING(11),
            allowNull: true,
        },

        /** 'card' | 'upi' | 'bank_transfer'. */
        method_type: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'card',
        },

        is_default: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        /**
         * Whether anybody has CHECKED this.
         *
         * A manual method is typed by the client — nothing confirms the UPI ID
         * resolves or that the account is theirs. The screens say so rather
         * than presenting client-supplied text as though it were confirmed.
         */
        is_verified: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        /**
         * `expired` is derived and then STORED on read, so a card that lapsed
         * looks lapsed without every screen having to do the date arithmetic
         * itself — the §315 lesson about a state that had no name.
         */
        status: {
            type: DataTypes.ENUM('active', 'expired', 'removed'),
            allowNull: false,
            defaultValue: 'active',
        },
    }, {
        tableName: 'client_payment_methods',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        indexes: [
            { unique: true, fields: ['gateway', 'gateway_payment_method_id'] },
            { fields: ['website_client_id', 'deleted_at', 'is_default'] },
        ],
    });

    return ClientPaymentMethod;
};
