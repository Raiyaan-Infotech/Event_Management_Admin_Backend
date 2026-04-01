const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailCampaign = sequelize.define('EmailCampaign', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    email_template_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'email_templates',
        key: 'id',
      },
    },
    email_config_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'email_configs',
        key: 'id',
      },
      comment: 'Override template config if specified',
    },
    campaign_type: {
      type: DataTypes.ENUM('holiday', 'scheduled', 'recurring'),
      allowNull: false,
      defaultValue: 'scheduled',
    },
    // For holiday campaigns
    holiday_name: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'e.g., new_year, valentine, christmas',
    },
    holiday_month: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '1-12 for month',
    },
    holiday_day: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '1-31 for day',
    },
    // For scheduled campaigns
    scheduled_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Specific date for one-time campaign',
    },
    scheduled_time: {
      type: DataTypes.TIME,
      allowNull: true,
      defaultValue: '08:00:00',
      comment: 'Time to send campaign',
    },
    // For recurring campaigns
    recurring_pattern: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly', 'yearly'),
      allowNull: true,
    },
    recurring_day: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Day of week (0-6) for weekly, day of month (1-31) for monthly',
    },
    // Target audience
    target_audience: {
      type: DataTypes.ENUM('all_users', 'active_users', 'verified_users', 'custom'),
      allowNull: false,
      defaultValue: 'active_users',
    },
    target_roles: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array of role IDs to target',
    },
    // Variable mappings for template
    variable_mappings: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Maps template variables to user fields or custom values',
    },
    // Statistics
    total_recipients: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    total_sent: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    total_failed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    last_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    next_run_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.TINYINT,
      defaultValue: 2,
      comment: '0=paused/completed, 1=active, 2=draft/pending',
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
    tableName: 'email_campaigns',
    timestamps: true,
    underscored: true,
    paranoid: true,
  });

  return EmailCampaign;
};
