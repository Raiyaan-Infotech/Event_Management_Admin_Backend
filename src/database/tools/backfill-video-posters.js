#!/usr/bin/env node
/**
 * Give every gallery VIDEO that has no poster one: its first frame as a JPEG,
 * stored next to the video, saved in `event_gallery_items.thumbnail_url`.
 *
 * New uploads get their poster in `clientGallery.service.uploadItem`; this is
 * for the videos uploaded before that existed.
 *
 *   node src/database/tools/backfill-video-posters.js
 *   node src/database/tools/backfill-video-posters.js --apply
 *   node src/database/tools/backfill-video-posters.js --prod
 *   node src/database/tools/backfill-video-posters.js --prod --apply
 *
 * Dry runs by default. Re-running skips videos that already have a poster.
 */

const path = require('path');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD = args.includes('--prod');

// Env BEFORE the models load — they read DB_* at require time.
require('dotenv').config();
if (PROD) {
    require('dotenv').config({
        path: path.join(__dirname, '..', '..', '..', '.env.production'),
        override: true,
    });
}

const { EventGalleryItem, sequelize } = require('../../models');
const mediaService = require('../../services/media.service');
const { videoPoster } = require('../../utils/videoDenoise');

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    const videos = await EventGalleryItem.findAll({
        where: { type: 'video', thumbnail_url: null },
        attributes: ['id', 'event_id', 'url', 'file_name', 'company_id'],
        order: [['id', 'ASC']],
    });
    console.log(`${videos.length} video(s) without a poster`);

    let done = 0;
    for (const v of videos) {
        if (!APPLY) { console.log(`  would add  #${v.id}  ${v.url}`); continue; }
        try {
            const res = await fetch(v.url);
            if (!res.ok) throw new Error(`download HTTP ${res.status}`);
            const jpeg = await videoPoster(Buffer.from(await res.arrayBuffer()));
            if (!jpeg) throw new Error('no frame could be read');
            const base = (v.file_name || `video-${v.id}`).replace(/\.[^.]+$/, '');
            const stored = await mediaService.upload(
                { buffer: jpeg, size: jpeg.length, mimetype: 'image/jpeg', originalname: `${base}-poster.jpg` },
                { folder: `event-gallery/${v.event_id}` },
                v.company_id || 1
            );
            if (!stored?.url) throw new Error('upload returned no url');
            await EventGalleryItem.update({ thumbnail_url: stored.url }, { where: { id: v.id } });
            console.log(`  added  #${v.id}  ${stored.url}`);
            done++;
        } catch (e) {
            console.log(`  FAILED #${v.id}: ${e.message}`);
        }
    }

    if (APPLY) console.log(`\n${done}/${videos.length} poster(s) added`);
    await sequelize.close();
    process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
