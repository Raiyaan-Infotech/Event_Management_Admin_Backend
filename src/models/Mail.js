module.exports = (sequelize, DataTypes) => {
  const Mail = sequelize.define('Mail', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    sender_type: { type: DataTypes.ENUM('admin', 'vendor', 'client'), allowNull: false },
    sender_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    subject: { type: DataTypes.STRING(500), allowNull: false },
    body: { type: DataTypes.TEXT('long'), allowNull: false },
    status: { type: DataTypes.ENUM('draft', 'sent', 'failed'), defaultValue: 'draft' },
    sent_at: { type: DataTypes.DATE, allowNull: true },
    error_message: { type: DataTypes.TEXT, allowNull: true },
    sender_is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    sender_label: { type: DataTypes.STRING(50), allowNull: true },
    sender_custom_folder_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  }, {
    tableName: 'mails',
    timestamps: true,
    underscored: true,
  });

  Mail.associate = (db) => {
    Mail.hasMany(db.MailRecipient, { foreignKey: 'mail_id', as: 'recipients' });
    Mail.hasMany(db.MailNotification, { foreignKey: 'mail_id', as: 'notifications' });
  };

  return Mail;
};
