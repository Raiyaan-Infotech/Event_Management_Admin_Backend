const { DataTypes } = require('sequelize');

/**
 * One delivery attempt, down one channel, for one event.
 *
 * Separate from `EventGuest` because a guest can be messaged repeatedly — a
 * reminder, a re-send after a bounce — so delivery counts cannot be columns on
 * the guest row without either losing the history or double-counting the person.
 *
 * `delivered_at` / `opened_at` / `clicked_at` are timestamps rather than
 * booleans. A boolean answers "did they open it"; a timestamp also answers
 * "when", and the trend charts are time series.
 */
module.exports = (sequelize) => {
    const EventMessage = sequelize.define('EventMessage', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        /**
         * The composed message this delivery belongs to.
         *
         * Nullable because a one-off send — a single re-invite from the guest
         * row — has no campaign behind it, and forcing one would put rows in the
         * Messages list that nobody ever composed.
         */
        campaign_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        /** Nullable: a broadcast to a list never saved as guest rows still counts. */
        guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        channel: { type: DataTypes.ENUM('whatsapp', 'email', 'sms'), allowNull: false },
        kind: {
            type: DataTypes.ENUM('invite', 'reminder', 'update', 'thank_you'),
            allowNull: false,
            defaultValue: 'invite',
        },
        /**
         * 'queued' exists so a send that never left is distinguishable from one
         * that was delivered — without it a failed provider call looks like a
         * successful delivery in every rate on the dashboard.
         */
        status: {
            type: DataTypes.ENUM('queued', 'sent', 'delivered', 'failed'),
            allowNull: false,
            defaultValue: 'sent',
        },

        sent_at: { type: DataTypes.DATE, allowNull: true },
        delivered_at: { type: DataTypes.DATE, allowNull: true },
        opened_at: { type: DataTypes.DATE, allowNull: true },
        clicked_at: { type: DataTypes.DATE, allowNull: true },
        failed_reason: { type: DataTypes.STRING(255), allowNull: true },

        /**
         * The "Sender" column on Invitation History.
         *
         * ⚠ This is an ACTOR, not a user. `website_clients` is one login per
         * account with no team under it, so the only two answers are "the
         * account holder did this" and "the system did". An FK to a users
         * table would imply a multi-user model this product does not have.
         *
         * Existing rows default to `system`: nobody recorded otherwise, and
         * guessing the account holder would put a name against sends they may
         * not have made.
         */
        sender: {
            type: DataTypes.ENUM('client', 'system'),
            allowNull: false,
            defaultValue: 'system',
        },
        sender_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_messages',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventMessage;
};
