const { DataTypes } = require('sequelize');

/**
 * One member of an event's FAMILY list ("Mr. Rajesh Kumar — Father, Groom Side").
 *
 * ── NOT A GUEST, NOT A PARTICIPANT ──────────────────────────────────────────
 * A family member is a display record the organizer types in for ONE event. They
 * have no login and no RSVP, they are not on the guest list and not in any guest
 * group. The old flow filed family as guests under a "Family" group; that is gone
 * (Jamal, 2026-10-12). Participants only ever READ this list.
 *
 * `mobile` / `email` are kept for the organizer's own reference and are never
 * sent to a participant.
 *
 * `sort_order` is per event — the order the host set with Change Order, and the
 * number printed on the right of each row.
 */
module.exports = (sequelize) => {
    const EventFamilyMember = sequelize.define('EventFamilyMember', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        title: { type: DataTypes.STRING(30), allowNull: true },
        name: { type: DataTypes.STRING(150), allowNull: false },
        photo: { type: DataTypes.STRING(500), allowNull: true },
        date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },

        /** Which side of the couple this person is on. */
        side: { type: DataTypes.ENUM('groom', 'bride'), allowNull: false },
        /** The relation's name ("Father") — the picked option's name, kept as text. */
        relationship: { type: DataTypes.STRING(100), allowNull: true },
        relationship_option_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        dial_code: { type: DataTypes.STRING(8), allowNull: true },
        mobile: { type: DataTypes.STRING(20), allowNull: true },
        email: { type: DataTypes.STRING(150), allowNull: true },
        notes: { type: DataTypes.STRING(500), allowNull: true },

        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'event_family_members',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventFamilyMember.associate = (models) => {
        EventFamilyMember.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
    };

    return EventFamilyMember;
};
