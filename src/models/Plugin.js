const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Plugin = sequelize.define('Plugin', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'general',
    },
    icon: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.TINYINT,
      defaultValue: 0,
      comment: '0=disabled, 1=enabled',
    },
    config_group: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Links to settings.group for config storage',
    },
    config_route: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Frontend route to the config page',
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'plugins',
    timestamps: true,
    paranoid: true,
    indexes: [
      {
        unique: true,
        fields: ['slug', 'company_id'],
        name: 'plugins_slug_company_unique',
      },
    ],
  });

  return Plugin;
};
