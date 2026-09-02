const {
    Sequelize,
    Event,
    EventGuest,
    EventGuestGroup,
    EventGuestResponseLog,
    EventMessage,
} = require('../models');
const { Op, fn, col, literal } = Sequelize;
const ApiError = require('../utils/apiError');
const notifications = require('./clientNotification.service');

/**
 * RSVPs.
 *
 * ── ⚠ THERE IS NO RSVP TABLE, AND THAT IS THE THING TO UNDERSTAND HERE ──────
 * An RSVP is not a row. It is the response COLUMNS on a guest —
 * `rsvp_status`, `response_type`, `responded_at`, `party_size`,
 * `dietary_preference`, `notes`. This module is a different lens on
 * `event_guests`, not a different table.
 *
 * Three consequences that shape every function below:
 *
 * 1. **"Delete RSVP" cannot delete an RSVP.** It CLEARS the response and leaves
 *    the guest on the list, able to answer again. Deleting the row would remove
 *    them from the guest list, the group and every count — which the confirm
 *    dialog does not say, and which the Guests module already offers separately.
 *
 * 2. **A guest is PER EVENT.** The same person invited to three events is three
 *    rows, linked only by `email`. "Total events invited" and Linked Events
 *    therefore match on email — so a typo'd address silently splits one person
 *    into two, and nothing here can detect that.
 *
 * 3. **There IS a response history now, and it is a different table.** A guest
 *    row still holds ONE current answer and changing it still overwrites —
 *    that has not changed and must not be read as having changed. What changed
 *    is that every change now APPENDS to `event_guest_response_logs` on its way
 *    through. So:
 *
 *      - "what did they say"  -> read the GUEST. Always.
 *      - "how did it get there" -> read the LOG.
 *
 *    Code that answers the first question from the newest log row will be
 *    wrong the moment a log write is ever skipped, and the guest row is the
 *    thing every count, filter and tile already reads.
 *
 *    ⚠ Rows written before the migration have no log. Their history begins
 *    with the one seeded entry for their current answer, and guests who never
 *    answered have none at all — "no history" is the true answer for them, not
 *    an empty state to apologise for.
 *
 *    The TIMELINE is still derived from timestamps (`created_at`,
 *    `invited_at`, `responded_at`) plus the message log, and is still never
 *    stored — that is a different thing from this and stays that way.
 *
 * ── WHAT THE DESIGN ASKS FOR THAT HAS NO COLUMN ─────────────────────────────
 * Accommodation Required, and Custom Questions — `custom_answers` is a JSON
 * column but NOTHING defines what the questions are, so answers cannot be
 * labelled. Both are absent rather than faked.
 */

/* ── Shared ──────────────────────────────────────────────────────────────── */

const RSVP_STATUSES = ['not_responded', 'invited', 'pending', 'accepted', 'declined'];
const RESPONSE_TYPES = ['none', 'yes', 'no', 'maybe'];
/* `unknown` is "nobody asked", NOT a synonym for `not_required`. */
const ACCOMMODATION = ['unknown', 'required', 'not_required'];

/**
 * What the screen calls each state.
 *
 * The design's five tiles are Total / Accepted / Maybe / Declined / No Response,
 * which is FOUR buckets over five stored statuses — `not_responded` and
 * `invited` both mean "we are still waiting", and the tab must agree with the
 * tile or the two disagree on the same screen.
 */
const BUCKET = {
    accepted: 'accepted',
    declined: 'declined',
    pending: 'maybe',
    not_responded: 'no_response',
    invited: 'no_response',
};

const GUEST_ATTRS = [
    'id', 'event_id', 'group_id', 'name', 'first_name', 'last_name', 'title',
    'email', 'dial_code', 'mobile', 'whatsapp', 'company', 'table_number',
    'party_size', 'rsvp_status', 'response_type', 'invite_source',
    'invited_at', 'responded_at', 'notes', 'dietary_preference',
    'special_requirements', 'plus_one', 'plus_one_count', 'custom_answers',
    'city', 'state', 'country', 'created_at', 'updated_at',
    'accommodation', 'relationship', 'photo', 'added_by_client_id',
];

const INCLUDE = [
    { association: 'event', attributes: ['id', 'name', 'start_date', 'start_time', 'venue_name', 'venue_address'], required: false },
    { association: 'group', attributes: ['id', 'name', 'color'], required: false },
];

