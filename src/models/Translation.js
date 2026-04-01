const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Translation = sequelize.define('Translation', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    translation_key_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'translation_keys',
        key: 'id',
      },
    },
    language_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'languages',
        key: 'id',
      },
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('auto', 'reviewed'),
      allowNull: false,
      defaultValue: 'auto',
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
      comment: '0=inactive, 1=active, 2=pending',
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
    tableName: 'translations',
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        unique: true,
        fields: ['translation_key_id', 'language_id'],
        where: {
          deletedAt: null,
        },
      },
    ],
  });

  return Translation;
};
