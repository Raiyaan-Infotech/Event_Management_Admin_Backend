// node tests/video-process.test.js — no server needed; uses the bundled ffmpeg.
// Gallery video processing: untouched when nothing is needed, MUTE drops only
// the sound, an unplayable picture becomes H.264, the poster is a JPEG.
// (Noise cancellation was removed — the sound is never filtered.)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const { processVideo, videoPoster } = require('../src/utils/videoProcess');

let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra}`); if (!ok) fail++; };
const tmp = (n) => path.join(os.tmpdir(), `vp-test-${process.pid}-${n}`);
const streams = (buf) => {
    const f = tmp('probe.mp4'); fs.writeFileSync(f, buf);
    const err = spawnSync(ffmpeg, ['-hide_banner', '-i', f]).stderr.toString();
    try { fs.unlinkSync(f); } catch (_) { /* gone */ }
    return { video: (err.match(/Video: (\w+)/) || [])[1], audio: (err.match(/Audio: (\w+)/) || [])[1] || null };
};
const make = (name, vcodec, extra = []) => {
    const out = tmp(name);
    spawnSync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'testsrc=d=2:s=160x120:r=15',
        '-f', 'lavfi', '-i', 'sine=f=440:d=2',
        '-c:v', vcodec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...extra, out,
    ]);
    const buf = fs.readFileSync(out); fs.unlinkSync(out); return buf;
};

(async () => {
    const h264 = make('h264.mp4', 'libx264');

    const keep = await processVideo(h264, 'video/mp4');
    check('playable + sound on → untouched (same bytes)', keep.applied === false && keep.buffer === h264);

    const muted = await processVideo(h264, 'video/mp4', { mute: true });
    const m = streams(muted.buffer);
    check('mute → applied and muted', muted.applied && muted.muted);
    check('mute → picture kept (h264), sound gone', m.video === 'h264' && m.audio === null, `  (${m.video}/${m.audio})`);

    const hevc = make('hevc.mp4', 'libx265');
    const conv = await processVideo(hevc, 'video/mp4');
    const c = streams(conv.buffer);
    check('HEVC → H.264, sound KEPT', conv.applied && c.video === 'h264' && c.audio === 'aac', `  (${c.video}/${c.audio})`);

    const silentSrc = await processVideo(h264, 'video/mp4', { mute: true });
    const again = await processVideo(silentSrc.buffer, 'video/mp4', { mute: true });
    check('already silent + mute → untouched, reported muted', again.applied === false && again.muted === true);

    const bad = await processVideo(Buffer.from('not a video'), 'video/mp4', { mute: true });
    check('garbage → original, NOT muted (caller refuses)', bad.applied === false && bad.muted === false);

    const poster = await videoPoster(h264);
    check('poster is a JPEG', !!poster && poster[0] === 0xff && poster[1] === 0xd8);

    console.log(fail ? `${fail} FAILED` : 'ALL PASS');
    setTimeout(() => process.exit(fail ? 1 : 0), 200);
})();
