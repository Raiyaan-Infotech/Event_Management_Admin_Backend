const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const VendorNewsletterSend = sequelize.define('VendorNewsletterSend', {
    id:            { type: DataTypes.BIGINT,      primaryKey: true, autoIncrement: true },
    vendor_id:     { type: DataTypes.INTEGER,     allowNull: false },
    company_id:    { type: DataTypes.INTEGER,     allowNull: true },
    template_id:   { type: DataTypes.INTEGER,     allowNull: true },
    template_name: { type: DataTypes.STRING(255), allowNull: false },
    category_id:   { type: DataTypes.INTEGER,     allowNull: true },
    user_type:     { type: DataTypes.ENUM('Guest', 'Registered'), allowNull: false },
    plans:         { type: DataTypes.JSON,        allowNull: true },
    total_sent:    { type: DataTypes.INTEGER,     defaultValue: 0 },
    created_by:    { type: DataTypes.INTEGER,     allowNull: true },
  }, {
    tableName: 'vendor_newsletter_sends',
    timestamps: true,
    paranoid: false,
    underscored: false,
  });

  return VendorNewsletterSend;
};
