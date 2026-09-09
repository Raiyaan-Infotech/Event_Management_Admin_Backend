const { DataTypes } = require('sequelize');

/**
 * Admin-authored transactional message template — e.g. "RSVP Confirmation",
 * "Event Reminder". Distinct from `EventMessageCampaign` (one AD-HOC compose
 * sent to an audience): a template is a reusable blueprint, scoped by
 * notification category / event category / event type, meant to be picked up
 * later by system-triggered sends (RSVP confirm, reminders) rather than
 * composed by hand each time.
 */
module.exports = (sequelize) => {
    const NotificationTemplate = sequelize.define('NotificationTemplate', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(150),
            allowNull: false,
        },
        /**
         * Explicit link to the system event that fires this template — set from
         * a fixed dropdown (see notificationTemplate.service.js's SYSTEM_TRIGGERS),
         * never derived from `name`. `name` is free-text and can be renamed at
         * will without breaking notificationTrigger.service.js's lookup. Unique:
         * only one template may own a given trigger at a time.
         */
        trigger_key: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        notification_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        event_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        event_type_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        title: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        content: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        /** Placeholders actually referenced in title/content, derived on save. */
        variables_used: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        image_url: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        /** Subset of 'in_app' / 'push'. */
        channels: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: ['in_app'],
        },
        is_active: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
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
        tableName: 'notification_templates',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return NotificationTemplate;
};
