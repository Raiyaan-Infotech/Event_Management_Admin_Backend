const { DataTypes } = require('sequelize');

/**
 * One photo or video in an event's gallery.
 *
 * `size_bytes` is stored rather than read back from S3 because the plan's
 * storage limit is checked on every upload: asking the bucket for the size of
 * every existing object on each upload would be one round trip per file.
 *
 * `website_client_id` is denormalised from the event so an account's total
 * storage is a single SUM without joining events — storage is an ACCOUNT limit,
 * while photo and video counts are per event.
 */
module.exports = (sequelize) => {
    const EventGalleryItem = sequelize.define('EventGalleryItem', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        type: {
            type: DataTypes.ENUM('image', 'video'),
            allowNull: false,
            defaultValue: 'image',
        },
        url: { type: DataTypes.STRING(500), allowNull: false },
        /** Video poster. NULL for an image, whose own url is its thumbnail. */
        thumbnail_url: { type: DataTypes.STRING(500), allowNull: true },

        file_name: { type: DataTypes.STRING(255), allowNull: true },
        mime_type: { type: DataTypes.STRING(100), allowNull: true },
        size_bytes: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },

        caption: { type: DataTypes.STRING(300), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

        /** The host today; a guest once guest uploads exist. */
        uploaded_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_gallery_items',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        paranoid: true,
    });

    EventGalleryItem.associate = (models) => {
        EventGalleryItem.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
    };

    return EventGalleryItem;
};
