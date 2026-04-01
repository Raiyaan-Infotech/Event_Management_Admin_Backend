const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailSentLog = sequelize.define('EmailSentLog', {
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
    queue_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Reference to original queue item',
    },
    // Campaign run identifier (for tracking which run this was)
    run_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Date the campaign was scheduled to run',
    },
    run_year: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Year of the run (for yearly campaigns)',
    },
    // Email details
    subject: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    // Status
    status: {
      type: DataTypes.ENUM('sent', 'failed', 'bounced'),
      allowNull: false,
      defaultValue: 'sent',
    },
    // Delivery info
    message_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'SMTP message ID',
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    // Timestamps
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'email_sent_logs',
    timestamps: true,
    underscored: true,
    paranoid: false,
    indexes: [
      {
        name: 'idx_sent_log_unique',
        unique: true,
        fields: ['campaign_id', 'user_id', 'run_date', 'run_year'],
        comment: 'Prevent duplicate sends for same campaign/user/date/year',
      },
      {
        name: 'idx_sent_log_campaign',
        fields: ['campaign_id', 'status'],
      },
      {
        name: 'idx_sent_log_user',
        fields: ['user_id'],
      },
      {
        name: 'idx_sent_log_date',
        fields: ['run_date'],
      },
    ],
  });

  return EmailSentLog;
};
