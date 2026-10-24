const { DataTypes } = require('sequelize');

/**
 * The last Google Places result of an event's Near By (2026-10-24), one row
 * per event. `cache_key` = the venue pin + radius + categories it was fetched
 * for; a different key (settings or venue changed) or an old `fetched_at`
 * means fetch again. Deleted with the event (FK cascade).
 */
module.exports = (sequelize) => sequelize.define('EventNearbyCache', {
    event_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    cache_key: { type: DataTypes.STRING(255), allowNull: false },
    places: { type: DataTypes.JSON, allowNull: false },
    fetched_at: { type: DataTypes.DATE, allowNull: false },
}, {
    tableName: 'event_nearby_cache',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});
