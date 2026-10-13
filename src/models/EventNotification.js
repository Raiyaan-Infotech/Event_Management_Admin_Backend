const { DataTypes } = require('sequelize');

/**
 * A notification the organizer writes in the mobile app and sends to an
 * event's participants (Home → Send Notification).
 *
 * Its own table on purpose (decided by Jamal, 2026-10-13) — NOT a row of
 * `event_message_campaigns`, which stays the web portal's Messages.
 *
 * `scheduled_at` is the instant it goes out. `timezone` is the label the
 * organizer picked (the same list `events.timezone` uses); the wall-clock date
 * and time the app shows are worked out from the two, never stored twice.
 *
 * The audience is stored as the organizer chose it — `participant_ids` for
 * 'specific', `sides` + `relationships` for 'groups' — and resolved when the
 * notification is SENT, so a scheduled one reaches whoever matches at that
 * moment. Who it actually went to is `event_notification_recipients`.
 */
module.exports = (sequelize) => {
    const EventNotification = sequelize.define('EventNotification', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        /** The organizer who wrote it. */
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: true },

        title: { type: DataTypes.STRING(100), allowNull: false },
        /** Empty on a draft that has only a title so far. */
        message: { type: DataTypes.STRING(500), allowNull: true },
        image_url: { type: DataTypes.STRING(500), allowNull: true },

        audience: {
            type: DataTypes.ENUM('all', 'specific', 'groups'),
            allowNull: false,
            defaultValue: 'all',
        },
        /** `event_participants.id` list — audience 'specific'. */
        participant_ids: { type: DataTypes.JSON, allowNull: true },
        /** ['bride'] / ['groom'] / both — audience 'groups'. Both = every side. */
        sides: { type: DataTypes.JSON, allowNull: true },
        /** Relation names — audience 'groups'. Empty = every relation. */
        relationships: { type: DataTypes.JSON, allowNull: true },
        /** 'in_app' and / or 'push'. In-app = saved for the participant, shown later. */
        channels: { type: DataTypes.JSON, allowNull: true },

        status: {
            type: DataTypes.ENUM('draft', 'scheduled', 'sending', 'sent', 'failed'),
            allowNull: false,
            defaultValue: 'draft',
        },
        scheduled_at: { type: DataTypes.DATE, allowNull: true },
        timezone: { type: DataTypes.STRING(80), allowNull: true },
        sent_at: { type: DataTypes.DATE, allowNull: true },

        /** Participants it was saved for. */
        recipients_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        /** Of those, how many had a device that accepted the push. */
        delivered_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        failed_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        failed_reason: { type: DataTypes.STRING(255), allowNull: true },
    }, {
        tableName: 'event_notifications',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventNotification;
};
