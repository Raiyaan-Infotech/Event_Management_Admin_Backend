/** One message of a Contact Person chat (see EventContactChat). */
module.exports = (sequelize, DataTypes) => sequelize.define(
    'EventContactChatMessage',
    {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        chat_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        sender_side: { type: DataTypes.ENUM('participant', 'team'), allowNull: false },
        sender_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        body: { type: DataTypes.TEXT, allowNull: false },
        // The offline auto reply (sent by the server, not a person).
        is_auto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'event_contact_chat_messages', timestamps: true, updatedAt: false, underscored: true },
);
