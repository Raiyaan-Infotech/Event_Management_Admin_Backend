const { DataTypes } = require('sequelize');

/**
 * A named set of guests — Family, Friends, Colleagues.
 *
 * A TABLE rather than a string on the guest row, because the Manage Groups
 * screen gives a group a description, a colour, a visibility and a default
 * flag, and counts its members. None of that fits in a VARCHAR.
 *
 * Scoped to the CLIENT, not to an event: the design's group list has an
 * "Events" column counting how many events each group is used in, so one
 * "Family" is shared across the whole account rather than recreated per event.
 */
module.exports = (sequelize) => {
    const EventGuestGroup = sequelize.define('EventGuestGroup', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER, allowNull: true },

        name: { type: DataTypes.STRING(120), allowNull: false },
        description: { type: DataTypes.STRING(500), allowNull: true },
        /** Hex, from the Add Group colour row. */
        color: { type: DataTypes.STRING(9), allowNull: true, defaultValue: '#EC4899' },
        visibility: {
            type: DataTypes.ENUM('private', 'public'),
            allowNull: false,
            defaultValue: 'private',
        },
        /**
         * "New guests will be added to this group by default."
         *
         * At most one per client, enforced in the service rather than by an
         * index — MySQL has no partial unique index, so a UNIQUE here would
         * also forbid a second group with is_default = 0.
         */
        is_default: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'event_guest_groups',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventGuestGroup;
};
