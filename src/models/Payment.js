const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Payment = sequelize.define('Payment', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        amount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0.00,
        },
        currency: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'USD',
        },
        status: {
            type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled'),
            allowNull: false,
            defaultValue: 'pending',
        },
        gateway: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'stripe, paypal, razorpay, etc.',
        },
        gateway_transaction_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: true,
        },
    }, {
        tableName: 'payments',
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['company_id'] },
            { fields: ['user_id'] },
            { fields: ['status'] },
            { fields: ['gateway'] },
            { fields: ['gateway_transaction_id'] },
        ],
    });

    return Payment;
};
