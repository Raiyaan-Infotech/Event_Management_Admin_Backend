/** One message of a Contact Person chat (see EventContactChat). */
module.exports = (sequelize, DataTypes) => sequelize.define(
    'EventContactChatMessage',
    {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        chat_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        sender_side: { type: DataTypes.ENUM('participant', 'team'), allowNull: false },
        sender_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        body: { type: DataTypes.TEXT, allowNull: false },
    },
    { tableName: 'event_contact_chat_messages', timestamps: true, updatedAt: false, underscored: true },
);
