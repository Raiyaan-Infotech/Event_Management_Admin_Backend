const { DataTypes } = require('sequelize');

/**
 * One entry in a guest's RSVP history.
 *
 * ⚠ THIS TABLE CHANGES A RULE THAT HELD UNTIL NOW. A guest row held ONE current
 * answer and changing it overwrote the old one, which is why the RSVP detail
 * payload said plainly that there is no history. From here on every response
 * change appends a row, and the RSVP History tab is that list.
 *
 * ⚠ APPEND ONLY. Nothing updates or deletes a row here — a history you can edit
 * is not a history, and `paranoid` is off for the same reason. The CURRENT
 * answer still lives on `event_guests`; this is how it got there. The two are
 * never alternatives to each other, and code that needs "what did they say"
 * must read the guest, not the newest log row.
 *
 * `event_id` is denormalised from the guest deliberately: the tab lists one
 * person's answers across many events, and joining every row back through the
 * guest to reach the event is the query this table exists to avoid.
 */
module.exports = (sequelize) => {
    const EventGuestResponseLog = sequelize.define('EventGuestResponseLog', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        /**
         * NULL on the first entry, and that is NOT the same as 'none'.
         *
         * 'none' would claim they had actively said nothing before; NULL says
         * there was no previous answer to speak of. The screen prints the first
         * entry as "Responded" and later ones as "Changed from X", which only
         * works if the two are distinguishable.
         */
        from_response_type: {
            type: DataTypes.ENUM('none', 'yes', 'no', 'maybe'),
            allowNull: true,
        },
        to_response_type: {
            type: DataTypes.ENUM('none', 'yes', 'no', 'maybe'),
            allowNull: false,
        },

        /* A snapshot of what was true WITH this answer, not the guest's current
           values — that is the whole point of a history. */
        party_size: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 1 },
        dietary_preference: { type: DataTypes.STRING(255), allowNull: true },
        accommodation: {
            type: DataTypes.ENUM('unknown', 'required', 'not_required'),
            allowNull: false,
            defaultValue: 'unknown',
        },
        notes: { type: DataTypes.STRING(500), allowNull: true },

        /** `client` = the host edited it. `guest` = they answered themselves. */
        source: {
            type: DataTypes.ENUM('client', 'guest', 'import', 'system'),
            allowNull: false,
            defaultValue: 'client',
        },
        changed_by_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
        tableName: 'event_guest_response_logs',
        /* `updated_at` would be a column nothing may ever set. */
        timestamps: true,
        updatedAt: false,
        createdAt: 'created_at',
        paranoid: false,
    });

    return EventGuestResponseLog;
};
