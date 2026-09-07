const { DataTypes } = require('sequelize');

/**
 * One value in the "Food Preference" dropdown on the mobile app's guest
 * registration form.
 *
 * Scoped per event category: a religious event offers "Prasadam / Temple Meal"
 * and a sports tournament offers "High-Protein Meal", and neither belongs in
 * the other's list.
 *
 * Same shape and the same reasoning as [GuestRelationshipOption] — including
 * the nullable `event_category_id` fallback list, and the rule that
 * `event_guests.dietary_preference` keeps the chosen LABEL as text so a later
 * rename here cannot rewrite what a guest already answered.
 *
 * Kept as its own model rather than one table with a `kind` column: these two
 * lists are edited on separate admin screens, have unrelated values, and grow
 * independently. A shared table would need every query to remember the filter,
 * and forgetting it once would put food options in the relationship dropdown.
 */
module.exports = (sequelize) => {
    const GuestFoodPreferenceOption = sequelize.define('GuestFoodPreferenceOption', {
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
        tableName: 'guest_food_preference_options',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return GuestFoodPreferenceOption;
};
