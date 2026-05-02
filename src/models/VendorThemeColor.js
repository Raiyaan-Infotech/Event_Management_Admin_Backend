module.exports = (sequelize, DataTypes) => {
  const VendorThemeColor = sequelize.define('VendorThemeColor', {
    id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    vendor_id:       { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    theme_id:        { type: DataTypes.INTEGER, allowNull: false },
    primary_color:   { type: DataTypes.STRING(50), allowNull: true },
    secondary_color: { type: DataTypes.STRING(50), allowNull: true },
    header_color:    { type: DataTypes.STRING(50), allowNull: true },
    footer_color:    { type: DataTypes.STRING(50), allowNull: true },
    text_color:      { type: DataTypes.STRING(50), allowNull: true },
    hover_color:     { type: DataTypes.STRING(50), allowNull: true },
    is_active:       { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, comment: '1=custom active, 0=use palette' },
  }, {
    tableName: 'vendor_theme_colors',
    timestamps: true,
    underscored: true,
    paranoid: false,
    indexes: [
      { unique: true, fields: ['vendor_id', 'theme_id'], name: 'uq_vendor_theme' },
      { fields: ['theme_id'], name: 'idx_vtc_theme' },
    ],
  });

  return VendorThemeColor;
};
