const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailConfig = sequelize.define('EmailConfig', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    from_email: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    from_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    driver: {
      // ✅ CHANGED: Replace paid services with free alternatives
      type: DataTypes.ENUM('smtp', 'brevo', 'elasticemail', 'sendmail'),
      allowNull: false,
      defaultValue: 'smtp',
    },
    host: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    port: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    password: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    encryption: {
      type: DataTypes.ENUM('tls', 'ssl', 'none'),
      allowNull: true,
      defaultValue: 'tls',
    },
    api_key: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    domain: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    region: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
    tableName: 'email_configs',
    timestamps: true,
    paranoid: true,
    hooks: {
      // ✅ ADDED: Auto-unset other defaults when setting a new default
      beforeSave: async (instance) => {
        if (instance.is_default) {
          await EmailConfig.update(
            { is_default: false },
            { 
              where: { 
                is_default: true,
                id: { [sequelize.Sequelize.Op.ne]: instance.id }
              } 
            }
          );
        }
      },
    },
  });

  // ✅ ADDED: Hide sensitive data in API responses
  EmailConfig.prototype.toJSON = function () {
    const values = { ...this.get() };
    values.has_api_key = !!values.api_key;
    delete values.password;
    delete values.api_key;
    return values;
  };

  return EmailConfig;
};