const shape = (row) => {
    const j = row.toJSON ? row.toJSON() : row;
    return {
        id: j.id,
        guest: {
            id: j.id,
            name: j.name,
            first_name: j.first_name,
            last_name: j.last_name,
            title: j.title,
            email: j.email,
            dial_code: j.dial_code,
            mobile: j.mobile,
            whatsapp: j.whatsapp,
            company: j.company,
            table_number: j.table_number,
            city: j.city,
            state: j.state,
            country: j.country,
            photo: j.photo || null,
            /* Separate from the group even when the two agree — the profile
               header shows both, and one is not the other's label. */
            relationship: j.relationship || null,
        },
        accommodation: j.accommodation || 'unknown',
        added_by_client_id: j.added_by_client_id || null,
        event: j.event
            ? {
                id: j.event.id, name: j.event.name, start_date: j.event.start_date,
                start_time: j.event.start_time, venue_name: j.event.venue_name,
                venue_address: j.event.venue_address,
            }
            : null,
        group: j.group ? { id: j.group.id, name: j.group.name, color: j.group.color } : null,

        rsvp_status: j.rsvp_status,
        response_type: j.response_type,
        /** The four buckets the tiles and tabs share. */
        bucket: BUCKET[j.rsvp_status] || 'no_response',
        party_size: Number(j.party_size) || 1,
        dietary_preference: j.dietary_preference,
        special_requirements: j.special_requirements,
        plus_one: Boolean(j.plus_one),
        plus_one_count: Number(j.plus_one_count) || 0,
        notes: j.notes,
        /*
          Returned raw. There is no question table, so nothing can label these —
          the screen prints the key as given rather than inventing a wording.
        */
        custom_answers: j.custom_answers ?? null,

        invite_source: j.invite_source,
        invited_at: j.invited_at,
        responded_at: j.responded_at,
        created_at: j.created_at,
        updated_at: j.updated_at,
    };
};

/* ── The list ────────────────────────────────────────────────────────────── */

/**
 * Filters shared by the list, the stats and the export, so the three can never
 * disagree about which rows they are describing.
 */
function buildWhere(clientId, query = {}) {
    const where = { website_client_id: clientId };

    if (query.event_id && query.event_id !== 'all') where.event_id = Number(query.event_id);
    if (query.group_id && query.group_id !== 'all') where.group_id = Number(query.group_id);

    /*
      Filtering by BUCKET, not by stored status — the tabs are the four the
      screen shows, and "no response" covers two stored values.
    */
    if (query.status && query.status !== 'all') {
        const stored = Object.entries(BUCKET)
            .filter(([, bucket]) => bucket === query.status)
            .map(([status]) => status);
        if (stored.length) where.rsvp_status = { [Op.in]: stored };
        else if (RSVP_STATUSES.includes(query.status)) where.rsvp_status = query.status;
    }

    if (query.search) {
        const like = `%${String(query.search).trim()}%`;
        where[Op.or] = [
            { name: { [Op.like]: like } },
            { email: { [Op.like]: like } },
            { mobile: { [Op.like]: like } },
        ];
    }

    /*
      The date range is on RESPONDED_AT, which is what the screen's column shows.
      ⚠ Inclusive of the `to` day — a naive `<=` on a bare date excludes
      everything that happened during the final chosen day, which is the most
      confusing possible off-by-one because the row is visible right up until
      you filter for it.
    */
    if (query.from || query.to) {
        where.responded_at = {};
        if (query.from) where.responded_at[Op.gte] = new Date(`${query.from}T00:00:00`);
        if (query.to) where.responded_at[Op.lte] = new Date(`${query.to}T23:59:59.999`);
    }

    return where;
}

/**
 * The five tiles.
 *
 * ⚠ Counted over everything the FILTERS select except the status filter itself —
 * otherwise clicking "Accepted" would make every other tile read zero, and the
 * tile bar would stop being a summary and become a restatement of the tab.
 */
