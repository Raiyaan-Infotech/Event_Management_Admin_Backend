const { DataTypes } = require('sequelize');

/** One person's like on a wish (Wed Wishes, 2026-10-16). One row per person. */
module.exports = (sequelize) => {
    const EventWishLike = sequelize.define('EventWishLike', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        wish_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    }, {
        tableName: 'event_wish_likes',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
    });

    return EventWishLike;
};
