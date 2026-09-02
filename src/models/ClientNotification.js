const { DataTypes } = require('sequelize');

/**
 * One thing that happened, told to one client.
 *
 * ── WHY NOT `mail_notifications` ────────────────────────────────────────────
 * That table is a read-flag hung off a row in `mails` and cannot exist without
 * one. This feed carries things that are not mail — an RSVP arrived, an event
 * starts tomorrow, invitations finished going out. Routing those through the
 * mail tables would mean inventing a `mails` row for each, and every mail screen
 * in three portals would then have to learn to hide them.
 *
 * ── THE TEXT IS RENDERED WHEN IT FIRES, NOT WHEN IT IS READ ─────────────────
 * `title` and `body` are stored as finished sentences. Composing them on read
 * would join the guest and the event on every page of the feed, and — worse — a
 * notification would silently rewrite itself when the guest was renamed or the
 * event deleted. A notification is a record of what was true at that moment.
 *
 * `event_id` / `guest_id` survive beside the text, ON DELETE SET NULL, so a row
 * offers a link while it still resolves and simply stops offering one when it
 * does not.
 */
module.exports = (sequelize) => {
    const ClientNotification = sequelize.define('ClientNotification', {
        id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: true },

        /**
         * What the UI groups by — a closed set, because it is a tab bar.
         * Adding one here means adding a tab, which is a deliberate act.
         */
        category: {
            type: DataTypes.ENUM('rsvp', 'reminder', 'message', 'system', 'guest'),
            allowNull: false,
            defaultValue: 'system',
        },
        /**
         * What actually happened: 'rsvp_accepted', 'invitation_delivered',
         * 'event_reminder'. Open-ended, because a per-type preference in
         * `client_notification_prefs` switches on this and not on the category.
         */
        type: { type: DataTypes.STRING(60), allowNull: false },

        title: { type: DataTypes.STRING(200), allowNull: false },
        body: { type: DataTypes.STRING(500), allowNull: true },

        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        /** The in-app path this row opens. NULL means there is nothing to open. */
        link: { type: DataTypes.STRING(255), allowNull: true },
        /**
         * Extra detail for the side panel — a guest's email, an RSVP note.
         * Never load-bearing: the feed must render correctly with `meta` null,
         * because every row written before a new key existed has none.
         */
        meta: { type: DataTypes.JSON, allowNull: true },

        is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        read_at: { type: DataTypes.DATE, allowNull: true },
        /**
         * Archive hides a row from the feed without destroying it. "Seen and
         * dealt with" and "never happened" are different answers, and only one
         * of them should survive a support question.
         */
        archived_at: { type: DataTypes.DATE, allowNull: true },
    }, {
        tableName: 'client_notifications',
        timestamps: true,
        // Not paranoid: `archived_at` already is the soft delete, and a second
        // hidden state would make "why can I not see it" un-answerable.
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { fields: ['website_client_id', 'archived_at', 'created_at'] },
            { fields: ['website_client_id', 'is_read', 'archived_at'] },
            { fields: ['website_client_id', 'category', 'archived_at'] },
            { fields: ['event_id'] },
            { fields: ['guest_id'] },
        ],
    });

    return ClientNotification;
};