const getStats = async (clientId, query = {}) => {
    const where = buildWhere(clientId, { ...query, status: 'all' });

    const rows = await EventGuest.findAll({
        where,
        attributes: [
            'rsvp_status',
            [fn('COUNT', col('id')), 'rows_n'],
            [fn('SUM', col('party_size')), 'heads'],
        ],
        group: ['rsvp_status'],
        raw: true,
    });

    const buckets = { accepted: 0, maybe: 0, declined: 0, no_response: 0 };
    let total = 0;
    let heads = 0;

    for (const r of rows) {
        const n = Number(r.rows_n) || 0;
        buckets[BUCKET[r.rsvp_status] || 'no_response'] += n;
        total += n;
        heads += Number(r.heads) || 0;
    }

    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

    return {
        // "Total Invitations" is ROWS — one invitation per guest, however many
        // people that invitation covers. `heads` is the other number, and the
        // two are never equal.
        total_invitations: total,
        heads,
        accepted: buckets.accepted,
        accepted_pct: pct(buckets.accepted),
        maybe: buckets.maybe,
        maybe_pct: pct(buckets.maybe),
        declined: buckets.declined,
        declined_pct: pct(buckets.declined),
        no_response: buckets.no_response,
        no_response_pct: pct(buckets.no_response),
    };
};

const list = async (clientId, query = {}) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));

    const { rows, count } = await EventGuest.findAndCountAll({
        where: buildWhere(clientId, query),
        attributes: GUEST_ATTRS,
        include: INCLUDE,
        // Answered first and most recent at the top; unanswered rows fall to the
        // bottom rather than heading the list with an empty date column.
        order: [
            [literal('`EventGuest`.`responded_at` IS NULL'), 'ASC'],
            ['responded_at', 'DESC'],
            ['id', 'DESC'],
        ],
        offset: (page - 1) * limit,
        limit,
        distinct: true,
    });

    return {
        rsvps: rows.map(shape),
        pagination: { page, limit, totalItems: count, totalPages: Math.ceil(count / limit) || 1 },
        stats: await getStats(clientId, query),
    };
};

/* ── One RSVP ────────────────────────────────────────────────────────────── */

async function own(clientId, id) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) throw ApiError.notFound('RSVP not found.');
    const row = await EventGuest.findOne({
        where: { id: numeric, website_client_id: clientId },
        attributes: GUEST_ATTRS,
        include: INCLUDE,
    });
    if (!row) throw ApiError.notFound('RSVP not found.');
    return row;
}

/**
 * The timeline.
 *
 * DERIVED, never stored — every entry is an existing timestamp. A stored
 * timeline would be a second place for the same facts and the first to fall out
 * of step with the row it describes.
 *
 * Only what HAPPENED appears. A greyed-out "awaiting response" step, as the
 * mockup draws it, reads as stuck rather than as not started.
 */
function buildTimeline(guest, messages) {
    const entries = [{
        key: 'created',
        label: 'Invitation created',
        detail: `${guest.name} was added to the guest list.`,
        at: guest.created_at,
    }];

    if (guest.invited_at) {
        entries.push({
            key: 'invited',
            label: 'Invitation sent',
            detail: guest.invite_source
                ? `Sent via ${guest.invite_source}.`
                : 'Invitation sent.',
            at: guest.invited_at,
        });
    }

    for (const m of messages) {
        entries.push({
            key: `msg-${m.id}`,
            label: m.kind === 'reminder' ? 'Reminder sent' : 'Message sent',
            detail: `${m.channel === 'email' ? 'Email' : 'WhatsApp'} — ${m.status}.`,
            at: m.sent_at || m.created_at,
            channel: m.channel,
        });
    }

    if (guest.responded_at) {
        const verb = guest.response_type === 'yes' ? 'accepted'
            : guest.response_type === 'no' ? 'declined'
                : guest.response_type === 'maybe' ? 'replied "maybe" to'
                    : 'responded to';
        entries.push({
            key: 'responded',
            label: 'RSVP received',
            detail: `${guest.name} ${verb} the invitation.`,
            at: guest.responded_at,
        });
    }

    if (guest.event?.start_date) {
        entries.push({
            key: 'event',
            label: 'Event date',
            detail: 'The event is scheduled to take place.',
            at: `${guest.event.start_date}T${guest.event.start_time || '00:00:00'}`,
            upcoming: true,
        });
    }

    return entries
        .filter((e) => e.at)
        .sort((a, b) => new Date(a.at) - new Date(b.at));
}

