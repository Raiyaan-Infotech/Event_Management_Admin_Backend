const { DataTypes } = require('sequelize');

/**
 * A Stream Type ("Wedding Ceremony", "Reception"), scoped to ONE event — the
 * Live Streaming counterpart of a gallery category.
 *
 * Every event has one built-in type, "Live Stream" (`is_default` = TRUE): a
 * stream saved with no type lands there and a deleted type's streams fall back
 * to it, so a stream is never left without one.
 */
module.exports = (sequelize) => {
    const EventLiveStreamType = sequelize.define('EventLiveStreamType', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.STRING(200), allowNull: true },
        /** NULL = the list falls back to the first stream's cover. */
        cover_image: { type: DataTypes.STRING(500), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        /**
         * TRUE for the event's one built-in type, NULL for every other — NULL
         * (not 0) so the unique (event_id, is_default) key allows many.
         */
        is_default: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: null },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_live_stream_types',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventLiveStreamType.associate = (models) => {
        EventLiveStreamType.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
        EventLiveStreamType.hasMany(models.EventLiveStream, { foreignKey: 'type_id', as: 'streams' });
    };

    return EventLiveStreamType;
};
