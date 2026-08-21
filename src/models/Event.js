const { DataTypes } = require('sequelize');

/**
 * An event created by a signed-in website client in the client portal.
 *
 * The columns are exactly what the six-step Create Event wizard collects, plus
 * the ownership triple the QR payload encrypts and the three QR columns.
 *
 * > `status` holds only the three values the form offers. **"Past" is derived,
 * > never stored** — an event whose `end_date` has gone by is past on its own,
 * > with no cron job flipping rows and no window where the DB disagrees with
 * > the calendar. `deriveStatus()` in clientEvent.service.js is the one place
 * > that decision is made.
 *
 * > `menu_ids` is a JSON array of `event_menus` ids rather than a join table:
 * > the wizard toggles each menu on or off and hangs nothing else off it.
 * > `subscription_plan_menus` needed a real table because it carries
 * > per-platform flags and per-menu limits; this does not.
 */
module.exports = (sequelize) => {
    const Event = sequelize.define(
        'Event',
        {
            id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },

            // ── Ownership. These three go into the QR payload. ──────────────
            website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
            // INT UNSIGNED to match vendors.id exactly, as on WebsiteClient.
            vendor_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
            company_id: { type: DataTypes.INTEGER, allowNull: true },

            /**
             * The plan in force at creation, copied from the client rather than
             * read through them. Moving a client to another plan later must not
             * rewrite what an existing event was created under.
             */
            subscription_plan_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

            // ── Step 1 — taxonomy, already plan-narrowed by the API ─────────
            event_category_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
            event_type_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
            religion_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

            // ── Step 2 — details and schedule ───────────────────────────────
            name: { type: DataTypes.STRING(200), allowNull: false },
            tagline: { type: DataTypes.STRING(150), allowNull: true },
            description: { type: DataTypes.TEXT, allowNull: true },
            // DATEONLY, not DATE: a wedding is on a day, and a DATETIME would
            // drag the server's timezone into a value the form never gave one for.
            start_date: { type: DataTypes.DATEONLY, allowNull: true },
            end_date: { type: DataTypes.DATEONLY, allowNull: true },
            start_time: { type: DataTypes.TIME, allowNull: true },
            end_time: { type: DataTypes.TIME, allowNull: true },
            timezone: { type: DataTypes.STRING(80), allowNull: true },

            // Not collected by the wizard yet. The dashboard card already has a
            // venue line, so the column exists for it to read; the card hides
            // the line while this is null rather than printing a dash.
            venue_name: { type: DataTypes.STRING(255), allowNull: true },
            venue_address: { type: DataTypes.STRING(500), allowNull: true },

            privacy: {
                type: DataTypes.ENUM('private', 'public', 'unlisted'),
                allowNull: false,
                defaultValue: 'private',
            },
            status: {
                type: DataTypes.ENUM('draft', 'upcoming', 'cancelled'),
                allowNull: false,
                defaultValue: 'upcoming',
            },

            // ── Step 3 — the menus toggled on ───────────────────────────────
            menu_ids: { type: DataTypes.JSON, allowNull: true },

            // ── Step 4 — design ─────────────────────────────────────────────
            theme_id: { type: DataTypes.STRING(64), allowNull: true },
            primary_color: { type: DataTypes.STRING(9), allowNull: true },

            /**
             * The encrypted QR payload — see utils/eventQr.js.
             *
             * This IS what the QR image encodes, character for character. It is
             * stored rather than recomputed on read so that a code already
             * printed keeps resolving: re-encrypting would produce a different
             * ciphertext every time (fresh IV) and re-issue on every page load.
             */
            qr_token: { type: DataTypes.TEXT, allowNull: true },
            qr_version: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 1 },
            qr_issued_at: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: 'events',
            timestamps: true,
            paranoid: true,
            // Explicit snake_case attribute names — `underscored: true` maps the
            // COLUMN but leaves the JS attribute as `createdAt`, so the API
            // would answer `createdAt` while the rest of the app reads
            // `created_at`. Same reasoning as every other model here.
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            deletedAt: 'deleted_at',
        }
    );

    return Event;
};
