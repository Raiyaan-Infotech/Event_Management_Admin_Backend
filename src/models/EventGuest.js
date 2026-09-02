const { DataTypes } = require('sequelize');

/**
 * A person invited to an event.
 *
 * `rsvp_status` carries `no_response` as a real value rather than NULL: a guest
 * who was invited and has not replied is a KNOWN state — it is a slice of the
 * RSVP donut — and NULL would drop them out of every GROUP BY.
 *
 * `invite_source` is how this person first came in. It is NOT the same as
 * `EventMessage.channel`, which is how one specific message went out; a guest
 * invited by WhatsApp can later be emailed a reminder.
 */
module.exports = (sequelize) => {
    const EventGuest = sequelize.define('EventGuest', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        // Denormalised from the event so guest queries scope by owner without a
        // join. The event stays the source of truth.
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: true },

        /**
         * Display name, kept alongside the split pair.
         *
         * The CSV has First/Last as separate columns and the composer needs
         * `{first_name}`, `{last_name}` AND `{full_name}` — one column cannot
         * serve all three without guessing where to split a name like
         * "Ravi Kumar Menon".
         */
        name: { type: DataTypes.STRING(200), allowNull: false },
        first_name: { type: DataTypes.STRING(100), allowNull: true },
        last_name: { type: DataTypes.STRING(100), allowNull: true },
        title: { type: DataTypes.STRING(30), allowNull: true },
        /** Ungrouped when null. Deleting a group SET NULLs this, never the row. */
        group_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        email: { type: DataTypes.STRING(255), allowNull: true },
        dial_code: { type: DataTypes.STRING(8), allowNull: true, defaultValue: '+91' },
        mobile: { type: DataTypes.STRING(20), allowNull: true },
        /** Its own column — the CSV carries Phone and WhatsApp separately, and
         *  for plenty of people they genuinely differ. */
        whatsapp: { type: DataTypes.STRING(20), allowNull: true },
        company: { type: DataTypes.STRING(200), allowNull: true },
        /** Merge field {table_number}. Free text — "12", "Head Table", "A3". */
        table_number: { type: DataTypes.STRING(30), allowNull: true },

        address_line1: { type: DataTypes.STRING(255), allowNull: true },
        address_line2: { type: DataTypes.STRING(255), allowNull: true },
        city: { type: DataTypes.STRING(120), allowNull: true },
        state: { type: DataTypes.STRING(120), allowNull: true },
        postal_code: { type: DataTypes.STRING(20), allowNull: true },
        country: { type: DataTypes.STRING(100), allowNull: true, defaultValue: 'India' },

        dietary_preference: { type: DataTypes.STRING(255), allowNull: true },
        special_requirements: { type: DataTypes.STRING(500), allowNull: true },
        /** Allowed vs. count are separate, as in the CSV: "allowed but nobody
         *  named yet" is not the same as "not allowed". */
        plus_one: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
        plus_one_count: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
        custom_answers: { type: DataTypes.JSON, allowNull: true },
        /** One invitation often covers a couple or a family. */
        party_size: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 1 },

        /**
         * Where the INVITATION has got to. Distinct from `response_type`, which
         * is what the guest actually said — the import CSV proves they are two
         * things: a row can be `Invited` with a blank Response.
         *
         *   not_responded -> invited -> pending -> accepted | declined
         */
        rsvp_status: {
            type: DataTypes.ENUM('not_responded', 'invited', 'pending', 'accepted', 'declined'),
            allowNull: false,
            defaultValue: 'not_responded',
        },
        /** What the guest said. 'none' is a real value, not NULL — see the model note. */
        response_type: {
            type: DataTypes.ENUM('none', 'yes', 'no', 'maybe'),
            allowNull: false,
            defaultValue: 'none',
        },
        invite_source: {
            type: DataTypes.ENUM('whatsapp', 'email', 'sms', 'manual', 'import'),
            allowNull: false,
            defaultValue: 'manual',
        },

        /** NULL = added to the list but not yet invited. */
        invited_at: { type: DataTypes.DATE, allowNull: true },
        responded_at: { type: DataTypes.DATE, allowNull: true },
        /**
         * What the GUEST said with their response.
         *
         * ⚠ Not the host's notes about them — those are rows in
         * `event_guest_notes`. Two authors, two lifetimes; merging them would
         * lose which of the two a sentence came from.
         */
        notes: { type: DataTypes.STRING(500), allowNull: true },

        photo: { type: DataTypes.STRING(500), allowNull: true },
        /**
         * Three states, not a boolean.
         *
         * The profile prints "—" for a guest nobody has asked, and a tinyint
         * cannot tell "not required" from "never answered" — the difference
         * between a guest who declined a room and one still to be chased.
         */
        accommodation: {
            type: DataTypes.ENUM('unknown', 'required', 'not_required'),
            allowNull: false,
            defaultValue: 'unknown',
        },
        /** Free text. A fixed list would exclude the relationship somebody
         *  actually has, and this is separate from `group_id` even when the
         *  two happen to agree. */
        relationship: { type: DataTypes.STRING(60), allowNull: true },
        /**
         * "Invited By". NULL forever on rows added before this existed —
         * backfilling them with the account owner would be inventing a fact,
         * so they read "—", which is correct.
         */
        added_by_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_guests',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventGuest;
};
