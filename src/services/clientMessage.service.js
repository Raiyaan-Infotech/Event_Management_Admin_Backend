const {
    Sequelize, sequelize,
    Event, EventGuest, EventGuestGroup,
    EventMessage, EventMessageCampaign,
} = require('../models');
const { Op, fn, col, literal } = Sequelize;
const ApiError = require('../utils/apiError');
const notifications = require('./clientNotification.service');

/**
 * Guest messaging — compose a message, send it to an audience, keep the record.
 *
 * ── CHANNELS: WHATSAPP AND EMAIL ────────────────────────────────────────────
 * SMS is not offered. The enum on both tables still permits it so a historical
 * row can name itself, but it is absent from `VALID_CHANNELS`, which is the
 * only list the composer offers and the send accepts.
 *
 * ── ⚠ NOTHING IS ACTUALLY DELIVERED YET ─────────────────────────────────────
 * There is no WhatsApp Business account and no SMTP in this backend. A send
 * writes the campaign and one `event_messages` row per
 * recipient and stops there — exactly what the vendor newsletter does, and for
 * the same reason: a stub that pretended to deliver would put "Delivered 98.6%"
 * on a dashboard for messages nobody received.
 *
 * `CHANNEL_STATE` reports that per channel, with the reason, and every payload
 * carries it so the screens describe the real state rather than each hardcoding
 * an assumption. The day a provider is configured, `deliver()` is the one
 * function that changes.
 *
 * ── WHY DELIVERIES ARE WRITTEN AS 'queued' AND NOT 'sent' ───────────────────
 * `EventMessage.status` already distinguishes them, and the distinction is the
 * whole point: 'sent' means it left this system. Nothing has left. Writing
 * 'sent' would make every delivery rate on the analytics screen a lie that is
 * expensive to unpick later, because the rows would be indistinguishable from
 * real ones once a provider IS connected.
 *
 * ── MERGE FIELDS ARE NOT SUBSTITUTED INTO THE STORED BODY ───────────────────
 * The campaign keeps the body with `{first_name}` intact. Rendering per guest
 * and storing that would be one copy of the message per recipient, and would
 * make the campaign un-resendable to a different audience. Substitution happens
 * at preview time and would happen at delivery time.
 */

/* ── What can actually be sent ───────────────────────────────────────────── */

/**
 * Whether a channel can really deliver.
 *
 * Read from the environment, so connecting a provider is a deploy setting and
 * not a code edit — the same shape `gatewayState()` uses for payments. An empty
 * string must not read as configured.
 */
const CHANNELS = [
    { channel: 'whatsapp', label: 'WhatsApp', keys: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'] },
    { channel: 'email', label: 'Email', keys: ['SMTP_HOST', 'SENDGRID_API_KEY'] },
];

const channelState = () => CHANNELS.map(({ channel, label, keys }) => {
    // Any one of the recognised keys is enough — a project uses Twilio OR a
    // local gateway, not both.
    const configured = keys.some((k) => (process.env[k] || '').trim());
    return {
        channel,
        label,
        enabled: configured,
        reason: configured
            ? null
            : `${label} is not connected yet. Your message is saved and recorded, but it will not `
              + 'be delivered until a provider is configured.',
    };
});

/**
 * ⚠ SMS is deliberately NOT offered.
 *
 * It is still in the `channel` ENUM on both tables, and still has a label here,
 * so a historical row can name itself — dropping the enum value would rewrite
 * rows rather than stop new ones. It is simply not in `VALID_CHANNELS`, which
 * is the list the composer offers and the send accepts, so nothing new can be
 * created on it.
 */
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };
const VALID_CHANNELS = ['whatsapp', 'email'];
const VALID_KINDS = ['invite', 'reminder', 'update', 'thank_you', 'custom'];

/* ── Merge fields ────────────────────────────────────────────────────────── */

/**
 * The tokens the composer offers.
 *
 * Served by the API rather than listed in the frontend, so the picker cannot
 * offer a field the renderer does not know — which is how a message goes out
 * with a literal "{table_no}" in it.
 */
