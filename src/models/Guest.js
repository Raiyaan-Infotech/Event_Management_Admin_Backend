const { DataTypes } = require('sequelize');

/**
 * A guest in the client's PHONE BOOK (§581).
 *
 * The client adds the people they know, organised in groups, and SHARES an
 * event's invitation with them. Sharing writes nothing: a guest is never
 * attached to an event by being invited. Only scanning the QR does that, and
 * it creates a PARTICIPANT (`event_participants`), linked back here by `guest_id`
 * when the scanner's mobile matches.
 *
 * So there are no RSVP, party-size or table columns on this row — those are
 * answers about ONE event and live on the participant.
 *
 * Limited by the plan's `max_guests_per_event`, which counts the phone book in
 * total (§569), not per event.
 */
module.exports = (sequelize) => {
    const Guest = sequelize.define('Guest', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: true },
        group_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        title: { type: DataTypes.STRING(30), allowNull: true },
        first_name: { type: DataTypes.STRING(100), allowNull: true },
        last_name: { type: DataTypes.STRING(100), allowNull: true },
        // Composed from first + last on every write, so it never drifts.
        name: { type: DataTypes.STRING(200), allowNull: false },
        date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
        gender: { type: DataTypes.ENUM('male', 'female', 'other'), allowNull: true },

        email: { type: DataTypes.STRING(255), allowNull: true },
        dial_code: { type: DataTypes.STRING(8), allowNull: true, defaultValue: '+91' },
        // The key a guest is known by (§576) — invitations are shared to it.
        mobile: { type: DataTypes.STRING(20), allowNull: true },
        whatsapp: { type: DataTypes.STRING(20), allowNull: true },
        company: { type: DataTypes.STRING(200), allowNull: true },

        relationship: { type: DataTypes.STRING(60), allowNull: true },
        relationship_option_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        address_line1: { type: DataTypes.STRING(255), allowNull: true },
        address_line2: { type: DataTypes.STRING(255), allowNull: true },
        city: { type: DataTypes.STRING(120), allowNull: true },
        state: { type: DataTypes.STRING(120), allowNull: true },
        postal_code: { type: DataTypes.STRING(20), allowNull: true },
        country: { type: DataTypes.STRING(100), allowNull: true, defaultValue: 'India' },

        dietary_preference: { type: DataTypes.STRING(255), allowNull: true },
        food_preference_option_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        special_requirements: { type: DataTypes.STRING(500), allowNull: true },
        notes: { type: DataTypes.STRING(500), allowNull: true },
        photo: { type: DataTypes.STRING(500), allowNull: true },

        /** How the guest got into the phone book. */
        source: {
            type: DataTypes.ENUM('manual', 'import'),
            allowNull: false,
            defaultValue: 'manual',
        },
        /** The event_participants row this was moved from by the §581 split. Audit only. */
        migrated_from_guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'guests',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return Guest;
};
