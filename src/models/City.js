const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const City = sequelize.define('City', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    // city_id here refers to the parent district (was called "city" before rename)
    city_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'References districts.id (the parent district)',
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    pincode: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    is_default: {
      type: DataTypes.TINYINT,
      defaultValue: 0,
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
    tableName: 'cities',
    timestamps: true,
    paranoid: true,
  });

  return City;
};