const getById = async (clientId, id) => {
    const guest = await own(clientId, id);

    const messages = await EventMessage.findAll({
        where: { website_client_id: clientId, guest_id: guest.id },
        attributes: ['id', 'channel', 'kind', 'status', 'sent_at', 'delivered_at', 'opened_at', 'created_at'],
        order: [['created_at', 'ASC']],
        limit: 100,
    });

    /*
      The same PERSON at other events, matched on email — the only link this
      schema has. See the header: a typo'd address splits one person in two and
      nothing here can tell.
    */
    const linked = guest.email
        ? await EventGuest.findAll({
            where: {
                website_client_id: clientId,
                email: guest.email,
                id: { [Op.ne]: guest.id },
            },
            attributes: ['id', 'event_id', 'rsvp_status', 'response_type', 'responded_at', 'party_size'],
            include: [{ association: 'event', attributes: ['id', 'name', 'start_date', 'venue_name'], required: false }],
            order: [['id', 'DESC']],
            limit: 25,
        })
        : [];

    /*
      Capped at 50. A history is read newest-first and nobody scrolls past the
      last few; an uncapped list would grow without bound on a guest whose
      answer keeps changing.
    */
    const history = await EventGuestResponseLog.findAll({
        where: { website_client_id: clientId, guest_id: guest.id },
        include: [{ association: 'event', attributes: ['id', 'name', 'start_date'], required: false }],
        order: [['changed_at', 'DESC'], ['id', 'DESC']],
        limit: 50,
    });

    return {
        rsvp: shape(guest),
        timeline: buildTimeline(guest, messages),
        /** Invitation History — every message this guest was sent. */
        messages: messages.map((m) => ({
            id: m.id,
            channel: m.channel,
            kind: m.kind,
            status: m.status,
            sent_at: m.sent_at,
            delivered_at: m.delivered_at,
            opened_at: m.opened_at,
        })),
        /** Linked Events — the same email, other events. */
        linked_events: linked.map((g) => ({
            id: g.id,
            rsvp_status: g.rsvp_status,
            response_type: g.response_type,
            bucket: BUCKET[g.rsvp_status] || 'no_response',
            responded_at: g.responded_at,
            party_size: Number(g.party_size) || 1,
            event: g.event
                ? { id: g.event.id, name: g.event.name, start_date: g.event.start_date, venue_name: g.event.venue_name }
                : null,
        })),
        /**
         * RSVP History — every recorded change to this guest's answer.
         *
         * ⚠ Newest first, which is the opposite of `timeline`. The timeline
         * tells a story forwards; a history answers "what is the latest thing
         * that happened", so the useful row is the top one.
         *
         * An EMPTY array is a real and correct answer for a guest who has
         * never replied, and for one whose only answer predates the migration
         * and was never logged. The screen must say "no changes recorded"
         * rather than treating it as a load failure.
         */
        response_history: history.map((h) => ({
            id: h.id,
            from_response_type: h.from_response_type,
            to_response_type: h.to_response_type,
            party_size: h.party_size,
            dietary_preference: h.dietary_preference,
            accommodation: h.accommodation,
            notes: h.notes,
            source: h.source,
            changed_at: h.changed_at,
            /* Derived here so the screen does not re-decide it: the first
               entry is "Responded", the rest are "Changed from X". */
            is_first: h.from_response_type === null,
            event: h.event ? { id: h.event.id, name: h.event.name, start_date: h.event.start_date } : null,
        })),
        /*
          What this system STILL does not record. Two entries left this list
          when the tables behind them were built — do not re-add a line here
          without also removing what backs it.
        */
        unavailable: {
            custom_questions: 'No custom questions are defined for this event, so answers cannot be labelled.',
        },
    };
};

/* ── Editing ─────────────────────────────────────────────────────────────── */

/** The response fields a change to which is worth a history entry. */
const LOGGED_FIELDS = [
    'response_type', 'party_size', 'dietary_preference', 'accommodation', 'notes',
];

/**
 * Append one entry to a guest's RSVP history.
 *
 * ⚠ Call this with the values from BEFORE the update and the payload that is
 * about to be applied — it snapshots what the answer BECAME, which is only
 * knowable from both.
 *
 * Returns without writing when nothing in `LOGGED_FIELDS` actually changed. A
 * history with an entry for every save — including the ones that moved a guest
 * between groups and touched no answer — is a history nobody reads, because
 * finding the real change means scrolling past the noise.
 *
 * ⚠ It never throws. A history is a record OF the change, not a condition for
 * it: if this insert fails the response has still legitimately changed, and
 * turning that into a 500 would leave the guest edited and the client told it
 * failed. The failure is logged and the request succeeds.
 */
