module.exports = (sequelize, DataTypes) => {
  const ColorPalette = sequelize.define('ColorPalette', {
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
    primary_color: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    secondary_color: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    header_color: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    footer_color: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    text_color: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    hover_color: {
      type: DataTypes.STRING(50),
      allowNull: true
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
    tableName: 'color_palettes',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at'
  });

  return ColorPalette;
};
