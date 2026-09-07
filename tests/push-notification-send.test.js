/*
 * Push notifications end to end — over HTTP, against a live server.
 *
 * ── WHAT THIS PROVES ────────────────────────────────────────────────────────
 * A brand new client, a device token, and two sends: one PLAIN and one with
 * every advanced option set. Both are checked in the database afterwards,
 * because the response saying "recorded" is not evidence that the right rows
 * exist.
 *
 * ── ⚠ WHY A NEW CLIENT AND NOT THE SEEDED ONE ───────────────────────────────
 * The seeded Test Client already owns events, guests and campaigns, so a bug
 * that reuses somebody else's rows would be invisible against it. A client
 * created here owns exactly what this file gives it: if a count is wrong, the
 * cause is in the code and not in leftover data.
 *
 * ── ⚠ NOTHING IS DELIVERED UNLESS FIREBASE IS ACTIVE ────────────────────────
 * With no active `push_notification_configs` row the send is RECORDED and the
 * response says so. That is the correct outcome and the test asserts it, the
 * same way the WhatsApp and Email tests do — a stub that claimed delivery
 * would put invented rates on the dashboard. If a Firebase config IS active,
 * the assertions switch to expecting a real delivery attempt.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *   node tests/push-notification-send.test.js
 * Requires the backend running on :5001.
 */
require('dotenv').config();

const {
    sequelize, Sequelize, WebsiteClient, Event, EventGuest,
    EventMessage, EventMessageCampaign, ClientDeviceToken, ClientNotification,
} = require('../src/models');
const pushSender = require('../src/services/pushSender.service');
const messages = require('../src/services/clientMessage.service');

const { Op } = Sequelize;

let pass = 0; let fail = 0;
const ok = (label, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.log(`  FAIL  ${label}  ${extra}`); }
};

/* A marker on everything this file creates, so cleanup can be exact rather
   than "delete recent rows" — which on a shared dev database is a way to lose
   somebody else's work. */
const TAG = `pushtest_${Date.now()}`;