const logResponseChange = async (clientId, guest, before, data, opts = {}) => {
    const changed = LOGGED_FIELDS.some(
        (f) => data[f] !== undefined && data[f] !== before[f],
    );
    if (!changed) return;

    const pick = (f) => (data[f] !== undefined ? data[f] : before[f]);

    try {
        await EventGuestResponseLog.create({
            website_client_id: clientId,
            guest_id: guest.id,
            event_id: guest.event_id,
            /*
              NULL only when this guest has no history at all. 'none' would say
              they had actively declined to answer before, which for a first
              entry is a claim nobody made.
            */
            from_response_type: opts.first ? null : before.response_type,
            to_response_type: pick('response_type'),
            party_size: pick('party_size') || 1,
            dietary_preference: pick('dietary_preference') || null,
            accommodation: pick('accommodation') || 'unknown',
            notes: pick('notes') || null,
            source: opts.source || 'client',
            changed_by_client_id: clientId,
            changed_at: new Date(),
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[rsvp] response history not written', {
            guest_id: guest.id, error: err.message,
        });
    }
};

/**
 * Update a response.
 *
 * ⚠ ONLY the response fields. Name, email and phone belong to the guest and are
 * edited on the Guests screen — accepting them here would give two screens
 * write access to the same columns with two different validation rules, which
 * is how a mobile number ends up valid on one and not the other.
 *
 * `rsvp_status` is DERIVED from `response_type` rather than accepted alongside
 * it: allowing both means a row can say "accepted" and "no" at once, and
 * nothing downstream could decide which is true.
 */
const update = async (clientId, id, body = {}) => {
    const guest = await own(clientId, id);
    const before = guest.response_type;

    /*
      The whole answer as it stands, captured BEFORE anything is applied.
      `guest` is a live model instance — reading these after `update()` would
      read the new values back and every history row would say nothing changed.
    */
    const snapshot = {
        response_type: guest.response_type,
        party_size: guest.party_size,
        dietary_preference: guest.dietary_preference,
        accommodation: guest.accommodation,
        notes: guest.notes,
    };

    const data = {};

    if (body.response_type !== undefined) {
        const value = String(body.response_type || 'none').toLowerCase();
        if (!RESPONSE_TYPES.includes(value)) throw ApiError.badRequest('Invalid response.');
        data.response_type = value;
        data.rsvp_status = value === 'yes' ? 'accepted'
            : value === 'no' ? 'declined'
                : value === 'maybe' ? 'pending'
                    : 'invited';
        /*
          The response time is stamped when an answer first arrives and cleared
          when it is taken back — "responded on" must never name a moment the
          client has since undone.
        */
        if (value === 'none') data.responded_at = null;
        else if (!guest.responded_at) data.responded_at = new Date();
    }

    if (body.party_size !== undefined) {
        const size = Number(body.party_size);
        if (!Number.isInteger(size) || size < 1 || size > 50) {
            throw ApiError.badRequest('Number of guests must be between 1 and 50.');
        }
        data.party_size = size;
    }

    if (body.group_id !== undefined) {
        if (body.group_id === null || body.group_id === '') {
            data.group_id = null;
        } else {
            const group = await EventGuestGroup.findOne({
                where: { id: Number(body.group_id), website_client_id: clientId },
                attributes: ['id'],
            });
            if (!group) throw ApiError.badRequest('That group is not on your account.');
            data.group_id = group.id;
        }
    }

    if (body.dietary_preference !== undefined) {
        data.dietary_preference = body.dietary_preference
            ? String(body.dietary_preference).slice(0, 255) : null;
    }
    if (body.special_requirements !== undefined) {
        data.special_requirements = body.special_requirements
            ? String(body.special_requirements).slice(0, 500) : null;
    }
    if (body.notes !== undefined) {
        data.notes = body.notes ? String(body.notes).slice(0, 500) : null;
    }

    /*
      Three states, and the third is not a synonym for "no".
      `unknown` means nobody asked — printed as "—" — and coercing a missing
      value to `not_required` would turn every un-asked guest into one who has
      actively declined a room.
    */
    if (body.accommodation !== undefined) {
        const value = String(body.accommodation || 'unknown').toLowerCase();
        if (!ACCOMMODATION.includes(value)) throw ApiError.badRequest('Invalid accommodation value.');
        data.accommodation = value;
    }

    if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update.');

    await guest.update(data);

    /*
      After the update, so a failed save leaves no entry claiming a change that
      did not happen. `first` looks for any existing row rather than trusting
      the seed: a guest added after the migration has none, and their first
      answer is genuinely a first.
    */
    const priorCount = await EventGuestResponseLog.count({ where: { guest_id: guest.id } });
    await logResponseChange(clientId, guest, snapshot, data, { first: priorCount === 0 });

    // Fires on the TRANSITION only — see clientGuest.service. Editing a table
    // number for somebody who had already accepted must not write a second one.
    const after = guest.response_type;
    if (after !== before && ['yes', 'no', 'maybe'].includes(after)) {
        notifications.notify(clientId, {
            type: after === 'yes' ? 'rsvp_accepted' : after === 'no' ? 'rsvp_declined' : 'rsvp_maybe',
            title: 'RSVP updated',
            body: `${guest.name}'s response was changed to ${after === 'yes' ? 'accepted' : after === 'no' ? 'declined' : 'maybe'}.`,
            eventId: guest.event_id,
            guestId: guest.id,
            link: `/dashboard/rsvps/${guest.id}`,
            meta: { response: after, source: 'manual' },
        });
    }

    return getById(clientId, id);
};

