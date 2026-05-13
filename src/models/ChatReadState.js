module.exports = (sequelize, DataTypes) => {
  const ChatReadState = sequelize.define('ChatReadState', {
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
    last_read_message_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    last_read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: 'chat_read_states',
    timestamps: true,
  });

  return ChatReadState;
};
