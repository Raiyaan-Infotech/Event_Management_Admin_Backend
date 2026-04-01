const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailTemplate = sequelize.define('EmailTemplate', {
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
    type: {
      type: DataTypes.ENUM('header', 'footer', 'template'),
      defaultValue: 'template',
      comment: 'Type of template: header, footer, or regular template',
    },
    subject: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Subject is only required for type=template',
    },
    body: {
      type: DataTypes.TEXT('long'),
      allowNull: false,
    },
    variables: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Available variables for this template',
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    header_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Reference to a header template',
    },
    footer_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Reference to a footer template',
    },
    email_config_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'email_configs',
        key: 'id',
      },
    },
    is_active: {
      type: DataTypes.TINYINT,
      defaultValue: 1,
      comment: '0=inactive, 1=active, 2=pending',
    },
    is_predefined: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Predefined templates cannot be deleted',
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
    tableName: 'email_templates',
    timestamps: true,
    paranoid: true,
  });

  return EmailTemplate;
};
