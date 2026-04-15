const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorPortfolioItem = sequelize.define('VendorPortfolioItem', {
        id:         { type: DataTypes.BIGINT,                             primaryKey: true, autoIncrement: true },
        type:       { type: DataTypes.ENUM('client', 'sponsor', 'event'), allowNull: false },
        image_path: { type: DataTypes.STRING(500),                        allowNull: true },
        label:      { type: DataTypes.STRING(255),                        allowNull: true },
        value:      { type: DataTypes.STRING(255),                        allowNull: true },
        sort_order: { type: DataTypes.INTEGER,                            defaultValue: 0 },
        is_active:  { type: DataTypes.TINYINT,                            defaultValue: 1 },
        vendor_id:  { type: DataTypes.INTEGER,                            allowNull: true },
        company_id: { type: DataTypes.INTEGER,                            allowNull: true },
        created_by: { type: DataTypes.INTEGER,                            allowNull: true },
        deleted_by: { type: DataTypes.INTEGER,                            allowNull: true },
    }, {
        tableName:  'vendor_portfolio_items',
        timestamps: true,
        paranoid:   true,
    });

    return VendorPortfolioItem;
};
