const { DataTypes } = require('sequelize');

/**
 * One value in the "Relationship with Invitor" dropdown on the mobile app's
 * guest registration form.
 *
 * Scoped per event category, the same way `Religion` is: a wedding offers
 * "Bride's Father", a corporate event offers "Delegate", and offering both
 * everywhere would make the list useless in either.
 *
 * ── `event_category_id` IS NULLABLE, AND RELIGION'S IS NOT ───────────────────
 * `events.event_category_id` is itself nullable, so an event can exist with no
 * category. NULL rows here are the fallback list those events fall back to —
 * without them a guest opens the form and finds an empty dropdown.
 *
 * ── THE GUEST'S ANSWER IS NOT THIS ROW ──────────────────────────────────────
 * `event_guests.relationship` stores the chosen LABEL as text, alongside an
 * optional FK to this row. What a guest said is a historical fact: renaming or
 * deleting an option here must not retroactively change what somebody answered
 * six months ago.
 *
 * Shape deliberately mirrors `Religion` / `EventCategory` field for field, so
 * the shared admin list components work against it without special-casing.
 */
module.exports = (sequelize) => {
    const GuestRelationshipOption = sequelize.define('GuestRelationshipOption', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        /** NULL = the fallback list. See the header. */
        event_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        icon: {
            type: DataTypes.STRING(100),
            allowNull: true,
            defaultValue: '',
        },
        color: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        is_active: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        company_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        updated_by: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
    }, {
        tableName: 'guest_relationship_options',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return GuestRelationshipOption;
};
