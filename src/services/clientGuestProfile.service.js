const {
    Sequelize,
    Event,
    EventParticipant,
    GuestNote,
    GuestTag,
    GuestReminder,
    EventParticipantResponseLog,
    EventMessage,
    WebsiteClient,
    Guest,
} = require('../models');
const { Op } = Sequelize;
const ApiError = require('../utils/apiError');

/**
 * Guest Profile — the person, not the invitation.
 *
 * ── ⚠ HOW THIS DIFFERS FROM THE RSVP DETAIL ─────────────────────────────────
 * `clientRsvp.service` answers "what did this guest say about THIS event". A
 * guest row is per-event, so that is one row.
 *
 * This module answers "who is this PERSON across every event". Since §581 the
 * person IS a row: the phone-book guest (`guests`). Their events are
 * the participations linked to it by `guest_id` — set when their mobile joins
 * an event by scanning its QR. The old stitch matched every guest row sharing
 * an EMAIL, which a typo split in two and a shared family address merged into
 * one; that guesswork is gone.
 *
 * ── NOTES ARE NOT `event_participants`.`notes` ────────────────────────────────────
 * That column is what the GUEST said with their response. `guest_notes`
 * is what the HOST wrote about them. Both appear on the profile, in different
 * places, and must never be merged — the reader needs to know which of the two
 * a sentence came from.
 */

/* ── Ownership ───────────────────────────────────────────────────────────── */

/**
 * The guest this profile is anchored to (§581).
 *
 * Scoped by client, so "not found" and "not yours" are the same answer —
 * distinguishing them would confirm a guest exists on somebody else's account.
 */
const own = async (clientId, id) => {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) throw ApiError.notFound('Guest not found.');

    const guest = await Guest.findOne({
        where: { id: numeric, website_client_id: clientId },
        include: [{ association: 'group', attributes: ['id', 'name', 'color'], required: false }],
    });
    if (!guest) throw ApiError.notFound('Guest not found.');
    return guest;
};

/** The participant rows that ARE this guest — one per event they joined. */
const participationIds = async (clientId, guest) => {
    const rows = await EventParticipant.findAll({
        where: { website_client_id: clientId, guest_id: guest.id },
        attributes: ['id'],
    });
    return rows.map((r) => r.id);
};

/* ── Tags ────────────────────────────────────────────────────────────────── */

/**
 * A stable colour for a tag that has none.
 *
 * Derived from the LABEL, so "Family" is the same colour on the profile, in a
 * list and in a filter chip without anything being stored. A colour saved per
 * row would let the same tag come out differently on two screens.
 */
const TAG_TINTS = ['violet', 'emerald', 'blue', 'amber', 'pink', 'cyan'];
const tintFor = (label) => {
    let hash = 0;
    for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    return TAG_TINTS[hash % TAG_TINTS.length];
};

const shapeTag = (t) => ({
    id: t.id,
    label: t.label,
    color: t.color || null,
    /* Always present, so no screen has to own the fallback. */
    tint: t.color ? null : tintFor(t.label),
});

/* ── Notes ───────────────────────────────────────────────────────────────── */

const NOTE_CATEGORIES = ['general', 'personal', 'dietary', 'communication', 'reminder', 'logistics'];
const NOTE_VISIBILITY = ['internal', 'shared'];

const shapeNote = (n, authorName) => ({
    id: n.id,
    title: n.title,
    /* HTML. Every screen printing this must use dangerouslySetInnerHTML —
       splitting it as plain text renders the tags to the reader. */
    body: n.body || '',
    category: n.category,
    visibility: n.visibility,
    is_pinned: !!n.is_pinned,
    created_at: n.created_at,
    updated_at: n.updated_at,
    /* Was it edited after it was written? The design prints one date; this
       lets the screen say "edited" rather than showing a date that silently
       moved. Second-level compare: the two are equal on insert. */
    edited: !!(n.updated_at && n.created_at
        && new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 1000),
    author: n.created_by_client_id ? authorName : null,
});

/* ── Reminders ───────────────────────────────────────────────────────────── */

const shapeReminder = (r) => ({
    id: r.id,
    note_id: r.note_id,
    title: r.title,
    due_at: r.due_at,
    status: r.status,
    completed_at: r.completed_at,
    /*
      ⚠ Derived at READ time, never stored. "Upcoming" is a fact about `due_at`
      versus now, and a stored one becomes a lie the moment the date passes.
    */
    state: GuestReminder.derive(r),
});

