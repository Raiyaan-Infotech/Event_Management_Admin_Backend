const { DataTypes } = require('sequelize');

/**
 * One client's own settings for how the portal looks and behaves.
 *
 * Exactly one row per client, enforced by a unique index rather than by the
 * service remembering to check. `ensurePreferences` upserts, so a client who
 * has never opened Settings still reads consistent defaults.
 *
 * ── WHAT IS STORED VS WHAT IS APPLIED ───────────────────────────────────────
 * ⚠ Not every column here changes anything yet. `theme` does (next-themes is
 * wired in the portal); `items_per_page`, `compact_mode`, `auto_save` and
 * `show_tips` are recorded and not yet read by the screens they describe.
 * The service reports which is which in an `applied` map, so the UI marks them
 * from DATA instead of from strings typed into a component — the §316 rule.
 * Nobody has to remember which file to revisit when one gets wired.
 *
 * ── NO `deleted_at` ─────────────────────────────────────────────────────────
 * A preference is current state, not history. There is nothing to restore and
 * nothing a soft delete would protect; the row goes when the client row is
 * hard-deleted, via the FK cascade.
 */
module.exports = (sequelize) => {
    const ClientPreference = sequelize.define('ClientPreference', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
        },

        /*
          A code, not an FK. The `languages` table belongs to the ADMIN panel and
          holds exactly one row (English), so constraining a client's own choice
          against it would couple this to a table they have no relationship with
          — and would make adding a language an admin-panel migration.
        */
        language_code: {
            type: DataTypes.STRING(10),
            allowNull: false,
            defaultValue: 'en',
        },
        date_format: {
            type: DataTypes.STRING(20),
            allowNull: false,
            defaultValue: 'DD/MM/YYYY',
        },
        time_zone: {
            type: DataTypes.STRING(64),
            allowNull: false,
            defaultValue: 'Asia/Kolkata',
        },

        theme: {
            type: DataTypes.ENUM('light', 'dark', 'system'),
            allowNull: false,
            defaultValue: 'system',
        },
        /** Where "go to my dashboard" lands. Validated against real routes. */
        default_landing: {
            type: DataTypes.STRING(40),
            allowNull: false,
            defaultValue: 'dashboard',
        },
        items_per_page: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
            defaultValue: 20,
        },
        compact_mode: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        auto_save: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        show_tips: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },

        /*
          Master switches. They OVERRIDE every notification row of their channel
          rather than being one more row in it — kept here so nothing can read
          "all of them off" as just another type that happens to be off.
        */
        emails_disabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        in_app_disabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },

        /*
          Do Not Disturb as a WINDOW, not a boolean plus a duration.

          A boolean has to be switched back off by something, and the only thing
          that could is a scheduled job — which §314 established does not fire
          reliably here (Render sleeps a free instance). Two timestamps answer
          "is it quiet right now?" by comparing against the clock, so the window
          expires correctly whether or not anything is running to expire it.
        */
        dnd_starts_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        dnd_ends_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'client_preferences',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { unique: true, fields: ['website_client_id'] },
        ],
    });

    return ClientPreference;
};