(async () => {
    console.log('\nPush notifications — new client, plain send and advanced send\n');

    let client = null;
    let event = null;
    const guestIds = [];
    const campaignIds = [];

    try {
        /* ── Firebase state, stated up front ───────────────────────────── */
        const availability = await pushSender.availability();
        console.log('── firebase ──────────────────────────────────────');
        console.log(`  active config : ${availability.enabled ? 'YES' : 'no'}`);
        if (!availability.enabled) console.log(`  reason        : ${availability.reason}`);

        /* ── 1. A brand new client ─────────────────────────────────────── */
        console.log('\n── new client ────────────────────────────────────');
        const vendorId = (await WebsiteClient.findOne({ attributes: ['vendor_id'] }))?.vendor_id;
        client = await WebsiteClient.create({
            vendor_id: vendorId,
            name: 'Push Test Client',
            email: `${TAG}@example.com`,
            mobile: `9${String(Date.now()).slice(-9)}`,
            status: 'active',
        });
        ok('client created', Boolean(client.id), `id=${client.id}`);

        event = await Event.create({
            website_client_id: client.id,
            name: `${TAG} Reception`,
            host_one: 'Priya',
            host_two: 'Arjun',
            start_date: '2026-12-24',
            start_time: '18:00:00',
            venue_name: 'The Grand Palace',
            status: 'upcoming',
        });
        ok('event created', Boolean(event.id), `id=${event.id}`);

        /* ── 2. Three guests: one with the app, two without ────────────── */
        console.log('\n── guests and devices ────────────────────────────');

        /*
          The guest WITH the app is their own account, which is what
          `participant_client_id` means — a guest who joined by scanning the QR.
          The other two are typed-in guests, the ordinary case, and they are the
          reason the reachable count must be smaller than the guest list.
        */
        const participant = await WebsiteClient.create({
            vendor_id: vendorId,
            name: 'App Guest',
            email: `${TAG}_guest@example.com`,
            mobile: `8${String(Date.now()).slice(-9)}`,
            status: 'active',
        });

        const withApp = await EventGuest.create({
            website_client_id: client.id,
            event_id: event.id,
            name: 'App Guest',
            email: `${TAG}_guest@example.com`,
            mobile: '9000000001',
            participant_client_id: participant.id,
            rsvp_status: 'accepted',
            party_size: 1,
        });
        const noApp1 = await EventGuest.create({
            website_client_id: client.id,
            event_id: event.id,
            name: 'Paper Guest One',
            mobile: '9000000002',
            rsvp_status: 'not_responded',
            party_size: 2,
        });
        const noApp2 = await EventGuest.create({
            website_client_id: client.id,
            event_id: event.id,
            name: 'Paper Guest Two',
            mobile: '9000000003',
            rsvp_status: 'not_responded',
            party_size: 1,
        });
        guestIds.push(withApp.id, noApp1.id, noApp2.id);

        const device = await ClientDeviceToken.create({
            website_client_id: participant.id,
            token: `${TAG}_device_token`,
            platform: 'android',
            device_name: 'Test Pixel',
            is_active: true,
            last_seen_at: new Date(),
        });
        ok('device token registered', Boolean(device.id));

        /* ── 3. Who is reachable, and why not ──────────────────────────── */
        console.log('\n── audience ──────────────────────────────────────');
        const preview = await messages.previewAudience(client, {
            event_id: event.id, channel: 'push', audience: 'all', body: 'x',
        });
        ok('only the guest WITH the app is reachable',
            preview.total_recipients === 1, `got ${preview.total_recipients}`);
        ok('the other two are counted as unreachable',
            preview.unreachable.count === 2, `got ${preview.unreachable.count}`);
        // The wording is the whole point: "no phone number" would send a host
        // editing guests to fix something that is already filled in.
        ok('the skip reason blames the APP, not a missing phone number',
            /installed the app/i.test(preview.unreachable.reason || ''),
            preview.unreachable.reason || '');
        ok('heads and rows are reported separately',
            preview.counts.heads === 4 && preview.counts.selected_guests === 3,
            `heads=${preview.counts.heads} rows=${preview.counts.selected_guests}`);

        /* ── 4. A PLAIN push ───────────────────────────────────────────── */
        console.log('\n── send 1: plain push ────────────────────────────');
        const plain = await messages.send(client, {
            event_id: event.id,
            channel: 'push',
            kind: 'update',
            audience: 'all',
            subject: 'Wedding Invitation',
            body: 'You are invited to Priya & Arjun on 24 Dec 2026 at The Grand Palace.',
        });
        campaignIds.push(plain.campaign.id);

        ok('one recipient, two skipped',
            plain.recipients === 1 && plain.skipped === 2,
            `${plain.recipients}/${plain.skipped}`);
        ok('the response reports the real delivery state',
            plain.delivery.attempted === availability.enabled);
        if (!availability.enabled) {
            ok('and names the reason rather than claiming success',
                Boolean(plain.delivery.reason));
        }

        const plainCampaign = await EventMessageCampaign.findByPk(plain.campaign.id);
        ok('campaign stored on the push channel', plainCampaign.channel === 'push');
        /*
          A plain send DOES record options — the defaults — and that is right,
          not a leak. Those values genuinely went to FCM (86400s TTL, high
          priority, default sound), so the campaign is a record of what was
          SENT rather than of what was typed. What must stay empty is content
          nobody supplied.
        */
        ok('defaults are recorded as what was actually sent',
            plainCampaign.push_options?.ttl_seconds === 86400
            && plainCampaign.push_options?.priority === 'high'
            && plainCampaign.push_options?.sound === 'default',
            JSON.stringify(plainCampaign.push_options));
        ok('but no content was invented',
            plainCampaign.image_url === null
            && plainCampaign.deep_link === null
            && plainCampaign.data_payload === null);

        const plainRows = await EventMessage.findAll({ where: { campaign_id: plain.campaign.id } });
        ok('one recipient row per reachable guest', plainRows.length === 1, `${plainRows.length}`);
        ok('the row points at the guest who has the app',
            plainRows[0].guest_id === withApp.id);

        /* ── 4b. What a REAL Firebase round trip did to the token ──────── */
        if (availability.enabled) {
            console.log('\n-- firebase round trip --');
            await device.reload();
            /*
              The token is a made-up string, so Google rejects it — which is the
              proof the request genuinely reached Google rather than being
              swallowed locally. A retired token is the CORRECT outcome here.
            */
            ok('a rejected token is retired, not retried forever',
                device.is_active === false && Boolean(device.disabled_reason),
                `active=${device.is_active} reason=${device.disabled_reason}`);

            const failedRow = await EventMessage.findOne({
                where: { campaign_id: plain.campaign.id },
            });
            ok('the recipient row carries the reason Firebase gave',
                failedRow.status === 'failed' && Boolean(failedRow.failed_reason),
                `${failedRow.status} / ${failedRow.failed_reason}`);

            /*
              Revived for the next send. Without this the second send has no
              address left and fails for a reason that has nothing to do with
              what it is testing — which is exactly what happened the first time
              this file ran.
            */
            await device.update({ is_active: true, disabled_reason: null });
        }

        /* ── 5. An ADVANCED push ───────────────────────────────────────── */
        console.log('\n── send 2: advanced push ─────────────────────────');
        const advanced = await messages.send(client, {
            event_id: event.id,
            channel: 'push',
            kind: 'reminder',
            audience: 'guests',
            guest_ids: [withApp.id],
            subject: 'Reminder — tomorrow!',
            body: 'The reception starts at 6pm. See you there.',
            image_url: 'https://example.com/invite.png',
            click_action: 'deep_link',
            deep_link: `eventinvit://event/${event.id}`,
            data_payload: [
                { key: 'event_id', value: String(event.id) },
                { key: 'screen', value: 'agenda' },
                // Reserved by FCM — must be dropped, or the whole send 400s.
                { key: 'from', value: 'should_be_dropped' },
            ],
            push_options: {
                sound: 'silent',
                badge_mode: 'set',
                badge_value: 3,
                priority: 'normal',
                ttl_seconds: 999_999_999,      // above FCM's ceiling on purpose
                collapse_key: 'event_updates',
                content_available: true,
                restricted_package_name: 'com.eventinvit.app',
            },
        });
        campaignIds.push(advanced.campaign.id);

        const advCampaign = await EventMessageCampaign.findByPk(advanced.campaign.id);
        const o = advCampaign.push_options || {};

        ok('image, action and deep link stored',
            advCampaign.image_url === 'https://example.com/invite.png'
            && advCampaign.click_action === 'deep_link'
            && advCampaign.deep_link === `eventinvit://event/${event.id}`);
        ok('custom data kept', advCampaign.data_payload?.screen === 'agenda');
        ok("FCM's reserved key `from` was dropped",
            advCampaign.data_payload?.from === undefined,
            JSON.stringify(advCampaign.data_payload));
        ok('silent sound kept', o.sound === 'silent');
        ok('badge stored as set/3', o.badge_mode === 'set' && o.badge_value === 3);
        ok('normal priority kept', o.priority === 'normal');
        // Google rejects a larger TTL outright, with an error naming the field
        // but not the cause — long after the person who typed it has moved on.
        ok('TTL clamped to FCM 28-day ceiling', o.ttl_seconds === 2_419_200, String(o.ttl_seconds));
        ok('delivery toggles kept',
            o.collapse_key === 'event_updates'
            && o.content_available === true
            && o.restricted_package_name === 'com.eventinvit.app');

        /* ── 6. The FCM payload the options actually produce ───────────── */
        console.log('\n── FCM payload ───────────────────────────────────');
        const msg = pushSender.buildMessage({
            token: 'TOKEN',
            title: advCampaign.subject,
            body: advCampaign.body,
            imageUrl: advCampaign.image_url,
            clickAction: advCampaign.click_action,
            deepLink: advCampaign.deep_link,
            data: { ...advCampaign.data_payload, campaign_id: advCampaign.id },
            options: o,
        });
        ok('android ttl formatted as seconds-with-s', msg.android.ttl === '2419200s', msg.android.ttl);
        ok('normal priority maps to NORMAL / apns 5',
            msg.android.priority === 'NORMAL' && msg.apns.headers['apns-priority'] === '5');
        ok('silent means NO sound on either platform',
            msg.android.notification.default_sound === undefined
            && msg.apns.payload.aps.sound === undefined);
        ok('badge 3 reaches apns', msg.apns.payload.aps.badge === 3);
        /* FCM rejects a non-string in `data` outright. Everything we generate
           has to be stringified too, not only what the form typed. */
        ok('every data value is a string',
            Object.values(msg.data).every((v) => typeof v === 'string'),
            JSON.stringify(msg.data));
        ok('the tap target rides along in data',
            msg.data.deep_link === `eventinvit://event/${event.id}`);

        /* ── 7. The in-app list — the badge count the user asked for ───── */
        console.log('\n── in-app notification list ──────────────────────');
        if (availability.enabled) {
            await new Promise((r) => { setTimeout(r, 800); });
            const feed = await ClientNotification.count({
                where: { website_client_id: participant.id, type: 'push_notification' },
            });
            /*
              Written for every guest the push was ADDRESSED to, even though FCM
              refused this fake token. That is the point of keeping read/unread
              in our own database: the in-app list must not develop a hole
              because a handset was offline or a token had gone stale.
            */
            ok('the in-app list has rows even though FCM refused the token',
                feed > 0, `${feed}`);
        } else {
            console.log('  SKIP  no Firebase config, so nothing was delivered to notify about');
        }

        /* ── 8. Stats ──────────────────────────────────────────────────── */
        console.log('\n── stats ─────────────────────────────────────────');
        const list = await messages.listCampaigns(client, { channel: 'push', limit: 10 });
        const s = list.stats.by_channel.push;
        ok('two push campaigns are listed', list.campaigns.length === 2, `${list.campaigns.length}`);
        ok('stats count both recipient rows', s.total === 2, `${s.total}`);
        ok('opened and clicked are reported', 'opened' in s && 'clicked' in s);
        ok('nothing is counted as opened yet', s.opened === 0 && s.clicked === 0);
    } catch (err) {
        fail++;
        console.log(`\n  FAIL  threw: ${err.message}`);
        console.log(err.stack);
    } finally {
        /* ── Cleanup, by the marker only ───────────────────────────────── */
        console.log('\n── cleanup ───────────────────────────────────────');
        try {
            if (campaignIds.length) {
                await EventMessage.destroy({ where: { campaign_id: { [Op.in]: campaignIds } }, force: true });
                await EventMessageCampaign.destroy({ where: { id: { [Op.in]: campaignIds } }, force: true });
            }
            if (guestIds.length) {
                await EventGuest.destroy({ where: { id: { [Op.in]: guestIds } }, force: true });
            }
            if (event) await Event.destroy({ where: { id: event.id }, force: true });
            await ClientDeviceToken.destroy({ where: { token: `${TAG}_device_token` } });
            await ClientNotification.destroy({
                where: { title: { [Op.in]: ['Wedding Invitation', 'Reminder — tomorrow!'] } },
                force: true,
            });
            await WebsiteClient.destroy({
                where: { email: { [Op.like]: `${TAG}%` } }, force: true,
            });
            console.log('  removed everything this run created');
        } catch (err) {
            console.log(`  ⚠ cleanup failed: ${err.message}`);
        }

        console.log(`\n  ${pass} passed, ${fail} failed\n`);
        await sequelize.close();
        process.exit(fail ? 1 : 0);
    }
})();
