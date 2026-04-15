const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const VendorSlider = sequelize.define('VendorSlider', {
        id:                { type: DataTypes.BIGINT,                          primaryKey: true, autoIncrement: true },
        type:              { type: DataTypes.ENUM('basic', 'advanced'),        allowNull: false, defaultValue: 'basic' },
        title:             { type: DataTypes.STRING(255),                      allowNull: false },
        image_path:        { type: DataTypes.STRING(500),                      allowNull: false },
        button_label:      { type: DataTypes.STRING(100),                      allowNull: false },
        page_id:           { type: DataTypes.INTEGER,                          allowNull: true },
        button_color:      { type: DataTypes.STRING(7),                        allowNull: true,  defaultValue: '#3B82F6' },
        status:            { type: DataTypes.ENUM('published', 'draft'),       allowNull: false, defaultValue: 'draft' },
        is_active:         { type: DataTypes.TINYINT,                          defaultValue: 0 },
        // Advanced-only (nullable for basic)
        description:       { type: DataTypes.TEXT,                             allowNull: true },
        title_color:       { type: DataTypes.STRING(7),                        allowNull: true,  defaultValue: '#FFFFFF' },
        description_color: { type: DataTypes.STRING(7),                        allowNull: true,  defaultValue: '#E2E8F0' },
        overlay_opacity:   { type: DataTypes.TINYINT,                          allowNull: true,  defaultValue: 40 },
        image_blur:        { type: DataTypes.TINYINT,                          allowNull: true,  defaultValue: 0 },
        image_brightness:  { type: DataTypes.TINYINT,                          allowNull: true,  defaultValue: 100 },
        content_alignment: { type: DataTypes.ENUM('left', 'center', 'right'),  allowNull: true,  defaultValue: 'center' },
        vendor_id:         { type: DataTypes.INTEGER,                          allowNull: true },
        company_id:        { type: DataTypes.INTEGER,                          allowNull: true },
        created_by:        { type: DataTypes.INTEGER,                          allowNull: true },
        updated_by:        { type: DataTypes.INTEGER,                          allowNull: true },
        deleted_by:        { type: DataTypes.INTEGER,                          allowNull: true },
    }, {
        tableName:  'vendor_sliders',
        timestamps: true,
        paranoid:   true,
    });

    return VendorSlider;
};
