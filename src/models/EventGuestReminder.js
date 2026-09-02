const { DataTypes } = require('sequelize');

/**
 * A thing the host means to do about a guest, by a date.
 *
 * ⚠ NOTHING FIRES THESE. There is no job runner and no SMTP in this system, so
 * a reminder is a list the host reads — not a notification anybody receives.
 * Do not add a `sent_at` or a `notified` flag until something can actually
 * send, because a column named that would be read as a promise that it did.
 *
 * ⚠ `status` DOES NOT STORE "upcoming" OR "overdue". The design's badge says
 * "Upcoming", but that is a fact about `due_at` versus now: stored, it becomes
 * a lie the moment the date passes and nothing corrects it. Only the three
 * states a PERSON sets are stored; the badge is derived — see `derive()`.
 */
module.exports = (sequelize) => {
    const EventGuestReminder = sequelize.define('EventGuestReminder', {
        id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
        website_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        guest_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        /** Optional: Add Reminder sits on the guest, not inside a note. */
        note_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },

        title: { type: DataTypes.STRING(150), allowNull: false },
        due_at: { type: DataTypes.DATE, allowNull: false },

        status: {
            type: DataTypes.ENUM('pending', 'done', 'dismissed'),
            allowNull: false,
            defaultValue: 'pending',
        },
        completed_at: { type: DataTypes.DATE, allowNull: true },
        created_by_client_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    }, {
        tableName: 'event_guest_reminders',
        timestamps: true,
        paranoid: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        deletedAt: 'deleted_at',
    });

    /**
     * The badge the screen shows.
     *
     * Computed at read time from `due_at`, so it is correct on every read and
     * cannot go stale between them. `done` and `dismissed` outrank the clock —
     * a finished task is not overdue.
     */
    EventGuestReminder.derive = (row, now = new Date()) => {
        if (row.status === 'done') return 'done';
        if (row.status === 'dismissed') return 'dismissed';
        return new Date(row.due_at) < now ? 'overdue' : 'upcoming';
    };

    return EventGuestReminder;
};
