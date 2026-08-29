const { DataTypes } = require('sequelize');

/**
 * One line on an invoice.
 *
 * `amount` is STORED rather than computed on read from quantity x unit_price.
 * A rounding rule that lives in code drifts the moment somebody changes it, and
 * an invoice already sent has to keep totalling what it totalled.
 *
 * `item_type` exists so an add-on line and a plan line are distinguishable
 * without parsing the description — the add-ons module has no tables yet, but a
 * line type added later must not require rewriting every historic invoice to
 * work out which is which.
 */
module.exports = (sequelize) => {
    const ClientInvoiceItem = sequelize.define('ClientInvoiceItem', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        invoice_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        item_type: {
            type: DataTypes.ENUM('plan', 'addon', 'adjustment', 'discount'),
            allowNull: false,
            defaultValue: 'plan',
        },
        description: {
            type: DataTypes.STRING(300),
            allowNull: false,
        },
        period_start: { type: DataTypes.DATEONLY, allowNull: true },
        period_end: { type: DataTypes.DATEONLY, allowNull: true },
        quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
        unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'client_invoice_items',
        timestamps: true,
        // Not paranoid: a line is part of the invoice, and a soft-deleted line
        // would leave a total that no longer matches what it is made of.
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [{ fields: ['invoice_id', 'sort_order'] }],
    });

    return ClientInvoiceItem;
};
