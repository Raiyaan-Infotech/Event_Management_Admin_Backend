const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const VendorNewsletterSentLog = sequelize.define('VendorNewsletterSentLog', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    vendor_id: { type: DataTypes.INTEGER, allowNull: false },
    campaign_id: { type: DataTypes.BIGINT, allowNull: false },
    client_id: { type: DataTypes.BIGINT, allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    membership: { type: DataTypes.STRING(100), allowNull: true },
    template: { type: DataTypes.STRING(255), allowNull: false },
    status: { type: DataTypes.ENUM('pending', 'sent', 'failed', 'bounced'), defaultValue: 'pending' },
    opened_at: { type: DataTypes.DATE, allowNull: true },
    clicked_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: 'vendor_newsletter_sent_logs',
    timestamps: true,
    paranoid: false,
    underscored: false,
    indexes: [{ fields: ['vendor_id', 'campaign_id'] }],
  });

  return VendorNewsletterSentLog;
};
