const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Faq = sequelize.define('Faq', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
        },
        faq_category_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        question: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        answer: {
            type: DataTypes.TEXT('long'),
            allowNull: false,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        is_active: {
            type: DataTypes.TINYINT,
            defaultValue: 1,
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        updated_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
    }, {
        tableName: 'faqs',
        timestamps: true,
        paranoid: true,
    });

    return Faq;
};
