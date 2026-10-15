// node tests/gallery-image-thumb.test.js — no server; uses sharp only.
// The photo grid's thumbnail: short side 480 px, JPEG, much smaller than the
// photo, EXIF rotation applied, never enlarged.
const sharp = require('sharp');
const { imageThumb } = require('../src/services/clientGallery.service');

let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra}`); if (!ok) fail++; };

(async () => {
    // A noisy 2000 x 3000 photo (noise keeps the JPEG realistically large).
    const raw = Buffer.alloc(2000 * 3000 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251;
    const big = await sharp(raw, { raw: { width: 2000, height: 3000, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();

    const t = await imageThumb(big);
    const m = t && await sharp(t).metadata();
    check('thumb is a JPEG', !!m && m.format === 'jpeg');
    check('short side is 480, shape kept', !!m && m.width === 480 && m.height === 720, m ? `  (${m.width}x${m.height})` : '');
    check('much smaller than the photo', !!t && t.length < big.length / 4, t ? `  (${Math.round(big.length / 1024)} KB -> ${Math.round(t.length / 1024)} KB)` : '');

    // EXIF orientation 6 (rotated 90°): the thumb must come out upright.
    const rotated = await sharp(raw, { raw: { width: 2000, height: 3000, channels: 3 } })
        .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const r = await sharp(await imageThumb(rotated)).metadata();
    check('EXIF rotation applied', r.width === 720 && r.height === 480, `  (${r.width}x${r.height})`);

    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const s = await sharp(await imageThumb(small)).metadata();
    check('small photo not enlarged', s.width === 300 && s.height === 200);

    check('garbage -> null, no throw', (await imageThumb(Buffer.from('nope'))) === null);

    console.log(fail ? `${fail} FAILED` : 'ALL PASS');
    setTimeout(() => process.exit(fail ? 1 : 0), 200);
})();
