const { DataTypes } = require('sequelize');

/**
 * Decorations — uploaded ornament images used inside invitation templates:
 * floral corners, dividers, hanging ornaments, top borders.
 *
 * ── HOW THIS DIFFERS FROM A FRAME STYLE ──────────────────────────────────────
 * A `frame_style` is ONE piece of artwork that surrounds the whole invitation —
 * it occupies the full rectangle and there is exactly one of them. A decoration
 * is a PART, placed somewhere specific, and a template can carry several.
 *
 * That is why `type` here is a placement (corner / divider / top) and not a
 * design family. `template_categories` answers "what does it look like";
 * `decorations.type` answers "where does it go". Filing decorations under
 * Classic/Royal/Minimal would leave nothing saying where to draw them.
 *
 * ── format AND file_size ARE STORED, NOT DERIVED ─────────────────────────────
 * The list shows both on every row. Deriving them would mean a HEAD request per
 * row per page load against CloudFront; they are written once at upload from
 * what `media.service` actually stored — which is the post-compression size, not
 * the size of the file the browser picked.
 */
module.exports = (sequelize) => {
    const Decoration = sequelize.define('Decoration', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(150),
            allowNull: false,
        },
        /** Where the decoration is placed. See the note above. */
        type: {
            type: DataTypes.ENUM('corner', 'divider', 'ornament', 'top', 'bottom', 'motif'),
            allowNull: false,
            defaultValue: 'corner',
        },
        /** The uploaded PNG / JPG / WEBP / SVG. This is the decoration itself. */
        file_url: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        /** Original filename, shown on the edit screen. */
        file_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        /** Upper-case extension for the list's Format column — PNG, SVG, JPG, WEBP. */
        file_format: {
            type: DataTypes.STRING(10),
            allowNull: true,
        },
        /** Bytes, as stored. Rendered as "245 KB" by the list. */
        file_size: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
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
        tableName: 'decorations',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return Decoration;
};