/* ── The profile ─────────────────────────────────────────────────────────── */

/**
 * Everything the six tabs need, in one request.
 *
 * One call rather than six: the tabs share the header, and six endpoints would
 * let the header disagree with itself as each resolved. The payload is bounded
 * — every list here is capped — so this stays one round trip rather than
 * growing into a page load.
 */
const getProfile = async (clientId, id) => {
    const guest = await own(clientId, id);
    const ids = await participationIds(clientId, guest);

    const [siblings, messages, history, notes, tags, reminders, account] = await Promise.all([
        /* Linked Events — the events this person joined. */
        EventParticipant.findAll({
            where: { website_client_id: clientId, id: { [Op.in]: ids } },
            attributes: [
                'id', 'event_id', 'rsvp_status', 'response_type', 'responded_at',
                'party_size', 'invited_at', 'group_id', 'accommodation', 'dietary_preference',
            ],
            include: [
                { association: 'event', attributes: ['id', 'name', 'start_date', 'start_time', 'venue_name'], required: false },
                { association: 'group', attributes: ['id', 'name'], required: false },
            ],
            order: [['id', 'DESC']],
            limit: 50,
        }),
        /*
          Invitation History spans every sibling row, which is what makes the
          tab say "across your events" truthfully. Scoped by client as well as
          by guest id — belt and braces, since `ids` is already client-scoped.
        */
        EventMessage.findAll({
            where: { website_client_id: clientId, participant_id: { [Op.in]: ids } },
            attributes: [
                'id', 'participant_id', 'event_id', 'channel', 'kind', 'status',
                'sent_at', 'delivered_at', 'opened_at', 'clicked_at',
                'sender', 'sender_client_id', 'created_at',
            ],
            include: [{ association: 'event', attributes: ['id', 'name', 'start_date'], required: false }],
            order: [['created_at', 'DESC']],
            limit: 100,
        }),
        EventParticipantResponseLog.findAll({
            where: { website_client_id: clientId, participant_id: { [Op.in]: ids } },
            include: [{ association: 'event', attributes: ['id', 'name', 'start_date'], required: false }],
            order: [['changed_at', 'DESC'], ['id', 'DESC']],
            limit: 100,
        }),
        /* Pinned first, then newest — the index is exactly this ORDER BY. */
        GuestNote.findAll({
            where: { website_client_id: clientId, guest_id: guest.id },
            order: [['is_pinned', 'DESC'], ['created_at', 'DESC']],
            limit: 100,
        }),
        GuestTag.findAll({
            where: { website_client_id: clientId, guest_id: guest.id },
            order: [['created_at', 'ASC']],
            limit: 50,
        }),
        GuestReminder.findAll({
            where: { website_client_id: clientId, guest_id: guest.id },
            order: [['due_at', 'ASC']],
            limit: 50,
        }),
        WebsiteClient.findByPk(clientId, { attributes: ['id', 'name'] }),
    ]);

    const authorName = account ? account.name : null;

    /*
      Deduplicated by label — a safety net; tags now live on the guest, so
      one person carries a label once.
    */
    const seenTags = new Set();
    const uniqueTags = [];
    for (const t of tags) {
        if (seenTags.has(t.label)) continue;
        seenTags.add(t.label);
        uniqueTags.push(shapeTag(t));
    }

    /* Last Contact: the most recent thing actually SENT, not merely written. */
    const lastContact = messages
        .map((m) => m.sent_at || m.created_at)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0] || null;

    const g = guest.toJSON();
    // Answers about ONE event belong to a participation; the header shows the
    // most recent event's, or nothing when the person has joined none.
    const latest = siblings[0] ? siblings[0].toJSON() : null;

    return {
        guest: {
            id: g.id,
            name: g.name,
            first_name: g.first_name,
            last_name: g.last_name,
            title: g.title,
            email: g.email,
            dial_code: g.dial_code,
            mobile: g.mobile,
            whatsapp: g.whatsapp,
            company: g.company,
            table_number: latest?.table_number ?? null,
            photo: g.photo || null,
            relationship: g.relationship || null,
            accommodation: latest?.accommodation || 'unknown',
            location: [g.city, g.state, g.country].filter(Boolean).join(', ') || null,
            city: g.city,
            state: g.state,
            country: g.country,
            group: g.group ? { id: g.group.id, name: g.group.name, color: g.group.color } : null,
            rsvp_status: latest?.rsvp_status ?? null,
            response_type: latest?.response_type ?? null,
            responded_at: latest?.responded_at ?? null,
            invited_at: latest?.invited_at ?? null,
            party_size: latest?.party_size ?? null,
            dietary_preference: g.dietary_preference,
            special_requirements: g.special_requirements,
            /* The guest's OWN note, kept distinct from `notes[]` below. */
            response_note: g.notes || null,
            custom_answers: latest?.custom_answers || null,
            created_at: g.created_at,
        },
        event: latest?.event || null,

        /**
         * How this profile was assembled, said out loud.
         *
         * The screen prints this. A profile stitched from an email match can be
         * wrong in two directions and the reader is the only one who can tell —
         * so they are told what the stitch was, rather than being handed a
         * confident-looking page.
         */
        identity: {
            linked_by: 'guest',
            email: g.email || null,
            guest_row_ids: ids,
            events_invited: siblings.length,
            note: siblings.length
                ? 'Events this guest joined by scanning the invitation QR with their mobile number.'
                : 'This guest has not joined any event yet. Share an invitation with them — '
                + 'when they scan its QR with this mobile number, the event appears here.',
        },

        summary: {
            events_invited: siblings.length,
            last_contact: lastContact,
            total_messages: messages.length,
            /*
              ⚠ Counted from `opened_at`, which only a real provider ever sets.
              With none connected this is 0 for everybody — correct, and NOT a
              bug to be "fixed" by counting sends instead.
            */
            opened: messages.filter((m) => m.opened_at).length,
            delivered: messages.filter((m) => m.status === 'delivered').length,
            pending: messages.filter((m) => m.status === 'queued').length,
            notes: notes.length,
            reminders_open: reminders.filter((r) => r.status === 'pending').length,
        },

        linked_events: siblings.map((sg) => ({
            id: sg.id,
            is_current: false,
            rsvp_status: sg.rsvp_status,
            response_type: sg.response_type,
            responded_at: sg.responded_at,
            invited_at: sg.invited_at,
            /* "Not sent yet" is a real state and reads differently from
               "sent, no reply" — the design draws them the same and should not. */
            invitation_sent: !!sg.invited_at,
            party_size: sg.party_size,
            accommodation: sg.accommodation,
            dietary_preference: sg.dietary_preference,
            group: sg.group ? { id: sg.group.id, name: sg.group.name } : null,
            event: sg.event || null,
        })),

        messages: messages.map((m) => ({
            id: m.id,
            guest_id: m.participant_id,
            channel: m.channel,
            kind: m.kind,
            status: m.status,
            sent_at: m.sent_at,
            delivered_at: m.delivered_at,
            opened_at: m.opened_at,
            /* The Sender column. An ACTOR, not a user — one login per account. */
            sender: m.sender,
            sender_name: m.sender === 'client' ? authorName : 'System',
            event: m.event ? { id: m.event.id, name: m.event.name, start_date: m.event.start_date } : null,
        })),

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
            is_first: h.from_response_type === null,
            event: h.event ? { id: h.event.id, name: h.event.name, start_date: h.event.start_date } : null,
        })),

        notes: notes.map((n) => shapeNote(n, authorName)),
        tags: uniqueTags,
        reminders: reminders.map(shapeReminder),

        /*
          Still true after Phase 3. `custom_answers` holds JSON but nothing
          defines what the QUESTIONS are, so an answer cannot be labelled —
          which is a missing definition, not a missing column, and no table
          added here fixes it.
        */
        unavailable: {
            custom_questions: 'No custom questions are defined for this event, so stored answers cannot be labelled.',
        },
    };
};