/**
 * Clear a response.
 *
 * ⚠ This does NOT delete the guest, and the route is named `reset` rather than
 * `delete` so nobody wires a destructive button to it by reading the verb. The
 * guest stays on the list, in their group, in every count, and can answer
 * again — which is what "remove the response record" in the confirm dialog
 * actually describes.
 *
 * Deleting the person is `DELETE /client/guests/:id`, which already exists and
 * says so.
 */
const resetResponse = async (clientId, id, reason = null) => {
    const guest = await own(clientId, id);

    const snapshot = {
        response_type: guest.response_type,
        party_size: guest.party_size,
        dietary_preference: guest.dietary_preference,
        accommodation: guest.accommodation,
        notes: guest.notes,
    };

    await guest.update({
        response_type: 'none',
        // Back to 'invited', not 'not_responded': the invitation WAS sent, and
        // pretending otherwise would put them back in the "never contacted"
        // bucket and hide that they have already been asked.
        rsvp_status: guest.invited_at ? 'invited' : 'not_responded',
        responded_at: null,
        // The response note goes with the response. A dietary preference is a
        // standing fact about the person and stays.
        notes: reason ? String(reason).slice(0, 500) : null,
    });

    /*
      ⚠ Taking an answer back IS history, and the most important kind.

      This is the one operation where the guest row afterwards says nothing at
      all — `response_type: 'none'`, `responded_at: null`. Without an entry the
      fact that they once accepted would be gone from the system entirely, and
      "they never replied" is a materially different sentence from "they
      accepted and the host cleared it".
    */
    const priorCount = await EventGuestResponseLog.count({ where: { guest_id: guest.id } });
    await logResponseChange(
        clientId, guest, snapshot,
        { response_type: 'none', notes: reason ? String(reason).slice(0, 500) : null },
        { first: priorCount === 0 },
    );

    return getById(clientId, id);
};

/* ── Groups ──────────────────────────────────────────────────────────────── */

/**
 * Group Details — the group, its members, and its RSVP breakdown.
 *
 * ⚠ Scoped to ONE event. A group is client-scoped but its members belong to
 * events, so "8 members, 3 accepted" is only a true sentence about a single
 * event — across two it would double-count anybody invited to both.
 */
