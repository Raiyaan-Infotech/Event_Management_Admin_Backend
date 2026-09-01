const { DataTypes } = require('sequelize');

/**
 * One client's choice for ONE kind of notification on ONE channel.
 *
 * ── WHY A ROW PER TYPE AND NOT A COLUMN PER TYPE ────────────────────────────
 * A wide table reads more simply and needs a MIGRATION every time somebody adds
 * a notification. Keyed by `(website_client_id, channel, type)` a new type is a
 * row, and the only thing that changes is the catalogue in
 * `clientPreferences.service.js`. The unique index on those three columns is
 * what stops the same choice being stored twice and then disagreeing.
 *
 * ── `frequency` AND `sound` ARE NULLABLE ON PURPOSE ─────────────────────────
 * `frequency` belongs to email, `sound` to in-app. NULL says "this channel has
 * no such setting", which stays distinguishable from a real choice — a filler
 * default would make "the client picked instant" and "frequency means nothing
 * here" the same value.
 *
 * ⚠ NOTHING READS THESE TO SEND ANYTHING YET. There is no SMTP configured
 * (`email_configs` is empty) and this portal has no in-app feed. The rows are
 * CONSENT, recorded now so it is already right on the day delivery is wired.
 * That is a decision, not an oversight, and the screens say so.
 */
module.exports = (sequelize) => {
    const ClientNotificationPref = sequelize.define('ClientNotificationPref', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        website_client_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        /*
          'sms' is deliberately absent. The mobile OTP is written to the log with
          "NOT SENT — no SMS provider", so there is no SMS channel to have a
          preference about; an enum value nothing writes reads as one that exists.
        */
        channel: {
            type: DataTypes.ENUM('email', 'in_app'),
            allowNull: false,
        },
        /** Free text at the column level; the service's catalogue validates it. */
        type: {
            type: DataTypes.STRING(60),
            allowNull: false,
        },
        enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        /** Email only — 'instant', 'daily_digest', 'weekly_digest', '24h_before'. */
        frequency: {
            type: DataTypes.STRING(30),
            allowNull: true,
        },
        /** In-app only. */
        sound: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
    }, {
        tableName: 'client_notification_prefs',
        timestamps: true,
        paranoid: false,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { unique: true, fields: ['website_client_id', 'channel', 'type'] },
            { fields: ['website_client_id', 'channel', 'enabled'] },
        ],
    });

    return ClientNotificationPref;
};
