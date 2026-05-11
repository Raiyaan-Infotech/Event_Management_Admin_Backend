module.exports = (sequelize, DataTypes) => {
  const MailFolder = sequelize.define('MailFolder', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    owner_type: { type: DataTypes.ENUM('admin', 'vendor', 'client'), allowNull: false },
    owner_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    is_active: { type: DataTypes.TINYINT, defaultValue: 1 },
  }, {
    tableName: 'mail_folders',
    timestamps: true,
    paranoid: true,
    underscored: true,
  });

  MailFolder.associate = (db) => {
    MailFolder.hasMany(db.MailRecipient, { foreignKey: 'custom_folder_id', as: 'mails' });
  };

  return MailFolder;
};
