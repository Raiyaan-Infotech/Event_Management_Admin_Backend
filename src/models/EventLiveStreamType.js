const { DataTypes } = require('sequelize');

/**
 * A Stream Type ("Wedding Ceremony", "Reception"), scoped to ONE event — the
 * Live Streaming counterpart of a gallery category. The organizer makes every
 * one (no built-in type, no picture); a stream must belong to one, and
 * deleting a type deletes its streams.
 */
module.exports = (sequelize) => {
    const EventLiveStreamType = sequelize.define('EventLiveStreamType', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.STRING(200), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
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
