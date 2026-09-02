const { DataTypes } = require('sequelize');

/**
 * A note the HOST wrote about a guest.
 *
 * ⚠ Not `EventGuest.notes`. That column stays and keeps its own meaning: what
 * the GUEST said with their response. These are the host's own observations —
 * "prefers email", "vegetarian", "Rohan's cousin". Two authors and two
 * lifetimes, and merging them would lose which of the two a sentence came from.
 *
 * `body` is HTML from the rich text editor, so every screen that prints it must
 * use `dangerouslySetInnerHTML` — splitting it as plain text renders the tags.
 */
module.exports = (sequelize) => {
    const EventGuestNote = sequelize.define('EventGuestNote', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        title: { type: DataTypes.STRING(150), allowNull: false },
        body: { type: DataTypes.TEXT('medium'), allowNull: true },

        category: {
            type: DataTypes.ENUM('general', 'personal', 'dietary', 'communication', 'reminder', 'logistics'),
            allowNull: false,
            defaultValue: 'general',
        },
        /**
         * `shared` is RESERVED, not implemented.
         *
         * Nothing shows a guest their own notes — there is no guest-facing view
         * at all. The value exists so the column does not need changing the day
         * one is built; until then every note is internal in practice.
         */
        visibility: {
            type: DataTypes.ENUM('internal', 'shared'),
            allowNull: false,
            defaultValue: 'internal',
        },
        is_pinned: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },

        /** The actor, same reasoning as `EventMessage.sender`. */
        created_by_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_guest_notes',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventGuestNote;
};
