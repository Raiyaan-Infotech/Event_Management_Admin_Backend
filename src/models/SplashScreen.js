const { DataTypes } = require('sequelize');

/**
 * A saved splash / loading screen configuration — the mobile app's own screen
 * shown when a guest opens an event, not a web page.
 *
 * ── PER-EVENT, ONE EACH ─────────────────────────────────────────────────────
 * `event_id` is the real link, and it is UNIQUE: one event has at most one
 * splash, so the app's "which splash for this event?" read is a single
 * unambiguous lookup. `status` ('draft' | 'active') still decides whether
 * guests actually see it, so a client can build one without publishing it.
 *
 * `event_name` predates the link and stays — see the column's own comment.
 * Rows created before `event_id` existed keep `event_id = NULL`; their typed
 * names match no real event, so they were left unlinked rather than guessed
 * into one. See `apply-splash-screen-event-link.js` for the full reasoning.
 *
 * ── background_config / loader_config ──────────────────────────────────────
 * `background_type` picks ONE of six shapes; `background_config` holds
 * whichever shape applies (overlay %, video start/volume, gradient
 * colors/direction, logo size/position, photo fit, solid colour hex). The
 * loader is an independent add-on layered on ANY background type, which is
 * why it gets its own JSON blob.
 *
 * ── Drawn from the invitation card ─────────────────────────────────────────
 * `theme_id` (template code), the three colours, `components` and
 * `component_order` mirror the invitation design. The organizer / contact
 * sections default OFF — the app applies that when `components` is empty.
 * The legacy sound / animation / button / show_* columns were dropped.
 */
module.exports = (sequelize) => {
    const SplashScreen = sequelize.define('SplashScreen', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        company_id: { type: DataTypes.INTEGER, allowNull: true },

        /** Internal label — identifies one saved splash among several. */
        name: { type: DataTypes.STRING(150), allowNull: false },

        main_title: { type: DataTypes.STRING(60), allowNull: false },
        sub_title: { type: DataTypes.STRING(20), allowNull: true },
        /**
         * The display name shown on the splash. Kept as its own column even
         * though `event_id` now exists: the service copies it from the chosen
         * event on save, and the rows created before the link existed have
         * nothing else to show.
         */
        event_name: { type: DataTypes.STRING(100), allowNull: false },

        /**
         * The event this splash belongs to — UNIQUE, so one event has at most
         * one splash and the app's lookup needs no tie-breaking rule.
         *
         * NULL-able for the rows saved before the link existed; the portal form
         * requires it from now on. MySQL allows many NULLs under a UNIQUE
         * index, which is what lets those rows stay as unlinked drafts.
         *
         * `ON DELETE SET NULL` in the migration, not CASCADE: deleting an event
         * should not take a design the client built with it.
         */
        event_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        tagline: { type: DataTypes.STRING(150), allowNull: true },

        background_type: {
            type: DataTypes.ENUM('image', 'video', 'solid_color', 'gradient', 'logo', 'couple_photo'),
            allowNull: false,
            defaultValue: 'image',
        },
        background_url: { type: DataTypes.STRING(500), allowNull: true },
        background_config: { type: DataTypes.JSON, allowNull: true },

        loader_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        loader_config: { type: DataTypes.JSON, allowNull: true },

        theme_id: { type: DataTypes.STRING(50), allowNull: true },
        primary_color: { type: DataTypes.STRING(9), allowNull: true },
        secondary_color: { type: DataTypes.STRING(9), allowNull: true },
        bg_color: { type: DataTypes.STRING(9), allowNull: true },
        decoration_url: { type: DataTypes.STRING(500), allowNull: true },
        show_decoration: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        components: { type: DataTypes.JSON, allowNull: true },
        component_order: { type: DataTypes.JSON, allowNull: true },

        /** Save as Draft vs Save & Continue. */
        status: {
            type: DataTypes.ENUM('draft', 'active'),
            allowNull: false,
            defaultValue: 'draft',
        },
    }, {
        tableName: 'splash_screens',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
        indexes: [
            { fields: ['website_client_id', 'deleted_at'], name: 'splash_screens_client' },
        ],
    });

    return SplashScreen;
};
