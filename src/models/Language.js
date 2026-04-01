const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Language = sequelize.define('Language', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
    },
    native_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    direction: {
      type: DataTypes.ENUM('ltr', 'rtl'),
      defaultValue: 'ltr',
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_active: {
      type: DataTypes.TINYINT,
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
    tableName: 'languages',
    timestamps: true,
    paranoid: true,
  });

  return Language;
};
