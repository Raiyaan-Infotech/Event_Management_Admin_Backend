const { DataTypes } = require('sequelize');

/**
 * Template categories — the taxonomy the invitation Templates module and the
 * Frame Styles module both classify against (Elegant, Floral, Minimal,
 * Traditional, Royal …).
 *
 * ── NOT ANY OF THE OTHER "CATEGORY" TABLES ───────────────────────────────────
 * `event_categories`  what KIND OF EVENT it is — Wedding, Birthday, Corporate.
 *                     A plan is scoped to one, and a client picks one.
 * `faq_categories`    website FAQ grouping. Different domain entirely.
 * `template_categories` (this)  the DESIGN family a template or frame belongs
 *                     to. It says nothing about the event; a Floral frame suits
 *                     a wedding and a birthday alike.
 *
 * Deliberately just `name` + `slug`. It exists to label and to group, and every
 * extra column on a lookup table is one more thing two screens can disagree
 * about. The slug is what a frame or template is addressed by in a URL or a
 * filter; the name is what a person reads.
 */
module.exports = (sequelize) => {
    const TemplateCategory = sequelize.define('TemplateCategory', {
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
         * Derived from the name when not supplied, and unique per company.
         *
         * Enforced in the service rather than by a UNIQUE index, for the same
         * reason `event_templates.code` is: rows here are soft-deleted, and a
         * unique index counts deleted rows — so one deleted "floral" would hold
         * that slug hostage forever.
         */
        slug: {
            type: DataTypes.STRING(150),
            allowNull: false,
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
            type: DataTypes.INTEGER,
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
        tableName: 'template_categories',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return TemplateCategory;
};
