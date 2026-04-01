const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const TranslationKey = sequelize.define('TranslationKey', {
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
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    group: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'common',
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'translation_keys',
    timestamps: true,
    paranoid: true,
  });

  return TranslationKey;
};
