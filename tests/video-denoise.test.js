// node tests/video-denoise.test.js — no server needed; uses the bundled ffmpeg.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('ffmpeg-static');
const { denoiseVideo } = require('../src/utils/videoDenoise');

let fail = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fail++; };
const tmp = (n) => path.join(os.tmpdir(), `dn-test-${process.pid}-${n}`);
const make = (out, extra) => spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=d=3:s=160x120:r=15', ...extra, '-shortest', out]);

(async () => {
    const noisy = tmp('noisy.mp4');
    make(noisy, ['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-f', 'lavfi', '-i', 'anoisesrc=a=0.2:d=3',
        '-filter_complex', '[1][2]amix=inputs=2[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-c:a', 'aac']);
    const r = await denoiseVideo(fs.readFileSync(noisy), 'video/mp4');
    check('noisy mp4 is processed', r.applied === true && r.buffer.length > 0);
    const outF = tmp('out.mp4'); fs.writeFileSync(outF, r.buffer);
    const probe = spawnSync(ffmpeg, ['-i', outF]).stderr.toString();
    check('output keeps video + aac audio', /Video: h264/.test(probe) && /Audio: aac/.test(probe));

    const silent = tmp('silent.mp4');
    make(silent, ['-c:v', 'libx264']);
    const s = await denoiseVideo(fs.readFileSync(silent), 'video/mp4');
    check('video without audio falls back to original', s.applied === false);

    const g = await denoiseVideo(Buffer.from('not a video'), 'video/mp4');
    check('garbage falls back to original, no throw', g.applied === false);

    [noisy, outF, silent].forEach((f) => { try { fs.unlinkSync(f); } catch (_) {} });
    console.log(fail ? `${fail} FAILED` : 'ALL PASS');
    process.exit(fail ? 1 : 0);
})();
