const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Currency = sequelize.define('Currency', {
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
      type: DataTypes.STRING(3),
      allowNull: false,
      unique: true,
    },
    symbol: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    exchange_rate: {
      type: DataTypes.DECIMAL(10, 4),
      defaultValue: 1.0000,
    },
    decimal_places: {
      type: DataTypes.INTEGER,
      defaultValue: 2,
    },
    decimal_separator: {
      type: DataTypes.STRING(5),
      defaultValue: '.',
    },
    thousand_separator: {
      type: DataTypes.STRING(5),
      defaultValue: ',',
    },
    symbol_position: {
      type: DataTypes.ENUM('before', 'after'),
      defaultValue: 'before',
    },
    space_between: {
      type: DataTypes.TINYINT,
      defaultValue: 0,
      comment: '0=no space, 1=space between symbol and number',
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
    tableName: 'currencies',
    timestamps: true,
    paranoid: true,
    underscored: true,
  });

  return Currency;
};
