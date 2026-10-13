const { DataTypes } = require('sequelize');

/**
 * One participant an organizer's notification (`event_notifications`) was
 * sent to — written when the notification goes out, one row per participant.
 *
 * This is the row the participant's own list will read (`is_read` / `read_at`
 * are here for it). `status` is about the PUSH only: 'sent' = a device of
 * theirs accepted it, 'failed' = none did (`failed_reason` says why — most
 * often they have not joined the app). The row exists either way.
 */
module.exports = (sequelize) => {
    const EventNotificationRecipient = sequelize.define('EventNotificationRecipient', {
        id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
        notification_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        /** `event_participants.id`. */
        participant_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        /** Their app account; NULL = has not joined through the app. */
        participant_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        status: {
            type: DataTypes.ENUM('queued', 'sent', 'failed'),
            allowNull: false,
            defaultValue: 'queued',
        },
        failed_reason: { type: DataTypes.STRING(255), allowNull: true },
        sent_at: { type: DataTypes.DATE, allowNull: true },

        is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        read_at: { type: DataTypes.DATE, allowNull: true },
    }, {
        tableName: 'event_notification_recipients',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    return EventNotificationRecipient;
};
