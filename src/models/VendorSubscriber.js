module.exports = (sequelize, DataTypes) => {
  const VendorSubscriber = sequelize.define('VendorSubscriber', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    vendor_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    email: {
      type: DataTypes.STRING(190),
      allowNull: false
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
      comment: '0=inactive,1=active'
    }
  }, {
    tableName: 'vendor_subscribers',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  });

  return VendorSubscriber;
};
