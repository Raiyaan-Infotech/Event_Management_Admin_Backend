module.exports = (sequelize, DataTypes) => {
    const UiBlock = sequelize.define('UiBlock', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        block_type: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true
        },
        label: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        icon: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        variants: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Array of strings or objects representing block variants'
        },
        preview_image: {
            type: DataTypes.STRING(500),
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
        tableName: 'ui_blocks',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at'
    });

    return UiBlock;
};
