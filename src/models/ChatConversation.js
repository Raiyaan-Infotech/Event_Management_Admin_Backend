module.exports = (sequelize, DataTypes) => {
  const ChatConversation = sequelize.define('ChatConversation', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    company_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    vendor_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    conversation_type: {
      type: DataTypes.ENUM('direct', 'group'),
      allowNull: false,
      defaultValue: 'direct',
    },
    context_type: {
      type: DataTypes.STRING(80),
      allowNull: true,
      defaultValue: 'general',
    },
    context_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    last_message_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
    },
    last_message_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1,
    },
  }, {
    tableName: 'chat_conversations',
    timestamps: true,
    paranoid: true,
  });

  return ChatConversation;
};
