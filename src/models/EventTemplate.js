const { DataTypes } = require('sequelize');

/**
 * Invitation template catalogue — the super admin's Templates module.
 *
 * NOT the same thing as the Website Builder's `company_templates`, which is a
 * tenant's WEBSITE theme. This one is the design a client's event INVITATION is
 * rendered from, and is what `events.theme_id` will eventually point at in
 * place of the hardcoded `lib/event-themes.ts` catalogue (§207).
 *
 * Schema and the reasoning behind it: scratch/migrate_event_templates.js.
 *
 * Two pairs here look redundant and are not:
 *   `components` / `component_order` — WHETHER a component shows, and WHERE.
 *   `status` / `is_active`           — draft vs published, and active vs not.
 *
 * There are deliberately no pricing columns; "Template Pricing" was removed
 * from the form, so nothing stores or reads a price.
 */
module.exports = (sequelize) => {
    const EventTemplate = sequelize.define('EventTemplate', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },

        /* ── step 1  Basic Information ───────────────────────────────────── */
        name: {
            type: DataTypes.STRING(200),
            allowNull: false,
        },
        // Template code / slug (FWE-001). Unique per company, enforced in the
        // service — see the migration for why it is not a UNIQUE index.
        code: {
            type: DataTypes.STRING(120),
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
        religion_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        /**
         * Step 1's "Template Style".
         *
         * WAS a hardcoded enum. It is now a real row in `template_categories` —
         * which is also what a `frame_style` is filed under, so choosing a style
         * here is what lets step 2 offer the frames that suit it.
         */
        template_category_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        /**
         * The category's slug, kept in step with `template_category_id`.
         *
         * Not dropped and not stale: the service rewrites it whenever the
         * category changes. Anything already reading `style` — the client
         * portal, older rows, the list filter — keeps working unchanged.
         */
        style: {
            type: DataTypes.STRING(40),
            allowNull: false,
            defaultValue: 'classic',
        },
        tags: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        description: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },

        /* ── step 2  Design & Background ─────────────────────────────────── */
        layout_style: {
            type: DataTypes.STRING(40),
            allowNull: false,
            defaultValue: 'classic',
        },
        background_type: {
            type: DataTypes.ENUM('color', 'image', 'gradient', 'custom'),
            allowNull: false,
            defaultValue: 'color',
        },
        background_color: {
            type: DataTypes.STRING(9),
            allowNull: true,
        },
        secondary_color: {
            type: DataTypes.STRING(9),
            allowNull: true,
        },
        background_image: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        gradient_from: {
            type: DataTypes.STRING(9),
            allowNull: true,
        },
        gradient_to: {
            type: DataTypes.STRING(9),
            allowNull: true,
        },
        /** Linear or radial. Only read when background_type = 'gradient'. */
        gradient_type: {
            type: DataTypes.ENUM('linear', 'radial'),
            allowNull: false,
            defaultValue: 'linear',
        },
        /**
         * Which way a linear gradient runs.
         *
         * Defaults to 'bottom' because the preview has always drawn
         * `linear-gradient(160deg, …)` — near enough straight down. Any other
         * default would silently restyle every gradient template already saved.
         */
        gradient_direction: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'bottom',
        },
        /** Custom background only — how the uploaded design is masked. */
        image_shape: {
            type: DataTypes.ENUM('rectangle', 'square', 'circle', 'heart', 'arch'),
            allowNull: false,
            defaultValue: 'rectangle',
        },
        /** 0-100 percent. Custom background only, and only for rectangle/square. */
        corner_radius: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        /**
         * Superseded by the Custom tab's Upload Design + Image Shape controls.
         * Kept for rows that already hold CSS; nothing evaluates it.
         */
        custom_css: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        // 0-100. Darkens the background so the invitation text stays readable.
        overlay_opacity: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        orientation: {
            type: DataTypes.ENUM('portrait', 'landscape'),
            allowNull: false,
            defaultValue: 'portrait',
        },
        dimension: {
            type: DataTypes.STRING(60),
            allowNull: true,
        },
        primary_font: {
            type: DataTypes.STRING(80),
            allowNull: true,
        },
        secondary_font: {
            type: DataTypes.STRING(80),
            allowNull: true,
        },
        /**
         * The CSS fallback — ornate, corners, arch. Kept, and now only used when
         * no `frame_style_id` is chosen: a double border is better than nothing,
         * and it is what every row created before frame styles existed has.
         */
        border_style: {
            type: DataTypes.STRING(40),
            allowNull: true,
        },
        /** Step 2's Border / Frame Style — real uploaded artwork. */
        frame_style_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        /** Legacy string list (roses, gold-leaf…). Superseded by decoration_ids. */
        decorations: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        /** Step 2's Decorations — ids into `decorations`, in display order. */
        decoration_ids: {
            type: DataTypes.JSON,
            allowNull: true,
        },

        /* ── step 3  Content & Components ────────────────────────────────── */
        components: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        component_order: {
            type: DataTypes.JSON,
            allowNull: true,
        },

        /* ── step 4  Customization Permissions ───────────────────────────── */
        permissions: {
            type: DataTypes.JSON,
            allowNull: true,
        },

        /* ── step 5  Publishing & Availability ───────────────────────────── */
        status: {
            type: DataTypes.ENUM('draft', 'published'),
            allowNull: false,
            defaultValue: 'draft',
        },
        is_active: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
        },
        is_featured: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
        },
        available_for: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        plan_availability: {
            type: DataTypes.ENUM('all', 'selected', 'trial'),
            allowNull: false,
            defaultValue: 'all',
        },
        plan_ids: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        sort_order: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        show_on_homepage: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
        },
        thumbnail: {
            type: DataTypes.STRING(500),
            allowNull: true,
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
        tableName: 'event_templates',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    return EventTemplate;
};
