const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PushNotificationConfig = sequelize.define('PushNotificationConfig', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    service_account_json: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    project_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    client_email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    private_key: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    web_api_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    app_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    messaging_sender_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    auth_domain: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    storage_bucket: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    measurement_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    vapid_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    connection_status: {
      type: DataTypes.ENUM('connected', 'disconnected', 'pending', 'error'),
      defaultValue: 'pending',
      allowNull: false,
    },
    last_verified_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    validation_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'push_notification_configs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    hooks: {
      beforeSave: async (instance) => {
        if (instance.is_active) {
          const { Op } = sequelize.Sequelize;
          await PushNotificationConfig.update(
            { is_active: false },
            {
              where: instance.id
                ? { id: { [Op.ne]: instance.id } }
                : {},
            },
          );
        }
      },
    },
  });

  PushNotificationConfig.prototype.toJSON = function () {
    const values = { ...this.get() };
    values.has_service_account = Boolean(values.service_account_json || values.private_key);
    values.has_private_key = Boolean(values.private_key);
    
    // Mask sensitive credentials in responses
    if (values.private_key) {
      values.private_key_masked = '••••••••••••••••••••••••••••••••';
      delete values.private_key;
    }
    if (values.service_account_json) {
      delete values.service_account_json;
    }
    return values;
  };

  return PushNotificationConfig;
};
