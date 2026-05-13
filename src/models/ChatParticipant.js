module.exports = (sequelize, DataTypes) => {
  const ChatParticipant = sequelize.define('ChatParticipant', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    conversation_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
    },
    actor_type: {
      type: DataTypes.ENUM('admin', 'vendor', 'client'),
      allowNull: false,
    },
    actor_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    display_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    avatar: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    last_read_message_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    last_read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_muted: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
    },
  }, {
    tableName: 'chat_participants',
    timestamps: true,
    paranoid: true,
  });

  return ChatParticipant;
};
