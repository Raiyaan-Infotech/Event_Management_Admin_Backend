const { DataTypes } = require('sequelize');

/**
 * One wish on an event's Wishes wall (2026-10-16).
 *
 * Written by a participant in the app (`author_client_id` = their client id,
 * name taken from their participant row), or added by the organizer on
 * someone's behalf (`author_client_id` NULL, name / mobile typed).
 *
 * `is_hidden` = hidden from participants; the organizer still sees it and can
 * show it again. A new participant wish is visible at once (Jamal: no
 * approval step). Blocking is per author, see EventWishBlock.
 */
module.exports = (sequelize) => {
    const EventWish = sequelize.define('EventWish', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        author_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        guest_name: { type: DataTypes.STRING(150), allowNull: false },
        mobile: { type: DataTypes.STRING(20), allowNull: true },
        message: { type: DataTypes.STRING(500), allowNull: false },
        photo: { type: DataTypes.STRING(500), allowNull: true },
        is_hidden: { type: DataTypes.TINYINT(1), allowNull: false, defaultValue: 0 },
    }, {
        tableName: 'event_wishes',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventWish.associate = (models) => {
        EventWish.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
    };

    return EventWish;
};
