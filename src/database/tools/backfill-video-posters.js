#!/usr/bin/env node
/**
 * Give every gallery item without a grid picture one, stored next to it and
 * saved in `event_gallery_items.thumbnail_url`:
 *   video → its first frame as a JPEG (the poster)
 *   photo → a ~480 px JPEG copy (the full photo is up to 2 MB; grids, covers
 *           and lists load this instead)
 *
 * New uploads get theirs in `clientGallery.service.uploadItem`; this is for
 * the items uploaded before that existed. (Kept the old file name — it began
 * as the video-only poster backfill.)
 *
 *   node src/database/tools/backfill-video-posters.js
 *   node src/database/tools/backfill-video-posters.js --apply
 *   node src/database/tools/backfill-video-posters.js --prod
 *   node src/database/tools/backfill-video-posters.js --prod --apply
 *
 * Dry runs by default. Re-running skips items that already have one.
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
const { imageThumb } = require('../../services/clientGallery.service');
const { videoPoster } = require('../../utils/videoProcess');

(async () => {
    console.log(`\n${PROD ? 'PRODUCTION' : 'LOCAL'}  ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    console.log(APPLY ? 'MODE: APPLY\n' : 'MODE: DRY RUN (add --apply to write)\n');

    const rows = await EventGalleryItem.findAll({
        where: { thumbnail_url: null },
        attributes: ['id', 'event_id', 'type', 'url', 'file_name', 'company_id'],
        order: [['id', 'ASC']],
    });
    const videos = rows.filter((r) => r.type === 'video').length;
    console.log(`${rows.length} item(s) without a grid picture (${rows.length - videos} photo, ${videos} video)`);

    let done = 0;
    for (const v of rows) {
        if (!APPLY) { console.log(`  would add  #${v.id}  ${v.type}  ${v.url}`); continue; }
        try {
            // The local driver stores relative /uploads/… URLs — read those from disk.
            let bytes;
            if (v.url.startsWith('/uploads/')) {
                bytes = require('fs').readFileSync(path.join(__dirname, '..', '..', '..', v.url.split('?')[0]));
            } else {
                const res = await fetch(v.url);
                if (!res.ok) throw new Error(`download HTTP ${res.status}`);
                bytes = Buffer.from(await res.arrayBuffer());
            }
            const jpeg = v.type === 'video' ? await videoPoster(bytes) : await imageThumb(bytes);
            if (!jpeg) throw new Error('no picture could be made');
            const base = (v.file_name || `${v.type}-${v.id}`).replace(/\.[^.]+$/, '');
            const stored = await mediaService.upload(
                {
                    buffer: jpeg, size: jpeg.length, mimetype: 'image/jpeg',
                    originalname: `${base}-${v.type === 'video' ? 'poster' : 'thumb'}.jpg`,
                },
                { folder: `event-gallery/${v.event_id}` },
                v.company_id || 1
            );
            if (!stored?.url) throw new Error('upload returned no url');
            await EventGalleryItem.update({ thumbnail_url: stored.url }, { where: { id: v.id } });
            console.log(`  added  #${v.id}  ${v.type}  ${Math.round(jpeg.length / 1024)} KB`);
            done++;
        } catch (e) {
            console.log(`  FAILED #${v.id}: ${e.message}`);
        }
    }

    if (APPLY) console.log(`\n${done}/${rows.length} added`);
    await sequelize.close();
    process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
