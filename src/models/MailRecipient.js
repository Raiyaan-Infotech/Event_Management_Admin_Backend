module.exports = (sequelize, DataTypes) => {
  const MailRecipient = sequelize.define('MailRecipient', {
    id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    mail_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    recipient_type: { type: DataTypes.ENUM('admin', 'vendor', 'client'), allowNull: false },
    recipient_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    role: { type: DataTypes.ENUM('to', 'cc', 'bcc'), defaultValue: 'to' },
    is_read: { type: DataTypes.TINYINT, defaultValue: 0 },
    is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
    label: { type: DataTypes.STRING(50), allowNull: true },
    custom_folder_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  }, {
    tableName: 'mail_recipients',
    timestamps: true,
    underscored: true,
  });

  MailRecipient.associate = (db) => {
    MailRecipient.belongsTo(db.Mail, { foreignKey: 'mail_id', as: 'mail' });
    MailRecipient.belongsTo(db.MailFolder, { foreignKey: 'custom_folder_id', as: 'folder' });
  };

  return MailRecipient;
};