/* ── Notes CRUD ──────────────────────────────────────────────────────────── */

const createNote = async (clientId, guestId, body = {}) => {
    const guest = await own(clientId, guestId);

    /*
      ⚠ typeof, not just falsy. `String({})` is the literal text
      "[object Object]" and `String([1,2])` is "1,2" — either would have been
      silently ACCEPTED and stored as garbage before this check existed. A
      title has to already BE text; nothing here should be guessing what the
      caller meant by an object.
    */
    if (typeof body.title !== 'string' || !body.title.trim()) {
        throw ApiError.badRequest('A note needs a title.');
    }
    const title = body.title.trim().slice(0, 150);

    if (body.body !== undefined && body.body !== null && typeof body.body !== 'string') {
        throw ApiError.badRequest('Note content must be text.');
    }

    const category = NOTE_CATEGORIES.includes(body.category) ? body.category : 'general';
    const visibility = NOTE_VISIBILITY.includes(body.visibility) ? body.visibility : 'internal';

    const note = await GuestNote.create({
        website_client_id: clientId,
        guest_id: guest.id,
        title,
        body: body.body || null,
        category,
        visibility,
        is_pinned: body.is_pinned ? 1 : 0,
        created_by_client_id: clientId,
    });

    return { id: note.id };
};

const updateNote = async (clientId, guestId, noteId, body = {}) => {
    await own(clientId, guestId);

    const note = await GuestNote.findOne({
        where: { id: Number(noteId), website_client_id: clientId, guest_id: Number(guestId) },
    });
    if (!note) throw ApiError.notFound('Note not found.');

    const data = {};
    if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
            throw ApiError.badRequest('A note needs a title.');
        }
        data.title = body.title.trim().slice(0, 150);
    }
    if (body.body !== undefined) {
        if (body.body !== null && typeof body.body !== 'string') {
            throw ApiError.badRequest('Note content must be text.');
        }
        data.body = body.body || null;
    }
    if (body.category !== undefined) {
        if (!NOTE_CATEGORIES.includes(body.category)) throw ApiError.badRequest('Invalid category.');
        data.category = body.category;
    }
    if (body.visibility !== undefined) {
        if (!NOTE_VISIBILITY.includes(body.visibility)) throw ApiError.badRequest('Invalid visibility.');
        data.visibility = body.visibility;
    }
    if (body.is_pinned !== undefined) data.is_pinned = body.is_pinned ? 1 : 0;

    if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update.');
    await note.update(data);
    return { id: note.id };
};

