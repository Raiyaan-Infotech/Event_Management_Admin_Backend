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
 * RNNoise model "beguiling-drafter" (GregorR/rnnoise-models — README: not
 * subject to copyright): trained for voice in recorded noise, so it keeps the
 * main speaker (and laughter) and turns down chatter, crowd, clatter, traffic.
 * ffmpeg runs with cwd = this folder so the filter can name the file without a
 * Windows drive-letter path (a ":" breaks filter-argument parsing).
 */
const RNNOISE_DIR = path.join(__dirname, '../assets/rnnoise');
const RNNOISE_MODEL = 'bd.rnnn';
const hasModel = fs.existsSync(path.join(RNNOISE_DIR, RNNOISE_MODEL));

/**
 * Audio filter chain: cut rumble below 80 Hz, RNNoise (90% cleaned + 10%
 * original, so the voice never sounds robotic), then FFT-denoise whatever
 * steady hiss / hum / wind is left. Without the model file, RNNoise is skipped.
 */
const AUDIO_FILTER = [
    'highpass=f=80',
    hasModel && `arnndn=m=${RNNOISE_MODEL}:mix=0.9`,
    'afftdn=nr=12:nf=-30:tn=1',
].filter(Boolean).join(',');

/** ffmpeg exits non-zero with no output file, but prints the streams on stderr. */
const probeVideo = (file) => new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', () => resolve({}));
    child.on('close', () => {
        const m = err.match(/Video: (\w+)[^\n]*?, (yuv\w+|nv12|gbrp|rgb\w*)/);
        resolve({ codec: m && m[1], pixFmt: m && m[2] });
    });
});

const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, cwd: hasModel ? RNNOISE_DIR : undefined });
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
 * untouched when it is already universally playable (8-bit H.264), otherwise
 * re-encoded to H.264; the audio is always filtered and re-encoded.
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
        // Copy the picture ONLY when every phone can play it as-is: 8-bit 4:2:0
        // H.264 (or VP8/VP9 in webm). Anything else (HEVC / "hev1", 10-bit,
        // 4:4:4, ...) is re-encoded to plain H.264 so the result always plays.
        const { codec, pixFmt } = await probeVideo(inFile);
        const copyable = isWebm
            ? ['vp8', 'vp9'].includes(codec)
            : codec === 'h264' && pixFmt === 'yuv420p';
        const videoArgs = copyable
            ? ['-c:v', 'copy']
            : isWebm
                ? ['-c:v', 'libvpx', '-b:v', '600k', '-pix_fmt', 'yuv420p']
                : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-profile:v', 'main'];
        await run([
            '-y', '-i', inFile,
            '-map', '0:v:0', '-map', '0:a:0',
            ...videoArgs,
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

module.exports = { denoiseVideo, AUDIO_FILTER };
