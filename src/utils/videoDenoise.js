const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (_) {
    ffmpegPath = null;
}

const TIMEOUT_MS = 60 * 1000;

/**
 * Audio filter chain: cut rumble below 80 Hz, then FFT-denoise steady
 * background noise (wind, hum, crowd hiss). Voices and music are left alone.
 */
const AUDIO_FILTER = 'highpass=f=80,afftdn=nr=12:nf=-30:tn=1';

const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('ffmpeg timed out')); }, TIMEOUT_MS);
    child.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
});

/**
 * Remove background noise from a video's sound track. The picture is copied
 * untouched (no re-encode), only the audio is filtered and re-encoded.
 *
 * Never throws: on any problem (no ffmpeg, no audio track, unreadable file,
 * timeout) it returns the ORIGINAL buffer with `applied: false`, so noise
 * cancellation can never turn a good upload into a failed one.
 */
const denoiseVideo = async (buffer, mimetype) => {
    const original = { buffer, mimetype, applied: false };
    if (!ffmpegPath || !buffer || !buffer.length) return original;

    const isWebm = mimetype === 'video/webm';
    const ext = isWebm ? 'webm' : 'mp4';
    const id = crypto.randomBytes(8).toString('hex');
    const inFile = path.join(os.tmpdir(), `dn-${id}-in`);
    const outFile = path.join(os.tmpdir(), `dn-${id}-out.${ext}`);

    try {
        fs.writeFileSync(inFile, buffer);
        await run([
            '-y', '-i', inFile,
            '-map', '0:v:0', '-map', '0:a:0',
            '-c:v', 'copy',
            '-af', AUDIO_FILTER,
            ...(isWebm ? ['-c:a', 'libopus', '-b:a', '64k'] : ['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart']),
            outFile,
        ]);
        const out = fs.readFileSync(outFile);
        if (!out.length) return original;
        return { buffer: out, mimetype: isWebm ? 'video/webm' : 'video/mp4', applied: true };
    } catch (_) {
        // Includes "no audio stream": -map 0:a:0 fails, original goes up as-is.
        return original;
    } finally {
        for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    }
};

module.exports = { denoiseVideo };
