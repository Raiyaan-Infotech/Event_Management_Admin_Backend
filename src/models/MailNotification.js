module.exports = (sequelize, DataTypes) => {
  const MailNotification = sequelize.define('MailNotification', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    mail_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    recipient_type: { type: DataTypes.ENUM('admin', 'vendor', 'client'), allowNull: false },
    recipient_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    is_read: { type: DataTypes.TINYINT, defaultValue: 0 },
  }, {
    tableName: 'mail_notifications',
    timestamps: true,
    updatedAt: false,
    underscored: true,
  });

  MailNotification.associate = (db) => {
    MailNotification.belongsTo(db.Mail, { foreignKey: 'mail_id', as: 'mail' });
  };

  return MailNotification;
};