const MERGE_FIELDS = [
    { token: 'first_name', label: 'Guest first name', example: 'Arjun' },
    { token: 'last_name', label: 'Guest last name', example: 'Sharma' },
    { token: 'full_name', label: 'Guest full name', example: 'Arjun Sharma' },
    { token: 'event_name', label: 'Event name', example: 'Our Special Wedding' },
    { token: 'event_date', label: 'Event date', example: '24 May 2025' },
    { token: 'event_time', label: 'Event time', example: '06:00 PM' },
    { token: 'venue_name', label: 'Venue', example: 'The Grand Palace' },
    { token: 'venue_address', label: 'Venue address', example: 'Delhi' },
    { token: 'host_name', label: 'Host name', example: 'Rohan Mehta' },
    { token: 'table_number', label: 'Table number', example: '12' },
    { token: 'rsvp_link', label: 'RSVP link', example: 'https://…/rsvp/…' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date from its PARTS.
 *
 * Never `new Date(value)` on a bare DATEONLY — that parses as UTC and renders
 * the previous day for anyone behind it, which on an invitation is the wrong
 * date for the wedding.
 */
const fmtDate = (value) => {
    if (!value) return '';
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

/** "18:00:00" -> "06:00 PM". */
const fmtTime = (value) => {
    if (!value) return '';
    const m = String(value).match(/^(\d{2}):(\d{2})/);
    if (!m) return '';
    const h = Number(m[1]);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2, '0')}:${m[2]} ${suffix}`;
};

/**
 * Substitute the tokens for one guest.
 *
 * ⚠ Accepts BOTH `{token}` and `{{token}}`. The supplied designs use one in the
 * WhatsApp composer and the other in the email one; a client who copies a body
 * between the two must not get a literal brace in their invitation.
 *
 * An UNKNOWN token is left exactly as typed rather than blanked. A stray
 * `{note}` reaching a guest is a visible mistake somebody fixes; silently
 * deleting it produces a sentence with a hole in it that reads as finished.
 */
function render(text, { guest, event, hostName }) {
    if (!text) return '';
    const values = {
        first_name: guest?.first_name || (guest?.name || '').split(' ')[0] || '',
        last_name: guest?.last_name || (guest?.name || '').split(' ').slice(1).join(' ') || '',
        full_name: guest?.name || '',
        table_number: guest?.table_number || '',
        event_name: event?.name || '',
        event_date: fmtDate(event?.start_date),
        event_time: fmtTime(event?.start_time),
        venue_name: event?.venue_name || '',
        venue_address: event?.venue_address || '',
        host_name: hostName || event?.host_one || '',
        rsvp_link: event?.id ? `/rsvp/${event.id}` : '',
    };
    return String(text).replace(/\{\{?\s*([a-z_]+)\s*\}?\}/gi, (whole, token) => {
        const key = token.toLowerCase();
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole;
    });
}

/* ── Audience ────────────────────────────────────────────────────────────── */

/**
 * Who a send actually reaches.
 *
 * ⚠ Filters to guests who have the ADDRESS this channel needs. A WhatsApp send
 * to a guest with no number is not a send; counting them would make the
 * recipient total on the review step a number the send cannot honour, and every
 * delivery rate afterwards would be measured against it.
 *
 * The unreachable ones are returned rather than dropped silently, so the screen
 * can say "12 guests have no email address" before anybody presses Send.
 */
const reachable = (guest, channel) => {
    if (channel === 'email') return Boolean(guest.email);
    // Kept for any historical row, even though SMS can no longer be chosen.
    if (channel === 'sms') return Boolean(guest.mobile);
    // WhatsApp falls back to the mobile: most guests have one number, and
    // `whatsapp` is stored separately only for the minority where it differs.
    return Boolean(guest.whatsapp || guest.mobile);
};

/**
 * Who a send reaches, and — just as important — who it does not, and why.
 *
 * ⚠ Every step is returned separately because the recipient count is ALWAYS
 * smaller than the guest list, and a person looking at "29" against a Guests
 * screen reading "61" has no way to tell a filter from a bug. The three gaps
 * are: heads vs rows, declined guests, and guests with no address for this
 * channel. Naming them is the difference between a number and an explanation.
 */
async function resolveAudience(clientId, { eventId, audience, groupIds, guestIds, channel, excludeUnsubscribed }) {
    const where = {
        website_client_id: clientId,
        event_id: eventId,
    };

    if (audience === 'groups') {
        const ids = (groupIds || []).map(Number).filter(Number.isInteger);
        if (!ids.length) throw ApiError.badRequest('Choose at least one group.');
        where.group_id = { [Op.in]: ids };
    } else if (audience === 'guests') {
        const ids = (guestIds || []).map(Number).filter(Number.isInteger);
        if (!ids.length) throw ApiError.badRequest('Choose at least one guest.');
        where.id = { [Op.in]: ids };
    }

    /*
      The declined filter is applied in JS rather than in the WHERE clause, so
      the count BEFORE it is still known. Filtering in SQL would make the
      "excluded because they declined" figure unrecoverable without a second
      query for the same rows.

      "Exclude unsubscribed" maps onto `rsvp_status = 'declined'`, which is the
      only opt-out this schema records. There is no separate unsubscribe flag on
      a guest, and inventing one that nothing ever sets would make the toggle
      decorative.
    */
    const guests = await EventGuest.findAll({
        where,
        attributes: [
            'id', 'name', 'first_name', 'last_name', 'email',
            'dial_code', 'mobile', 'whatsapp', 'table_number', 'group_id',
            'rsvp_status', 'party_size',
        ],
        include: [{ association: 'group', attributes: ['id', 'name'], required: false }],
        order: [['name', 'ASC']],
    });

    const declined = excludeUnsubscribed
        ? guests.filter((g) => g.rsvp_status === 'declined')
        : [];
    const considered = excludeUnsubscribed
        ? guests.filter((g) => g.rsvp_status !== 'declined')
        : guests;

    const eligible = considered.filter((g) => reachable(g, channel));
    const unreachable = considered.filter((g) => !reachable(g, channel));

    /*
      HEADS, not rows. The Guests screen counts people — a guest bringing three
      is three — while a send is one message per guest ROW. Both are correct and
      they are never equal, so the composer reports both rather than leaving
      somebody to wonder which of the two screens is lying.
    */
    const heads = guests.reduce((n, g) => n + (Number(g.party_size) || 1), 0);

    return { guests, declined, considered, eligible, unreachable, heads };
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

/** The client's own event, or a 404 that does not confirm somebody else's. */
async function ownEvent(clientId, eventId) {
    const id = Number(eventId);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('Choose an event.');
    const event = await Event.findOne({ where: { id, website_client_id: clientId } });
    if (!event) throw ApiError.notFound('Event not found.');
    return event;
}

/**
 * Everything the compose screen needs, in one call.
 *
 * One request rather than four: the wizard cannot render a step at a time
 * anyway, and four round trips on a cold load is four spinners.
 */
const getComposer = async (client, { eventId } = {}) => {
    /*
      SOONEST FIRST, and each row carries its own guest count.

      ⚠ This used to order `start_date DESC` and default to `[0]`, which is the
      event FURTHEST in the future — so the composer opened on a wedding two
      years out with nobody on its guest list, and the recipient picker looked
      broken. The event you are most likely messaging about is the NEXT one.

      The count is a subquery rather than a second round trip, and it is on the
      payload so the dropdown can say which events actually have guests — the
      question "why is this empty" should be answerable without leaving the
      screen.
    */
    const events = await Event.findAll({
        where: { website_client_id: client.id, status: { [Op.ne]: 'cancelled' } },
        attributes: [
            'id', 'name', 'start_date', 'start_time', 'venue_name', 'venue_address', 'status',
            [literal(`(SELECT COUNT(*) FROM event_guests g
                        WHERE g.event_id = Event.id
                          AND g.deleted_at IS NULL)`), 'guest_count'],
        ],
        // NULLs last: an undated draft should not head the list.
        order: [
            [literal('`Event`.`start_date` IS NULL'), 'ASC'],
            ['start_date', 'ASC'],
            ['id', 'ASC'],
        ],
    });

    /*
      The default: the soonest event that has not happened yet, falling back to
      the most recent past one. `start_date` is a DATEONLY and comes back as
      'YYYY-MM-DD', so a string compare against today is exact and needs no
      timezone — which is the whole reason the column is DATEONLY.
    */
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = events.filter((e) => e.start_date && e.start_date >= today);
    const past = events.filter((e) => e.start_date && e.start_date < today);

    const chosen = eventId
        ? events.find((e) => e.id === Number(eventId))
        : upcoming[0] ?? past[past.length - 1] ?? events[0];

    let groups = [];
    let guestCount = 0;

    if (chosen) {
        groups = await EventGuestGroup.findAll({
            where: { website_client_id: client.id },
            attributes: [
                'id', 'name', 'color',
                [literal(`(SELECT COUNT(*) FROM event_guests g
                            WHERE g.group_id = EventGuestGroup.id
                              AND g.event_id = ${Number(chosen.id)}
                              AND g.deleted_at IS NULL)`), 'guest_count'],
            ],
            order: [['name', 'ASC']],
        });
        guestCount = await EventGuest.count({
            where: { website_client_id: client.id, event_id: chosen.id },
        });
    }

    return {
        events: events.map((e) => ({
            id: e.id, name: e.name, start_date: e.start_date,
            start_time: e.start_time, venue_name: e.venue_name, status: e.status,
            guest_count: Number(e.get('guest_count')) || 0,
        })),
        selected_event: chosen
            ? {
                id: chosen.id, name: chosen.name, start_date: chosen.start_date,
                start_time: chosen.start_time, venue_name: chosen.venue_name,
                venue_address: chosen.venue_address,
            }
            : null,
        groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            color: g.color,
            guest_count: Number(g.get('guest_count')) || 0,
        })),
        guest_count: guestCount,
        merge_fields: MERGE_FIELDS,
        channels: channelState(),
    };
};

/**
 * The review step: how many this would actually reach, and who it would miss.
 *
 * Computed on the SERVER even though the frontend has the guest list, because
 * this is the number the send itself will use. Two implementations of "who is
 * reachable" is how a review step and a send come to disagree.
 */
const previewAudience = async (client, body = {}) => {
    const event = await ownEvent(client.id, body.event_id);
    const channel = VALID_CHANNELS.includes(body.channel) ? body.channel : 'email';

    const {
        guests, declined, eligible, unreachable, heads,
    } = await resolveAudience(client.id, {
        eventId: event.id,
        audience: body.audience || 'all',
        groupIds: body.group_ids,
        guestIds: body.guest_ids,
        channel,
        excludeUnsubscribed: body.exclude_unsubscribed !== false,
    });

    // The design's Recipient Breakdown, from the data rather than assembled in
    // the browser — the percentages have to agree with the total beside them.
    const byGroup = new Map();
    for (const g of eligible) {
        const key = g.group?.name || 'No group';
        byGroup.set(key, (byGroup.get(key) || 0) + 1);
    }
    const total = eligible.length;

    const sample = eligible[0];
    const hostName = client.name;

    return {
        channel,
        total_recipients: total,
        /*
          The arithmetic, so the screen can show WHY the recipient count is
          smaller than the guest list instead of just asserting a number:
              selected rows  −  declined  −  no address  =  recipients
          `heads` is the figure the Guests screen shows, carried here so the two
          can be reconciled without leaving the composer.
        */
        counts: {
            selected_guests: guests.length,
            heads,
            excluded_declined: declined.length,
            unreachable: unreachable.length,
            recipients: total,
        },
        breakdown: [...byGroup.entries()].map(([name, count]) => ({
            name,
            count,
            percent: total ? Math.round((count / total) * 1000) / 10 : 0,
        })),
        unreachable: {
            count: unreachable.length,
            // Named, not just counted: "12 guests have no email" is actionable
            // only if you can find out which twelve.
            reason: unreachable.length
                ? `${unreachable.length} guest${unreachable.length === 1 ? ' has' : 's have'} no `
                  + `${channel === 'email' ? 'email address' : 'phone number'} on file and will be skipped.`
                : null,
            guests: unreachable.slice(0, 25).map((g) => ({ id: g.id, name: g.name })),
        },
        /*
          The preview renders against a REAL guest wherever there is one, so a
          merge field that will be blank for everybody is visibly blank now
          rather than after the send.
        */
        preview: {
            subject: render(body.subject, { guest: sample, event, hostName }),
            body: render(body.body, { guest: sample, event, hostName }),
            rendered_for: sample ? { id: sample.id, name: sample.name } : null,
        },
        channels: channelState(),
    };
};

/* ── Sending ─────────────────────────────────────────────────────────────── */

/**
 * Send — which today means RECORD.
 *
 * ⚠ No provider is called. The campaign and one delivery row per recipient are
 * written inside a transaction, and the campaign's status reflects what really
 * happened: `sent` only when a provider actually delivered it, otherwise
 * `sending` — because a message that has been composed and queued but has left
 * nothing is genuinely mid-flight, not finished.
 */
const send = async (client, body = {}) => {
    const event = await ownEvent(client.id, body.event_id);

    const channel = String(body.channel || '').toLowerCase();
    if (!VALID_CHANNELS.includes(channel)) {
        throw ApiError.badRequest('Choose WhatsApp or Email.');
    }

    const kind = VALID_KINDS.includes(body.kind) ? body.kind : 'invite';
    const audience = ['all', 'groups', 'guests'].includes(body.audience) ? body.audience : 'all';

    const messageBody = String(body.body || '').trim();
    if (!messageBody) throw ApiError.badRequest('Please fill all mandatory fields.');

    /*
      An email needs a subject; WhatsApp and SMS have no such field, so one is
      derived from the event rather than left blank — the Messages list shows a
      subject column for every channel and an empty cell there reads as broken.
    */
    let subject = String(body.subject || '').trim();
    if (channel === 'email' && !subject) {
        throw ApiError.badRequest('Please fill all mandatory fields.');
    }
    if (!subject) subject = `${CHANNEL_LABEL[channel]} — ${event.name}`;

    const { eligible, unreachable } = await resolveAudience(client.id, {
        eventId: event.id,
        audience,
        groupIds: body.group_ids,
        guestIds: body.guest_ids,
        channel,
        excludeUnsubscribed: body.exclude_unsubscribed !== false,
    });

    if (!eligible.length) {
        throw ApiError.badRequest(
            unreachable.length
                ? `None of the ${unreachable.length} selected guests has a `
                  + `${channel === 'email' ? 'email address' : 'phone number'} on file.`
                : 'No guests match that selection.',
        );
    }

    const state = channelState().find((c) => c.channel === channel);
    const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
        throw ApiError.badRequest('That is not a valid date and time.');
    }
    /*
      A schedule in the past is refused rather than fired immediately. "Send at
      2pm" pressed at 3pm is a mistake, and quietly sending now is the one
      outcome that cannot be undone.
    */
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
        throw ApiError.badRequest('That time has already passed. Choose a later time.');
    }

    const campaign = await sequelize.transaction(async (t) => {
        const created = await EventMessageCampaign.create({
            website_client_id: client.id,
            event_id: event.id,
            subject: subject.slice(0, 255),
            // Stored with the merge fields INTACT — see the header.
            body: messageBody,
            channel,
            kind,
            audience,
            // Snapshots. A group edited after the send must not retroactively
            // change who a sent campaign reached.
            group_ids: audience === 'groups' ? (body.group_ids || []).map(Number) : null,
            guest_ids: audience === 'guests' ? (body.guest_ids || []).map(Number) : null,
            recipients_count: eligible.length,
            status: scheduledAt ? 'scheduled' : (state?.enabled ? 'sent' : 'sending'),
            scheduled_at: scheduledAt,
            timezone: body.timezone || null,
            sent_at: scheduledAt ? null : new Date(),
            /*
              The reason is stored ON the campaign, not only reported live, so a
              campaign sent today still explains itself after a provider is
              connected and the live state has changed.
            */
            failed_reason: scheduledAt || state?.enabled ? null : state?.reason?.slice(0, 255) ?? null,
        }, { transaction: t });

        /*
          One row per recipient, in ONE insert. A loop is N round trips, and
          production is ~374ms each — 800 guests would be five minutes.

          ⚠ status 'queued', never 'sent': nothing has left this system. See the
          header — writing 'sent' would make the analytics rates unrecoverable
          once real deliveries land in the same table.
        */
        await EventMessage.bulkCreate(
            eligible.map((g) => ({
                event_id: event.id,
                campaign_id: created.id,
                guest_id: g.id,
                website_client_id: client.id,
                channel,
                kind: kind === 'custom' ? 'update' : kind,
                status: 'queued',
                sent_at: scheduledAt ? null : new Date(),
            })),
            { transaction: t },
        );

        // Marks the guests as invited, which is what drives the RSVP funnel.
        // Only for an actual invite — a reminder does not re-invite anybody.
        if (kind === 'invite' && !scheduledAt) {
            await EventGuest.update(
                { rsvp_status: 'invited', invited_at: new Date(), invite_source: channel },
                {
                    where: {
                        id: { [Op.in]: eligible.map((g) => g.id) },
                        rsvp_status: 'not_responded',
                    },
                    transaction: t,
                },
            );
        }

        return created;
    });

    // Fire and forget — a failed feed row must not fail a send that happened.
    notifications.notify(client.id, {
        type: scheduledAt ? 'campaign_scheduled' : 'campaign_sent',
        title: scheduledAt ? 'Message scheduled' : `${CHANNEL_LABEL[channel]} message sent`,
        body: scheduledAt
            ? `"${subject}" is scheduled for ${eligible.length} guest${eligible.length === 1 ? '' : 's'} on ${event.name}.`
            : `"${subject}" was recorded for ${eligible.length} guest${eligible.length === 1 ? '' : 's'} on ${event.name}.`,
        eventId: event.id,
        companyId: client.company_id ?? null,
        link: `/dashboard/messages/${campaign.id}`,
        meta: { channel, recipients: eligible.length, delivered: Boolean(state?.enabled) },
    });

    return {
        campaign: shapeCampaign(campaign, { event }),
        recipients: eligible.length,
        skipped: unreachable.length,
        delivery: {
            attempted: Boolean(state?.enabled),
            /*
              The honest answer, from the channel's own state. The screen does
              not decide what to promise — this does.
            */
            reason: state?.enabled ? null : state?.reason ?? null,
        },
    };
};

/**
 * Send one test to the client's own address.
 *
 * Written as a campaign of one so it appears in the record like anything else.
 * A test that left no trace would be a message the client cannot prove they
 * sent, and the whole point of it is to see what a guest sees.
 */
const sendTest = async (client, body = {}) => {
    const event = await ownEvent(client.id, body.event_id);
    const channel = VALID_CHANNELS.includes(body.channel) ? body.channel : 'email';
    const state = channelState().find((c) => c.channel === channel);

    const destination = channel === 'email' ? client.email : client.mobile;
    if (!destination) {
        throw ApiError.badRequest(
            channel === 'email'
                ? 'Your account has no email address to send a test to.'
                : 'Your account has no phone number to send a test to.',
        );
    }

    return {
        sent: false,
        destination,
        preview: {
            subject: render(body.subject, { guest: null, event, hostName: client.name }),
            body: render(body.body, { guest: null, event, hostName: client.name }),
        },
        /*
          A test cannot be delivered either, and says so plainly instead of
          claiming success and leaving somebody watching an inbox.
        */
        reason: state?.enabled
            ? null
            : `${state?.label} is not connected yet, so no test could be delivered to ${destination}. `
              + 'The preview above is exactly what a guest would receive.',
    };
};

/* ── The record ──────────────────────────────────────────────────────────── */

const shapeCampaign = (row, { event } = {}) => {
    const j = row.toJSON ? row.toJSON() : row;
    const ev = j.event || event;
    return {
        id: j.id,
        subject: j.subject,
        body: j.body,
        channel: j.channel,
        channel_label: CHANNEL_LABEL[j.channel] || j.channel,
        kind: j.kind,
        audience: j.audience,
        group_ids: j.group_ids || null,
        guest_ids: j.guest_ids || null,
        recipients_count: Number(j.recipients_count) || 0,
        status: j.status,
        scheduled_at: j.scheduled_at,
        sent_at: j.sent_at,
        failed_reason: j.failed_reason,
        created_at: j.created_at,
        event: ev ? { id: ev.id, name: ev.name, start_date: ev.start_date } : null,
        // Per-campaign counts, filled in by the list and detail queries. Always
        // present so a screen never has to test for the key.
        delivery: j.delivery || null,
    };
};

/**
 * The Messages list.
 *
 * ⚠ The three channel tiles count the WHOLE account, never the filtered page —
 * a "Sent 212" that moved while somebody typed in the search box would be
 * reporting the search.
 */
const listCampaigns = async (client, {
    channel, status, eventId, search, from, to, page = 1, limit = 10,
} = {}) => {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 10));

    const where = { website_client_id: client.id };
    if (channel && VALID_CHANNELS.includes(channel)) where.channel = channel;
    if (status) where.status = status;
    if (eventId) where.event_id = Number(eventId);
    if (search) {
        const like = `%${String(search).trim()}%`;
        where[Op.or] = [{ subject: { [Op.like]: like } }, { body: { [Op.like]: like } }];
    }
    if (from || to) {
        where.created_at = {};
        if (from) where.created_at[Op.gte] = new Date(`${from}T00:00:00`);
        // ⚠ Inclusive of the `to` day. A naive `<=` on a bare date excludes
        // everything that happened during the final chosen day — the most
        // confusing possible off-by-one, because the row is visible right up
        // until you filter for it.
        if (to) where.created_at[Op.lte] = new Date(`${to}T23:59:59.999`);
    }

    const { rows, count } = await EventMessageCampaign.findAndCountAll({
        where,
        include: [{ association: 'event', attributes: ['id', 'name', 'start_date'], required: false }],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        offset: (p - 1) * l,
        limit: l,
    });

    // One extra query for the whole page rather than one per row.
    const deliveryByCampaign = new Map();
    if (rows.length) {
        const agg = await EventMessage.findAll({
            where: { campaign_id: { [Op.in]: rows.map((r) => r.id) } },
            attributes: [
                'campaign_id',
                [fn('COUNT', col('id')), 'total'],
                [fn('SUM', literal("CASE WHEN status = 'delivered' THEN 1 ELSE 0 END")), 'delivered'],
                [fn('SUM', literal("CASE WHEN status = 'failed' THEN 1 ELSE 0 END")), 'failed'],
                [fn('SUM', literal('CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END')), 'opened'],
            ],
            group: ['campaign_id'],
            raw: true,
        });
        for (const a of agg) {
            const total = Number(a.total) || 0;
            const delivered = Number(a.delivered) || 0;
            deliveryByCampaign.set(Number(a.campaign_id), {
                total,
                delivered,
                failed: Number(a.failed) || 0,
                opened: Number(a.opened) || 0,
                // A rate is null, never 0%, while nothing has been delivered:
                // 0% reads as "it failed", and nothing was attempted.
                delivered_rate: delivered ? Math.round((delivered / total) * 1000) / 10 : null,
            });
        }
    }

    const shaped = rows.map((r) => {
        const s = shapeCampaign(r);
        s.delivery = deliveryByCampaign.get(r.id) || {
            total: s.recipients_count, delivered: 0, failed: 0, opened: 0, delivered_rate: null,
        };
        return s;
    });

    return {
        campaigns: shaped,
        pagination: { page: p, limit: l, totalItems: count, totalPages: Math.ceil(count / l) || 1 },
        stats: await getStats(client.id),
        channels: channelState(),
    };
};

/** The three channel cards. Whole account, always. */
const getStats = async (clientId) => {
    const rows = await EventMessage.findAll({
        where: { website_client_id: clientId },
        attributes: [
            'channel',
            [fn('COUNT', col('id')), 'total'],
            [fn('SUM', literal("CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END")), 'sent'],
            [fn('SUM', literal("CASE WHEN status = 'delivered' THEN 1 ELSE 0 END")), 'delivered'],
            [fn('SUM', literal("CASE WHEN status = 'failed' THEN 1 ELSE 0 END")), 'failed'],
            [fn('SUM', literal("CASE WHEN status = 'queued' THEN 1 ELSE 0 END")), 'queued'],
        ],
        group: ['channel'],
        raw: true,
    });

    const byChannel = {};
    let grand = 0;
    for (const r of rows) {
        const total = Number(r.total) || 0;
        grand += total;
        byChannel[r.channel] = {
            total,
            sent: Number(r.sent) || 0,
            delivered: Number(r.delivered) || 0,
            failed: Number(r.failed) || 0,
            queued: Number(r.queued) || 0,
        };
    }
    /*
      Every OFFERED channel gets a zeroed entry so the tiles always render, and
      any channel that merely HAS rows keeps its own — an old SMS campaign must
      not drop out of the totals just because SMS is no longer offered.
    */
    for (const c of new Set([...VALID_CHANNELS, ...Object.keys(byChannel)])) {
        byChannel[c] = byChannel[c] || { total: 0, sent: 0, delivered: 0, failed: 0, queued: 0 };
        byChannel[c].share = grand ? Math.round((byChannel[c].total / grand) * 1000) / 10 : 0;
    }

    return { total: grand, by_channel: byChannel };
};

/** One campaign, with the guests it went to. */
const getCampaign = async (client, id) => {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) throw ApiError.notFound('Message not found.');

    const campaign = await EventMessageCampaign.findOne({
        where: { id: numeric, website_client_id: client.id },
        include: [{ association: 'event', attributes: ['id', 'name', 'start_date', 'start_time', 'venue_name', 'venue_address'], required: false }],
    });
    if (!campaign) throw ApiError.notFound('Message not found.');

    const deliveries = await EventMessage.findAll({
        where: { campaign_id: campaign.id },
        include: [{
            association: 'guest',
            attributes: ['id', 'name', 'email', 'mobile', 'whatsapp'],
            required: false,
            paranoid: false,
        }],
        order: [['id', 'ASC']],
        limit: 500,
    });

    const shaped = shapeCampaign(campaign);
    shaped.delivery = {
        total: deliveries.length,
        delivered: deliveries.filter((d) => d.status === 'delivered').length,
        failed: deliveries.filter((d) => d.status === 'failed').length,
        opened: deliveries.filter((d) => d.opened_at).length,
        queued: deliveries.filter((d) => d.status === 'queued').length,
    };

    const state = channelState().find((c) => c.channel === campaign.channel);

    return {
        campaign: shaped,
        // Rendered for the first real recipient, so the record shows what was
        // actually sent rather than the template with braces in it.
        preview: render(campaign.body, {
            guest: deliveries[0]?.guest,
            event: campaign.event,
            hostName: client.name,
        }),
        recipients: deliveries.map((d) => ({
            id: d.id,
            status: d.status,
            sent_at: d.sent_at,
            delivered_at: d.delivered_at,
            opened_at: d.opened_at,
            failed_reason: d.failed_reason,
            guest: d.guest
                ? { id: d.guest.id, name: d.guest.name, email: d.guest.email, mobile: d.guest.mobile }
                : null,
        })),
        channel_state: state,
    };
};

module.exports = {
    getComposer,
    previewAudience,
    send,
    sendTest,
    listCampaigns,
    getCampaign,
    getStats,
    channelState,
    // Exported for the tests — these are the behaviours worth locking.
    render,
    reachable,
    MERGE_FIELDS,
};
