const { DataTypes } = require('sequelize');

/**
 * One Contact Person responsibility (label name + description) for one event
 * category — the admin's Menu Management → Responsibilities module (Jamal,
 * 2026-10-27). The app's Contact Person profile shows the event category's
 * list; NULL category = the fallback list.
 *
 * Same shape as GuestRelationshipOption, so the shared option service and the
 * admin TaxonomyManager work against it unchanged.
 */
module.exports = (sequelize) => sequelize.define('EventResponsibility', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    event_category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    icon: { type: DataTypes.STRING(100), allowNull: true, defaultValue: '' },
    color: { type: DataTypes.STRING(20), allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    company_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    updated_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
}, {
    tableName: 'event_responsibilities',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
});