const getGroup = async (clientId, groupId, query = {}) => {
    const numeric = Number(groupId);
    if (!Number.isInteger(numeric) || numeric <= 0) throw ApiError.notFound('Group not found.');

    const group = await EventGuestGroup.findOne({
        where: { id: numeric, website_client_id: clientId },
    });
    if (!group) throw ApiError.notFound('Group not found.');

    const where = { website_client_id: clientId, group_id: group.id };
    let event = null;

    if (query.event_id && query.event_id !== 'all') {
        where.event_id = Number(query.event_id);
        event = await Event.findOne({
            where: { id: Number(query.event_id), website_client_id: clientId },
            attributes: ['id', 'name', 'start_date', 'start_time', 'venue_name'],
        });
    }

    const members = await EventGuest.findAll({
        where,
        attributes: GUEST_ATTRS,
        include: INCLUDE,
        order: [
            [literal('`EventGuest`.`responded_at` IS NULL'), 'ASC'],
            ['responded_at', 'DESC'],
            ['name', 'ASC'],
        ],
    });

    const buckets = { accepted: 0, maybe: 0, declined: 0, no_response: 0 };
    let heads = 0;
    for (const m of members) {
        buckets[BUCKET[m.rsvp_status] || 'no_response'] += 1;
        heads += Number(m.party_size) || 1;
    }
    const total = members.length;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

    /*
      Group Activity — derived from who answered and when. Only real responses
      appear, newest first; a group where nobody has replied shows nothing
      rather than a list of "no response" rows, which is not activity.
    */
    const activity = members
        .filter((m) => m.responded_at)
        .sort((a, b) => new Date(b.responded_at) - new Date(a.responded_at))
        .slice(0, 10)
        .map((m) => ({
            guest_id: m.id,
            name: m.name,
            bucket: BUCKET[m.rsvp_status] || 'no_response',
            at: m.responded_at,
        }));

    return {
        group: {
            id: group.id,
            name: group.name,
            color: group.color,
            description: group.description,
            visibility: group.visibility,
            is_default: Boolean(group.is_default),
            created_at: group.created_at,
        },
        event: event
            ? { id: event.id, name: event.name, start_date: event.start_date, start_time: event.start_time, venue_name: event.venue_name }
            : null,
        stats: {
            total_members: total,
            heads,
            accepted: buckets.accepted, accepted_pct: pct(buckets.accepted),
            maybe: buckets.maybe, maybe_pct: pct(buckets.maybe),
            declined: buckets.declined, declined_pct: pct(buckets.declined),
            no_response: buckets.no_response, no_response_pct: pct(buckets.no_response),
        },
        members: members.map(shape),
        activity,
    };
};

/**
 * Move a guest to another group.
 *
 * Their RSVP is untouched — the confirm dialog promises exactly that, and a
 * move that silently reset a response would be the worst kind of surprise.
 */
const moveToGroup = async (clientId, guestId, targetGroupId) => {
    const guest = await own(clientId, guestId);

    if (targetGroupId === null || targetGroupId === '' || targetGroupId === undefined) {
        await guest.update({ group_id: null });
        return getById(clientId, guestId);
    }

    const group = await EventGuestGroup.findOne({
        where: { id: Number(targetGroupId), website_client_id: clientId },
        attributes: ['id', 'name'],
    });
    if (!group) throw ApiError.badRequest('That group is not on your account.');

    await guest.update({ group_id: group.id });
    return getById(clientId, guestId);
};

/* ── Export ──────────────────────────────────────────────────────────────── */

/**
 * The rows an export would contain, with the SAME filters the list uses.
 *
 * Returns data, not a file: the CSV is assembled in the browser, exactly as the
 * invoice export is. There is no spreadsheet library and no PDF renderer here,
 * and no job queue — so the design's "XLSX / PDF, generated in the background,
 * we will email you a link" describes three things that do not exist.
 */
const exportRows = async (clientId, query = {}) => {
    const rows = await EventGuest.findAll({
        where: buildWhere(clientId, query),
        attributes: GUEST_ATTRS,
        include: INCLUDE,
        order: [
            [literal('`EventGuest`.`responded_at` IS NULL'), 'ASC'],
            ['responded_at', 'DESC'],
        ],
        // A cap, stated rather than silent — a truncated export that looks
        // complete is worse than one that says where it stopped.
        limit: 5000,
    });

    return {
        rows: rows.map(shape),
        count: rows.length,
        truncated: rows.length >= 5000,
        stats: await getStats(clientId, query),
    };
};

module.exports = {
    list,
    getStats,
    getById,
    update,
    resetResponse,
    getGroup,
    moveToGroup,
    exportRows,
    BUCKET,
    RESPONSE_TYPES,
};
