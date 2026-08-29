const { DataTypes } = require('sequelize');

/**
 * A "Contact Our Sales Team" submission.
 *
 * ── WHY THIS TABLE EXISTS AT ALL ────────────────────────────────────────────
 * There is no SMTP anywhere in this system, so the form cannot email anybody.
 * The choice was between a form that silently discards what is typed into it
 * and a form that STORES it for somebody to follow up. This codebase has
 * shipped the first kind before — the Contact Us page whose Save did nothing,
 * the wizard whose Create Event never POSTed — and each time it read as working
 * until somebody checked.
 *
 * So the submission is stored and the screen says a person will be in touch,
 * rather than implying an email just went out.
 *
 * `interests` is JSON because it is the design's checkbox SET — a list, not a
 * column each, and adding an option later must not be a migration.
 */
module.exports = (sequelize) => {
    const ClientSalesEnquiry = sequelize.define('ClientSalesEnquiry', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        // Nullable and ON DELETE SET NULL: an enquiry outlives the account that
        // raised it — somebody may close their account precisely because sales
        // never got back to them.
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        company_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        full_name: { type: DataTypes.STRING(150), allowNull: false },
        work_email: { type: DataTypes.STRING(190), allowNull: false },
        company_name: { type: DataTypes.STRING(190), allowNull: true },
        phone: { type: DataTypes.STRING(30), allowNull: true },
        events_per_year: { type: DataTypes.STRING(50), allowNull: true },
        interests: { type: DataTypes.JSON, allowNull: true },
        message: { type: DataTypes.TEXT, allowNull: false },
        preferred_time: { type: DataTypes.STRING(50), allowNull: true },
        status: {
            type: DataTypes.ENUM('new', 'contacted', 'closed'),
            allowNull: false,
            defaultValue: 'new',
        },
    }, {
        tableName: 'client_sales_enquiries',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        indexes: [
            { fields: ['website_client_id', 'created_at'] },
            { fields: ['status', 'created_at'] },
        ],
    });

    return ClientSalesEnquiry;
};