const deleteNote = async (clientId, guestId, noteId) => {
    await own(clientId, guestId);
    const note = await GuestNote.findOne({
        where: { id: Number(noteId), website_client_id: clientId, guest_id: Number(guestId) },
    });
    if (!note) throw ApiError.notFound('Note not found.');
    /*
      Soft delete (paranoid). A reminder pointing at this note is SET NULL by
      the schema rather than removed — it still names a real task on a real
      date, and deleting a note should not silently cancel one.
    */
    await note.destroy();
    return { id: note.id };
};

/* ── Tags ────────────────────────────────────────────────────────────────── */

const addTag = async (clientId, guestId, body = {}) => {
    const guest = await own(clientId, guestId);

    if (typeof body.label !== 'string' || !body.label.trim()) {
        throw ApiError.badRequest('A tag needs a label.');
    }
    const label = body.label.trim().slice(0, 60);

    if (body.color !== undefined && body.color !== null && typeof body.color !== 'string') {
        throw ApiError.badRequest('Tag colour must be text.');
    }

    /*
      ⚠ Restore before insert. The unique key includes `deleted_at`, so a
      previously removed tag leaves a soft-deleted row behind; inserting a
      second one would give the guest the same label twice, both live.
    */
    const existing = await GuestTag.findOne({
        where: { guest_id: guest.id, label },
        paranoid: false,
    });
    if (existing) {
        if (!existing.deleted_at) throw ApiError.badRequest('That tag is already on this guest.');
        await existing.restore();
        return { id: existing.id };
    }

    const tag = await GuestTag.create({
        website_client_id: clientId,
        guest_id: guest.id,
        label,
        color: body.color ? body.color.slice(0, 9) : null,
    });
    return { id: tag.id };
};

const removeTag = async (clientId, guestId, tagId) => {
    await own(clientId, guestId);
    const tag = await GuestTag.findOne({
        where: { id: Number(tagId), website_client_id: clientId, guest_id: Number(guestId) },
    });
    if (!tag) throw ApiError.notFound('Tag not found.');
    await tag.destroy();
    return { id: tag.id };
};

/* ── Reminders ───────────────────────────────────────────────────────────── */

