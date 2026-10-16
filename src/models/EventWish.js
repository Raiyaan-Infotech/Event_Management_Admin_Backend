const { DataTypes } = require('sequelize');

/**
 * One wish on an event's Wed Wishes feed (2026-10-16) — a Text, Image or
 * Video post, addressed To Groom / To Bride / To Both, that people can like.
 *
 * Written by a participant in the app (`author_client_id` = their client id,
 * name taken from their participant row), or added by the organizer on
 * someone's behalf (`author_client_id` NULL, name / mobile typed).
 *
 * `is_hidden` = hidden from participants; the organizer still sees it and can
 * show it again. A new participant wish is visible at once (Jamal: no
 * approval step). Blocking is per author, see EventWishBlock.
 */
module.exports = (sequelize) => {
    const EventWish = sequelize.define('EventWish', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        author_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        post_type: { type: DataTypes.ENUM('text', 'image', 'video'), allowNull: false, defaultValue: 'text' },
        audience: { type: DataTypes.ENUM('groom', 'bride', 'both'), allowNull: false, defaultValue: 'both' },
        guest_name: { type: DataTypes.STRING(150), allowNull: false },
        mobile: { type: DataTypes.STRING(20), allowNull: true },
        message: { type: DataTypes.STRING(500), allowNull: false },
        /** Image post: the image. */
        photo: { type: DataTypes.STRING(500), allowNull: true },
        /** Video post: the video, its first frame and length. */
        video_url: { type: DataTypes.STRING(500), allowNull: true },
        thumbnail_url: { type: DataTypes.STRING(500), allowNull: true },
        duration_seconds: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
        /** Stored bytes of the media — counted in the plan's storage. */
        size_bytes: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        is_hidden: { type: DataTypes.TINYINT(1), allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'event_wishes',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventWish.associate = (models) => {
        EventWish.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
    };

    return EventWish;
};
