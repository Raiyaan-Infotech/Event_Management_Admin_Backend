const {
    Sequelize,
    sequelize,
    Event,
    EventGuest,
    EventMessage,
    EventCategory,
} = require('../models');
const { Op } = Sequelize;

/**
 * The Analytics screen, in one response.
 *
 * Every figure the design shows is computed here from `events`, `event_guests`
 * and `event_messages` — the guest and message tables were added specifically
 * so this screen could read real numbers instead of invented ones.
 *
 * ── THE RATES, AND WHAT EACH IS DIVIDED BY ───────────────────────────────────
 * Getting the denominator wrong is the easy way to ship a plausible-looking lie,
 * so each is named here and used nowhere else:
 *
 *   Open rate      opened / DELIVERED    not / sent. A message that bounced was
 *                                        never openable; counting it as a missed
 *                                        open punishes the sender for the bounce.
 *   Click rate     clicked / DELIVERED   same reasoning.
 *   Response rate  responded / INVITED   a guest never invited cannot respond.
 *   RSVP rate      attending / INVITED   "how many said yes", per event.
 *
 * SMS has no open or click tracking — there is no pixel and no link wrapper —
 * so those come back NULL rather than 0. The design prints an em dash there,
 * and 0% would read as "nobody opened it" instead of "we cannot know".
 *
 * ── PERIOD COMPARISON ────────────────────────────────────────────────────────
 * Every tile's delta compares the selected window against the window of equal
 * length immediately before it. A previous period of zero gives NULL, not
 * "infinity percent" and not 100%.
 */

/** Percentage to one decimal, or null when the denominator is zero. */
const rate = (numerator, denominator) =>
    denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;

