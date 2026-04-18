module.exports = (sequelize, DataTypes) => {
  const Theme = sequelize.define('Theme', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    company_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    header_color: {
      type: DataTypes.STRING(50)
    },
    footer_color: {
      type: DataTypes.STRING(50)
    },
    primary_color: {
      type: DataTypes.STRING(50)
    },
    secondary_color: {
      type: DataTypes.STRING(50)
    },
    hover_color: {
      type: DataTypes.STRING(50)
    },
    text_color: {
      type: DataTypes.STRING(50)
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
      comment: '0=inactive,1=active'
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'themes',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  });

  return Theme;
};
