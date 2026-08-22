const { DataTypes } = require('sequelize');

/**
 * Frame / border styles — the artwork that frames an invitation.
 *
 * The uploaded file IS the design. Everything else on the row is how it gets
 * found: a name to read, a category to filter by, and which page shapes it was
 * drawn to fit.
 *
 * ── WHY THE FILE AND NOT A STYLE NAME ────────────────────────────────────────
 * `event_templates.border_style` is an enum — ornate, corners, arch — that maps
 * to a CSS border class. A double line is not an ornate frame, and no adjective
 * is ever going to be a toran or a mandala corner. This table holds the real
 * thing, so a frame is uploaded once and reused across templates.
 *
 * ── `status` AND `is_active` ARE TWO DIFFERENT QUESTIONS ─────────────────────
 * Same pair as `event_templates`, for the same reason:
 *   status     draft | published    the form's "Save as Draft" vs "Upload Style"
 *   is_active  0 | 1                the form's Status toggle
 * A published frame can be switched off without becoming a draft again, and a
 * draft is not offered whatever `is_active` says.
 */
module.exports = (sequelize) => {
    const FrameStyle = sequelize.define('FrameStyle', {
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
         * The design family — Elegant, Floral, Minimal, Traditional.
         *
         * The FK is ON DELETE SET NULL so a hard delete can never take somebody's
         * uploaded artwork with it. In practice that clause rarely fires:
         * TemplateCategory is paranoid, so deleting a category is an UPDATE, and
         * this column KEEPS its value.
         *
         * That is deliberate and better than blanking it. The `category` include
         * reads through the default scope, so a soft-deleted category joins as
         * null and the row shows as uncategorised — while restoring the category
         * silently puts every frame back where it was. Nulling the column on
         * delete would make that restore lossy.
         */
        template_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        /** The uploaded SVG / PNG / JPG. This is the frame itself. */
        file_url: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        /** Original filename, so the edit screen can show what was uploaded. */
        file_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        /**
         * Which page shapes this frame was drawn for: portrait, landscape,
         * square. A frame with ornate corners sized for 9:16 does not survive
         * being stretched to 16:9, so this is a real constraint and not a label.
         *
         * Normalised to a subset of LAYOUTS on write — a JSON column accepts
         * anything, and the list column renders whatever is in here.
         */
        supported_layouts: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('draft', 'published'),
            allowNull: false,
            defaultValue: 'published',
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
        tableName: 'frame_styles',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return FrameStyle;
};