const REMINDER_STATUS = ['pending', 'done', 'dismissed'];

const createReminder = async (clientId, guestId, body = {}) => {
    const guest = await own(clientId, guestId);

    if (typeof body.title !== 'string' || !body.title.trim()) {
        throw ApiError.badRequest('A reminder needs a title.');
    }
    const title = body.title.trim();

    const dueAt = body.due_at ? new Date(body.due_at) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) throw ApiError.badRequest('A reminder needs a valid date.');
    /*
      ⚠ REFUSED in the past, the same rule the message scheduler uses. Nothing
      fires these, so a past reminder would be created already overdue and
      never announce itself — a task the system silently failed at from the
      moment it was made.
    */
    if (dueAt.getTime() < Date.now()) throw ApiError.badRequest('That reminder date has already passed.');

    let noteId = null;
    if (body.note_id) {
        const note = await GuestNote.findOne({
            where: { id: Number(body.note_id), website_client_id: clientId, guest_id: guest.id },
            attributes: ['id'],
        });
        if (!note) throw ApiError.badRequest('That note is not on this guest.');
        noteId = note.id;
    }

    const reminder = await GuestReminder.create({
        website_client_id: clientId,
        guest_id: guest.id,
        note_id: noteId,
        title: title.slice(0, 150),
        due_at: dueAt,
        created_by_client_id: clientId,
    });
    return { id: reminder.id };
};

const updateReminder = async (clientId, guestId, reminderId, body = {}) => {
    await own(clientId, guestId);
    const reminder = await GuestReminder.findOne({
        where: { id: Number(reminderId), website_client_id: clientId, guest_id: Number(guestId) },
    });
    if (!reminder) throw ApiError.notFound('Reminder not found.');

    const data = {};
    if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
            throw ApiError.badRequest('A reminder needs a title.');
        }
        data.title = body.title.trim().slice(0, 150);
    }
    if (body.due_at !== undefined) {
        const dueAt = new Date(body.due_at);
        if (Number.isNaN(dueAt.getTime())) throw ApiError.badRequest('Invalid reminder date.');
        data.due_at = dueAt;
    }
    if (body.status !== undefined) {
        if (!REMINDER_STATUS.includes(body.status)) throw ApiError.badRequest('Invalid reminder status.');
        data.status = body.status;
        /* Stamped when it is finished and cleared when it is reopened, so
           "completed on" can never name a moment that was undone. */
        data.completed_at = body.status === 'done' ? new Date() : null;
    }

    if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update.');
    await reminder.update(data);
    return { id: reminder.id };
};

const deleteReminder = async (clientId, guestId, reminderId) => {
    await own(clientId, guestId);
    const reminder = await GuestReminder.findOne({
        where: { id: Number(reminderId), website_client_id: clientId, guest_id: Number(guestId) },
    });
    if (!reminder) throw ApiError.notFound('Reminder not found.');
    await reminder.destroy();
    return { id: reminder.id };
};

/* ── Profile fields the RSVP form does not own ───────────────────────────── */

/**
 * Photo and relationship.
 *
 * ⚠ Deliberately NOT name / email / phone. Those belong to the Guests form —
 * the same rule the RSVP edit screen follows. Two screens writing the same
 * columns under two sets of validation is how a mobile number ends up valid on
 * one and rejected on the other.
 */
const updateProfile = async (clientId, guestId, body = {}) => {
    const guest = await own(clientId, guestId);

    const data = {};
    if (body.photo !== undefined) {
        if (body.photo !== null && typeof body.photo !== 'string') {
            throw ApiError.badRequest('Photo must be a URL string.');
        }
        data.photo = body.photo ? body.photo.slice(0, 500) : null;
    }
    if (body.relationship !== undefined) {
        if (body.relationship !== null && typeof body.relationship !== 'string') {
            throw ApiError.badRequest('Relationship must be text.');
        }
        data.relationship = body.relationship ? body.relationship.trim().slice(0, 60) : null;
    }

    if (!Object.keys(data).length) throw ApiError.badRequest('Nothing to update.');
    await guest.update(data);
    return getProfile(clientId, guestId);
};

module.exports = {
    getProfile,
    updateProfile,
    createNote,
    updateNote,
    deleteNote,
    addTag,
    removeTag,
    createReminder,
    updateReminder,
    deleteReminder,
};
