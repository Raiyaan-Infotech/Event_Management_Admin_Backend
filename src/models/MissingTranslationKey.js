const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MissingTranslationKey = sequelize.define('MissingTranslationKey', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    key: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    default_value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    page_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    report_count: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    first_reported_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    last_reported_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    is_active: {
      type: DataTypes.TINYINT,
      defaultValue: 1,
      comment: '0=resolved/ignored, 1=pending, 2=in-progress',
    },
  }, {
    tableName: 'missing_translation_keys',
    timestamps: true,
    paranoid: false, // No soft delete for missing keys
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['key'], unique: true },
      { fields: ['is_active'] },
      { fields: ['report_count'] },
    ],
  });

  return MissingTranslationKey;
};
