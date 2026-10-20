const { DataTypes } = require('sequelize');

/**
 * One live stream of an event: a link on YouTube / Facebook / … with a date,
 * time, cover and description, filed under a Stream Type.
 *
 * `is_enabled` is the list's switch and the form's "Show in App": a disabled
 * stream stays with the organizer and is hidden from participants. Nothing is
 * played by the app itself — a participant opens `stream_url`.
 */
module.exports = (sequelize) => {
    const EventLiveStream = sequelize.define('EventLiveStream', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        type_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        title: { type: DataTypes.STRING(150), allowNull: false },
        platform: {
            type: DataTypes.ENUM('youtube', 'facebook', 'instagram', 'zoom', 'google_meet', 'other'),
            allowNull: false,
            defaultValue: 'youtube',
        },
        stream_url: { type: DataTypes.STRING(500), allowNull: false },
        stream_date: { type: DataTypes.DATEONLY, allowNull: false },
        stream_time: { type: DataTypes.TIME, allowNull: false },
        description: { type: DataTypes.STRING(500), allowNull: true },
        cover_image: { type: DataTypes.STRING(500), allowNull: true },
        is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_live_streams',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventLiveStream.associate = (models) => {
        EventLiveStream.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
        EventLiveStream.belongsTo(models.EventLiveStreamType, { foreignKey: 'type_id', as: 'type' });
    };

    return EventLiveStream;
};
