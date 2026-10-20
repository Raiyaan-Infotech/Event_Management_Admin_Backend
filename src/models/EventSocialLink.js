const { DataTypes } = require('sequelize');

/**
 * One social link of an event (Social Links menu, 2026-10-20).
 *
 * PRESET rows — Instagram, Facebook, X, YouTube (`platform_key` set) — exist
 * for every event; their platform name and icon are fixed and they cannot be
 * deleted (Remove only clears the link). CUSTOM rows (`platform_key` NULL)
 * carry the organizer's own platform name and uploaded icon. A row with no
 * `url` is never shown to participants.
 */
module.exports = (sequelize) => {
    const EventSocialLink = sequelize.define('EventSocialLink', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        platform_key: { type: DataTypes.STRING(30), allowNull: true },
        platform_name: { type: DataTypes.STRING(60), allowNull: false },
        title: { type: DataTypes.STRING(100), allowNull: false },
        url: { type: DataTypes.STRING(500), allowNull: true },
        description: { type: DataTypes.STRING(300), allowNull: true },
        icon_url: { type: DataTypes.STRING(500), allowNull: true },
        sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        open_external: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        show_in_app: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_social_links',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    EventSocialLink.associate = (models) => {
        EventSocialLink.belongsTo(models.Event, { foreignKey: 'event_id', as: 'event' });
    };

    return EventSocialLink;
};
