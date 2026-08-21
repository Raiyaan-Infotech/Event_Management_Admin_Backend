const { DataTypes } = require('sequelize');

/**
 * One composed message, sent to many guests.
 *
 * Separate from `EventMessage`, which is one row per RECIPIENT. The Messages
 * list is one row per campaign (subject, recipients, status, sent on); the
 * per-recipient rows are what make open and click tracking per person possible.
 * Collapsing the two would mean either losing that tracking or repeating the
 * whole message body once per guest.
 */
module.exports = (sequelize) => {
    const EventMessageCampaign = sequelize.define('EventMessageCampaign', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        subject: { type: DataTypes.STRING(255), allowNull: false },
        /**
         * Rich text from the composer, with merge fields left UN-substituted.
         * Storing the rendered text would make the campaign un-resendable to a
         * different audience, and would bloat the row with one copy per guest.
         */
        body: { type: DataTypes.TEXT('medium'), allowNull: true },
        channel: {
            type: DataTypes.ENUM('email', 'sms', 'whatsapp', 'push'),
            allowNull: false,
            defaultValue: 'email',
        },
        kind: {
            type: DataTypes.ENUM('invite', 'reminder', 'update', 'thank_you', 'custom'),
            allowNull: false,
            defaultValue: 'invite',
        },

        /**
         * Who it went to. The id lists are SNAPSHOTS — a group edited after the
         * send must not retroactively change who a sent campaign reached.
         */
        audience: {
            type: DataTypes.ENUM('all', 'groups', 'guests'),
            allowNull: false,
            defaultValue: 'all',
        },
        group_ids: { type: DataTypes.JSON, allowNull: true },
        guest_ids: { type: DataTypes.JSON, allowNull: true },
        recipients_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },

        status: {
            type: DataTypes.ENUM('draft', 'scheduled', 'sending', 'sent', 'failed'),
            allowNull: false,
            defaultValue: 'draft',
        },
        scheduled_at: { type: DataTypes.DATE, allowNull: true },
        /** The optional delivery window from the Schedule dialog. */
        window_start: { type: DataTypes.TIME, allowNull: true },
        window_end: { type: DataTypes.TIME, allowNull: true },
        timezone: { type: DataTypes.STRING(80), allowNull: true },
        sent_at: { type: DataTypes.DATE, allowNull: true },
        failed_reason: { type: DataTypes.STRING(255), allowNull: true },
    }, {
        tableName: 'event_message_campaigns',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventMessageCampaign;
};
