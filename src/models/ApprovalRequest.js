const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ApprovalRequest = sequelize.define('ApprovalRequest', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    requester_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    approver_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    module_slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    permission_slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    resource_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    resource_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    request_data: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    old_data: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    reviewed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    review_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.TINYINT,
      defaultValue: 2,
      comment: '0=rejected, 1=approved, 2=pending',
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
    tableName: 'approval_requests',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['is_active'] },
      { fields: ['company_id', 'is_active'] },
      { fields: ['requester_id'] },
      { fields: ['module_slug'] },
      { fields: ['created_at'] },
      { fields: ['deleted_at'] },
    ],
  });

  return ApprovalRequest;
};