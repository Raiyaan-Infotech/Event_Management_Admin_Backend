const { DataTypes } = require('sequelize');

/**
 * A label on a guest — "Family", "Close Guest", "Delhi".
 *
 * A ROW per tag, not a JSON array on the guest. Tags are the one thing on the
 * profile people will want to filter and count by ("show me every Close
 * Guest"), and a JSON column cannot be indexed for that.
 *
 * The unique key is (guest_id, label, deleted_at) — the `deleted_at` is there
 * on purpose. Without it a soft-deleted row would hold its label hostage and a
 * tag could never be removed and added back.
 */
module.exports = (sequelize) => {
    const EventGuestTag = sequelize.define('EventGuestTag', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },

        label: { type: DataTypes.STRING(60), allowNull: false },
        /**
         * NULL means "derive it from the label".
         *
         * Storing a colour per row lets the same tag come out blue on one
         * screen and pink on another; a null lets one function decide, so every
         * screen agrees. Only set it when somebody explicitly picks a colour.
         */
        color: { type: DataTypes.STRING(9), allowNull: true },
    }, {
        tableName: 'event_guest_tags',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventGuestTag;
};
