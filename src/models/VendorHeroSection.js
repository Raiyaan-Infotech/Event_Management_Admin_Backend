const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorHeroSection = sequelize.define('VendorHeroSection', {
        id:           { type: DataTypes.BIGINT,       primaryKey: true, autoIncrement: true },
        vendor_id:    { type: DataTypes.INTEGER,      allowNull: false, unique: true },
        company_id:   { type: DataTypes.INTEGER,      allowNull: true },
        title:        { type: DataTypes.STRING(255),  allowNull: true },
        heading:      { type: DataTypes.STRING(255),  allowNull: true },
        description:  { type: DataTypes.TEXT,         allowNull: true },
        button:       { type: DataTypes.STRING(100),  allowNull: true },
        button2:      { type: DataTypes.STRING(100),  allowNull: true },
        image_url:    { type: DataTypes.STRING(500),  allowNull: true },
        bg_image_url: { type: DataTypes.STRING(500),  allowNull: true },
        page_id:      { type: DataTypes.INTEGER,      allowNull: true },
        page_id2:     { type: DataTypes.INTEGER,      allowNull: true },
        variant:      { type: DataTypes.STRING(50),   allowNull: false, defaultValue: 'variant_1' },
        stat1_val:    { type: DataTypes.STRING(100),  allowNull: true },
        stat1_lbl:    { type: DataTypes.STRING(150),  allowNull: true },
        stat1_sub:    { type: DataTypes.STRING(150),  allowNull: true },
        stat2_val:    { type: DataTypes.STRING(100),  allowNull: true },
        stat2_lbl:    { type: DataTypes.STRING(150),  allowNull: true },
        stat2_sub:    { type: DataTypes.STRING(150),  allowNull: true },
        stat3_val:    { type: DataTypes.STRING(100),  allowNull: true },
        stat3_lbl:    { type: DataTypes.STRING(150),  allowNull: true },
        stat3_sub:    { type: DataTypes.STRING(150),  allowNull: true },
        is_active:    { type: DataTypes.TINYINT,      allowNull: false, defaultValue: 1 },
        created_by:   { type: DataTypes.INTEGER,      allowNull: true },
        updated_by:   { type: DataTypes.INTEGER,      allowNull: true },
        deleted_by:   { type: DataTypes.INTEGER,      allowNull: true },
    }, {
        tableName: 'vendor_hero_sections',
        timestamps: true,
        paranoid: true,
    });

    return VendorHeroSection;
};