/** Change between two periods, as a percentage. Null when there is no baseline. */
const delta = (current, previous) =>
    previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayKey = (d) =>
    [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

const CHANNELS = ['whatsapp', 'email', 'sms'];
const SOURCES = ['whatsapp', 'email', 'sms', 'manual', 'import'];

/**
 * The design's four donut slices, mapped from the stored status.
 *
 * `rsvp_status` is a five-value lifecycle now (not_responded → invited →
 * pending → accepted | declined) and the donut has four slices, so the mapping
 * is explicit rather than assumed. `invited` sits with "No Response": the
 * invitation went out and nothing came back, which is exactly what that slice
 * means to the person reading it.
 */
const RSVP_SLICES = ['attending', 'not_attending', 'maybe', 'no_response'];

const sliceFor = (status) => {
    if (status === 'accepted') return 'attending';
    if (status === 'declined') return 'not_attending';
    if (status === 'pending') return 'maybe';
    return 'no_response'; // not_responded, invited
};

/** Channels that can report an open or a click at all. */
const TRACKABLE = new Set(['whatsapp', 'email']);

const getAnalytics = async (clientId, query = {}) => {
    const days = Math.min(365, Math.max(7, Number(query.days) || 31));

    const now = new Date();
    const periodStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
    const previousStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days * 2 - 1)));

    // Three queries, not thirty. Each pulls only the columns the aggregation
    // needs, and the grouping happens in JS — at ~374ms per round trip to
    // production (§103), a GROUP BY per card would make the page crawl.
    const [events, guests, messages] = await Promise.all([
        Event.findAll({
            where: { website_client_id: clientId },
            attributes: ['id', 'name', 'status', 'start_date', 'end_date', 'theme_id', 'created_at'],
            include: [{ model: EventCategory, as: 'category', attributes: ['id', 'name'], required: false }],
        }),
        EventGuest.findAll({
            where: { website_client_id: clientId },
            attributes: [
                'id', 'event_id', 'party_size', 'rsvp_status', 'response_type',
                'invite_source', 'invited_at', 'responded_at', 'created_at',
            ],
        }),
        EventMessage.findAll({
            where: { website_client_id: clientId },
            attributes: [
                'id', 'event_id', 'channel', 'status',
                'sent_at', 'delivered_at', 'opened_at', 'clicked_at',
            ],
        }),
    ]);

    // ── Headline tiles ──────────────────────────────────────────────────────
    const inPeriod = (value, from) => {
        if (!value) return false;
        const at = new Date(value);
        return at >= from && (from !== previousStart || at < periodStart);
    };

    let totalGuests = 0;
    let invited = 0;
    let responded = 0;
    let guestsThis = 0;
    let guestsPrev = 0;
    let invitedThis = 0;
    let invitedPrev = 0;
    let respondedThis = 0;
    let respondedPrev = 0;

    const rsvpCounts = Object.fromEntries(RSVP_SLICES.map((s) => [s, 0]));
    const sourceCounts = Object.fromEntries(SOURCES.map((s) => [s, 0]));
    const perEvent = new Map();

    for (const guest of guests) {
        // party_size, not a headcount of rows: one invitation covering a family
        // of four is four people at the venue.
        const heads = Number(guest.party_size) || 1;
        totalGuests += heads;

        rsvpCounts[sliceFor(guest.rsvp_status)] += 1;
        sourceCounts[guest.invite_source] = (sourceCounts[guest.invite_source] || 0) + 1;

        // Anything past not_responded implies the invitation went out, even if
        // invited_at was never stamped (an imported row with a status set).
        if (guest.invited_at || guest.rsvp_status !== 'not_responded') invited += 1;
        if (guest.responded_at) responded += 1;

        if (inPeriod(guest.created_at, periodStart)) guestsThis += heads;
        else if (inPeriod(guest.created_at, previousStart)) guestsPrev += heads;
        if (inPeriod(guest.invited_at, periodStart)) invitedThis += 1;
        else if (inPeriod(guest.invited_at, previousStart)) invitedPrev += 1;
        if (inPeriod(guest.responded_at, periodStart)) respondedThis += 1;
        else if (inPeriod(guest.responded_at, previousStart)) respondedPrev += 1;

        const bucket = perEvent.get(guest.event_id) || { guests: 0, invited: 0, attending: 0, responded: 0 };
        bucket.guests += heads;
        if (guest.invited_at || guest.rsvp_status !== 'not_responded') bucket.invited += 1;
        if (guest.rsvp_status === 'accepted') bucket.attending += 1;
        if (guest.responded_at) bucket.responded += 1;
        perEvent.set(guest.event_id, bucket);
    }

    // ── Messages ────────────────────────────────────────────────────────────
    const byChannel = Object.fromEntries(
        CHANNELS.map((c) => [c, { sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 }])
    );
    let sent = 0;
    let delivered = 0;
    let opened = 0;
    let clicked = 0;
    let sentThis = 0;
    let sentPrev = 0;
    let openedThis = 0;
    let openedPrev = 0;
    let deliveredThis = 0;
    let deliveredPrev = 0;
    let clickedThis = 0;
    let clickedPrev = 0;

    for (const message of messages) {
        const channel = byChannel[message.channel];
        if (!channel) continue;

        // 'queued' has not gone anywhere yet and must not count as sent.
        if (message.status === 'queued') continue;

        sent += 1;
        channel.sent += 1;
        if (message.status === 'failed') channel.failed += 1;
        if (message.delivered_at) { delivered += 1; channel.delivered += 1; }
        if (message.opened_at) { opened += 1; channel.opened += 1; }
        if (message.clicked_at) { clicked += 1; channel.clicked += 1; }

        if (inPeriod(message.sent_at, periodStart)) sentThis += 1;
        else if (inPeriod(message.sent_at, previousStart)) sentPrev += 1;
        if (inPeriod(message.delivered_at, periodStart)) deliveredThis += 1;
        else if (inPeriod(message.delivered_at, previousStart)) deliveredPrev += 1;
        if (inPeriod(message.opened_at, periodStart)) openedThis += 1;
        else if (inPeriod(message.opened_at, previousStart)) openedPrev += 1;
        if (inPeriod(message.clicked_at, periodStart)) clickedThis += 1;
        else if (inPeriod(message.clicked_at, previousStart)) clickedPrev += 1;
    }

    // ── RSVP trend: a DENSE day axis ────────────────────────────────────────
    // Built from the calendar, not from the rows. Deriving it from the data
    // drops quiet days and draws a line that jumps 3 May to 9 May as though
    // they were adjacent.
    const trend = [];
    const trendByKey = new Map();
    for (let i = days - 1; i >= 0; i -= 1) {
        const d = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
        const row = {
            key: dayKey(d),
            label: `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`,
            attending: 0, not_attending: 0, maybe: 0, no_response: 0,
        };
        trend.push(row);
        trendByKey.set(row.key, row);
    }
    for (const guest of guests) {
        if (!guest.responded_at) continue;
        const row = trendByKey.get(dayKey(new Date(guest.responded_at)));
        if (row) row[sliceFor(guest.rsvp_status)] += 1;
    }
    // No-response is a standing backlog rather than something that happens on a
    // day, so it is carried as the count of invited-but-silent guests, flat
    // across the axis. Charting it per-day would draw a permanently zero line.
    const stillSilent = guests.filter(
        (g) => (g.invited_at || g.rsvp_status === 'invited') && !g.responded_at
    ).length;
    for (const row of trend) row.no_response = stillSilent;

    // ── Top performing events ───────────────────────────────────────────────
    const eventById = new Map(events.map((e) => [e.id, e]));
    const topEvents = [...perEvent.entries()]
        .map(([eventId, bucket]) => {
            const event = eventById.get(eventId);
            return {
                id: eventId,
                name: event?.name ?? `Event #${eventId}`,
                start_date: event?.start_date ?? null,
                theme_id: event?.theme_id ?? null,
                category: event?.category?.name ?? null,
                guests: bucket.guests,
                rsvp_rate: rate(bucket.attending, bucket.invited),
                response_rate: rate(bucket.responded, bucket.invited),
            };
        })
        .sort((a, b) => b.guests - a.guests)
        .slice(0, 5);

    const totalRsvps = guests.length;

    return {
        period: { days, from: dayKey(periodStart), to: dayKey(startOfDay(now)) },

        // The six headline tiles, each with the delta the design shows.
        totals: {
            total_guests: totalGuests,
            total_rsvps: totalRsvps,
            messages_sent: sent,
            open_rate: rate(opened, delivered),
            response_rate: rate(responded, invited),
            click_rate: rate(clicked, delivered),
        },
        deltas: {
            total_guests: delta(guestsThis, guestsPrev),
            total_rsvps: delta(respondedThis, respondedPrev),
            messages_sent: delta(sentThis, sentPrev),
            open_rate: delta(rate(openedThis, deliveredThis) ?? 0, rate(openedPrev, deliveredPrev) ?? 0),
            response_rate: delta(rate(respondedThis, invitedThis) ?? 0, rate(respondedPrev, invitedPrev) ?? 0),
            click_rate: delta(rate(clickedThis, deliveredThis) ?? 0, rate(clickedPrev, deliveredPrev) ?? 0),
        },

        rsvp_breakdown: RSVP_SLICES.map((key) => ({
            key,
            count: rsvpCounts[key],
            percent: rate(rsvpCounts[key], totalRsvps) ?? 0,
        })),
        rsvp_trend: trend,

        messages_by_channel: CHANNELS.map((key) => ({
            key,
            sent: byChannel[key].sent,
            delivered: byChannel[key].delivered,
            failed: byChannel[key].failed,
            percent: rate(byChannel[key].sent, sent) ?? 0,
            delivery_rate: rate(byChannel[key].delivered, byChannel[key].sent),
            // NULL, not 0 — SMS carries no pixel and no link wrapper, so an open
            // is unknowable rather than absent. The UI prints an em dash.
            open_rate: TRACKABLE.has(key) ? rate(byChannel[key].opened, byChannel[key].delivered) : null,
            click_rate: TRACKABLE.has(key) ? rate(byChannel[key].clicked, byChannel[key].delivered) : null,
        })),

        engagement_by_source: SOURCES.map((key) => ({
            key,
            count: sourceCounts[key],
            percent: rate(sourceCounts[key], totalRsvps) ?? 0,
        })),

        top_events: topEvents,

        // Kept from the event-only version — the screen still shows event counts.
        event_totals: {
            total_events: events.length,
            live_events: 0, // filled by the caller, which owns deriveStatus
        },
    };
};

module.exports = { getAnalytics, rate, delta };
