const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorTestimonial = sequelize.define('VendorTestimonial', {
        id:                { type: DataTypes.BIGINT,      primaryKey: true, autoIncrement: true },
        customer_name:     { type: DataTypes.STRING(255), allowNull: false },
        customer_portrait: { type: DataTypes.STRING(500), allowNull: true },
        event_name:        { type: DataTypes.STRING(255), allowNull: false },
        client_feedback:   { type: DataTypes.TEXT,        allowNull: true },
        is_active:         { type: DataTypes.TINYINT,     defaultValue: 1 },
        vendor_id:         { type: DataTypes.INTEGER,     allowNull: true },
        company_id:        { type: DataTypes.INTEGER,     allowNull: true },
        created_by:        { type: DataTypes.INTEGER,     allowNull: true },
        deleted_by:        { type: DataTypes.INTEGER,     allowNull: true },
    }, {
        tableName:   'vendor_testimonials',
        timestamps:  true,
        paranoid:    true,
        underscored: false,
    });

    return VendorTestimonial;
};