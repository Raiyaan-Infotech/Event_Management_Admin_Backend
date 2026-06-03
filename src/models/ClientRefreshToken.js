const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClientRefreshToken = sequelize.define('ClientRefreshToken', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    token: {
      type: DataTypes.STRING(500),
      allowNull: false,
      unique: true,
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
    },
  }, {
    tableName: 'client_refresh_tokens',
    timestamps: true,
    underscored: true,
  });

  return ClientRefreshToken;
};
