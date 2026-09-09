const { DataTypes } = require('sequelize');

/**
 * A CLIENT's per-event override of one notification template.
 *
 * ── NO ROW = "ON" ────────────────────────────────────────────────────────
 * Every template that applies to an event (matched by event_category_id /
 * event_type_id in notificationTemplate.service.js) is on by default. A row
 * here only exists once the client has actually flipped a switch — same
 * "no row = inherit default" convention as ClientNotificationPref. Never
 * snapshot the template's own is_active into this row: if the admin later
 * reactivates a template, every event must see that immediately rather than
 * staying frozen at whatever was true when this row was written.
 *
 * ── NOTHING READS THIS TO GATE A SEND YET ──────────────────────────────
 * No trigger fires these notifications automatically today. This table
 * exists so the choice is already recorded and correct the day a trigger is
 * wired up — same reasoning as ClientNotificationPref's own header.
 */
module.exports = (sequelize) => {
    const EventNotificationTemplatePref = sequelize.define('EventNotificationTemplatePref', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        event_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        notification_template_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'event_notification_template_prefs',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { unique: true, fields: ['event_id', 'notification_template_id'] },
            { fields: ['website_client_id'] },
        ],
    });

    return EventNotificationTemplatePref;
};
