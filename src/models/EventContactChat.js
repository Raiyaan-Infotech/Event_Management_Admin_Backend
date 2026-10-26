/**
 * Contact Person chat (2026-10-26): one participant's chat with the event team
 * (owner + contact person). See migrations/sql/20261026-event-contact-chats.sql
 * and clientContactChat.service.
 */
module.exports = (sequelize, DataTypes) => sequelize.define(
    'EventContactChat',
    {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        participant_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        // 'removed' = taken off Participant Chats (Remove Participant).
        status: { type: DataTypes.ENUM('open', 'resolved', 'blocked', 'removed'), allowNull: false, defaultValue: 'open' },
        last_message: { type: DataTypes.STRING(255), allowNull: true },
        last_message_at: { type: DataTypes.DATE, allowNull: true },
        team_unread: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        participant_unread: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    { tableName: 'event_contact_chats', timestamps: true, underscored: true },
);
