const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailQueue = sequelize.define('EmailQueue', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    campaign_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'email_campaigns',
        key: 'id',
      },
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    // Pre-rendered content (variables already replaced)
    subject: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT('long'),
      allowNull: false,
    },
    // Queue status
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'sent', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
      comment: '1 = highest, 10 = lowest',
    },
    // Retry handling
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    max_attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 3,
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Timestamps
    scheduled_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Email config to use
    email_config_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'email_configs',
        key: 'id',
      },
    },
  }, {
    tableName: 'email_queue',
    timestamps: true,
    underscored: true,
    paranoid: false,
    indexes: [
      {
        name: 'idx_queue_status_scheduled',
        fields: ['status', 'scheduled_at'],
      },
      {
        name: 'idx_queue_campaign_user',
        fields: ['campaign_id', 'user_id'],
      },
      {
        name: 'idx_queue_priority',
        fields: ['priority', 'scheduled_at'],
      },
    ],
  });

  return EmailQueue;
};
