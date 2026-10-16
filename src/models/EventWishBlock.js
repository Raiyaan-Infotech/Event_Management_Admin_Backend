const { DataTypes } = require('sequelize');

/**
 * A participant blocked from sending wishes on ONE event (Jamal, 2026-10-16:
 * Wishes only — they still see the event, its wishes and everything else).
 * Their existing wishes are untouched; the organizer hides or deletes those
 * separately.
 */
module.exports = (sequelize) => {
    const EventWishBlock = sequelize.define('EventWishBlock', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        author_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    }, {
        tableName: 'event_wish_blocks',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
    });

    return EventWishBlock;
};
