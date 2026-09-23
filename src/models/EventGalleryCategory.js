const { DataTypes } = require('sequelize');

/**
 * A gallery category, scoped to ONE event.
 *
 * Per event rather than global on purpose: "Mehendi" belongs to one wedding,
 * not to every client's gallery, and a shared list would grow into a junk
 * drawer nobody can prune safely.
 */
module.exports = (sequelize) => {
    const EventGalleryCategory = sequelize.define('EventGalleryCategory', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        name: { type: DataTypes.STRING(120), allowNull: false },
        icon: { type: DataTypes.STRING(100), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_gallery_categories',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        paranoid: true,
    });

    EventGalleryCategory.associate = (models) => {
        EventGalleryCategory.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
        EventGalleryCategory.hasMany(models.EventGalleryItem, {
            foreignKey: 'category_id', as: 'items',
        });
    };

    return EventGalleryCategory;
};
