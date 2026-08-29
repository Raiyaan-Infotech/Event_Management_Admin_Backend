const { DataTypes } = require('sequelize');

/**
 * An invoice for one billing term.
 *
 * ── THE BILLING SNAPSHOT IS THE POINT ───────────────────────────────────────
 * `billing_name` / `billing_email` / `billing_address` / `billing_gstin` are
 * COPIED here when the invoice is raised, never joined from the client row. An
 * invoice records what was billed to whom at that moment; re-deriving it would
 * silently rewrite last year's invoices the day somebody edits their profile.
 *
 * It is also the only place a billing address exists at all — `website_clients`
 * has no address columns — so these stay null until there is a form to fill them.
 *
 * ── TAX IS EXCLUSIVE ────────────────────────────────────────────────────────
 *   total = subtotal - discount_amount + tax_amount
 * `tax_inclusive` is stored explicitly so no screen has to infer it, and
 * `tax_breakdown` holds the components as JSON (CGST + SGST at half each,
 * matching the supplied design). JSON because an inter-state supply is a single
 * IGST line instead, and deciding which needs a place-of-supply comparison —
 * the company's state and the client's, neither of which is stored anywhere.
 *
 * ── NOTHING BECOMES `paid` ON ITS OWN ───────────────────────────────────────
 * There is no payment provider, so an invoice is raised as `issued` and stays
 * there. "Unpaid" is a DERIVED reading of `issued` + `amount_due > 0`, not a
 * stored status — a stored one would need something to move it, and nothing can.
 */
module.exports = (sequelize) => {
    const ClientInvoice = sequelize.define('ClientInvoice', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        // Sequential per company, INV-YYYY-NNNNNN. Unique on
        // (company_id, invoice_number) — two companies may both have 000123.
        invoice_number: {
            type: DataTypes.STRING(40),
            allowNull: false,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        // SET NULL rather than CASCADE: deleting a subscription must not
        // destroy the invoices raised against it. They are financial records.
        client_subscription_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        subscription_plan_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('draft', 'issued', 'paid', 'partially_paid', 'cancelled', 'refunded'),
            allowNull: false,
            defaultValue: 'issued',
        },
        issue_date: { type: DataTypes.DATEONLY, allowNull: false },
        due_date: { type: DataTypes.DATEONLY, allowNull: true },
        paid_at: { type: DataTypes.DATE, allowNull: true },
        period_start: { type: DataTypes.DATEONLY, allowNull: true },
        period_end: { type: DataTypes.DATEONLY, allowNull: true },
        currency_code: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'INR',
        },
        subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        discount_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        tax_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 18 },
        tax_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        tax_breakdown: { type: DataTypes.JSON, allowNull: true },
        tax_inclusive: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
        total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        amount_paid: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        amount_due: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        billing_name: { type: DataTypes.STRING(150), allowNull: true },
        billing_email: { type: DataTypes.STRING(190), allowNull: true },
        billing_address: { type: DataTypes.TEXT, allowNull: true },
        billing_gstin: { type: DataTypes.STRING(20), allowNull: true },
        notes: { type: DataTypes.STRING(500), allowNull: true },
        created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        updated_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'client_invoices',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        indexes: [
            { fields: ['website_client_id', 'deleted_at', 'issue_date'] },
            { fields: ['website_client_id', 'status'] },
        ],
    });

    return ClientInvoice;
};
