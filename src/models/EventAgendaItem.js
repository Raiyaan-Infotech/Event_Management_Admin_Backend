const { DataTypes } = require('sequelize');

/**
 * One item on an event's agenda / schedule ("Reception, 15 Feb, 09:00–10:00,
 * Main Hall").
 *
 * `end_date` is set only for an item that spans several days (the Add Agenda
 * screen's "Multiple Days" tab); a single-day item leaves it NULL rather than
 * repeating `agenda_date`, so "is this multi-day" is one null check.
 *
 * `end_time` earlier than `start_time` is allowed and means the item ends after
 * midnight (an After Party 22:00–00:00) — decided by Jamal, 2026-09-30.
 *
 * `sort_order` is per event and is the order the host dragged on the Reorder
 * screen; the day tabs are a filter over that one list, not separate orders.
 */
module.exports = (sequelize) => {
    const EventAgendaItem = sequelize.define('EventAgendaItem', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        title: { type: DataTypes.STRING(100), allowNull: false },
        description: { type: DataTypes.STRING(200), allowNull: true },
        agenda_date: { type: DataTypes.DATEONLY, allowNull: false },
        /** Multi-day items only; NULL for a single-day item. */
        end_date: { type: DataTypes.DATEONLY, allowNull: true },
        start_time: { type: DataTypes.TIME, allowNull: false },
        end_time: { type: DataTypes.TIME, allowNull: false },
        location: { type: DataTypes.STRING(150), allowNull: true },
        /** Array of stored image URLs, first = the item's cover. */
        images: { type: DataTypes.JSON, allowNull: true },

        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_agenda_items',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventAgendaItem.associate = (models) => {
        EventAgendaItem.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
    };

    return EventAgendaItem;
};
