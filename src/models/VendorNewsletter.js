const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const VendorNewsletter = sequelize.define('VendorNewsletter', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    vendor_id: { type: DataTypes.INTEGER, allowNull: false },
    company_id: { type: DataTypes.INTEGER, allowNull: true },
    client_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'vendor_clients', key: 'id' } },
    client_type: { type: DataTypes.ENUM('subscribed', 'unsubscribed'), defaultValue: 'subscribed' },
    registration_type: { type: DataTypes.ENUM('guest', 'client'), allowNull: false },
    created_by: { type: DataTypes.INTEGER, allowNull: true },
    updated_by: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'vendor_newsletters',
    timestamps: true,
    paranoid: false,
    underscored: false,
    indexes: [{ fields: ['vendor_id', 'client_id'], unique: true }],
  });

  return VendorNewsletter;
};
