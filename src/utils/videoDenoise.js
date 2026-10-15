const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const logger = require('./logger');

// ffmpeg-static returns its path even when the download at `npm install` never
// happened, so check the file is really there; otherwise try an ffmpeg on PATH.
let staticPath = null;
try {
    staticPath = require('ffmpeg-static');
} catch (_) {
    staticPath = null;
}
let ffmpegPath = staticPath && fs.existsSync(staticPath) ? staticPath : 'ffmpeg';

/**
 * Self-repair when `npm install` skipped the binary download (e.g. a build that
 * ran with --ignore-scripts or restored a cache): run ffmpeg-static's own
 * install script once at boot, then switch to the downloaded file.
 */
const ensureBinary = () => new Promise((resolve) => {
    if (!staticPath || fs.existsSync(staticPath)) return resolve();
    logger.warn(`[videoDenoise] ffmpeg-static binary missing (${staticPath}); downloading it now`);
    const script = path.join(path.dirname(require.resolve('ffmpeg-static')), 'install.js');
    const child = spawn(process.execPath, [script], {
        cwd: path.dirname(script), windowsHide: true, env: { ...process.env, CI: '1' },
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { logger.error(`[videoDenoise] download failed: ${e.message}`); resolve(); });
    child.on('close', (code) => {
        if (fs.existsSync(staticPath)) {
            ffmpegPath = staticPath;
            logger.info('[videoDenoise] ffmpeg-static binary downloaded');
        } else {
            logger.error(`[videoDenoise] download failed (exit ${code}): ${err.slice(-300)}`);
        }
        resolve();
    });
});

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
            // Marker so a stored file shows it was cleaned (ffmpeg -i <file>).
            '-metadata', `comment=denoised:${hasModel ? 'rnnoise+afftdn' : 'afftdn'}`,
            outFile,
        ]);
        const out = fs.readFileSync(outFile);
        if (!out.length) return original;
        return { buffer: out, mimetype: isWebm ? 'video/webm' : 'video/mp4', applied: true };
    } catch (e) {
        // Includes "no audio stream": -map 0:a:0 fails, original goes up as-is.
        // Logged — a silent fallback hid that Render never ran the filter.
        logger.warn(`[videoDenoise] skipped, original kept: ${e.message}`);
        return original;
    } finally {
        for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    }
};

/**
 * The video's FIRST frame as a JPEG (max 720 px wide) — the gallery tile's
 * poster. Returns a Buffer, or null on any problem (never throws).
 */
const videoPoster = async (buffer) => {
    if (!ffmpegPath || !buffer || !buffer.length) return null;
    const id = crypto.randomBytes(8).toString('hex');
    const inFile = path.join(os.tmpdir(), `vp-${id}-in`);
    const outFile = path.join(os.tmpdir(), `vp-${id}.jpg`);
    try {
        fs.writeFileSync(inFile, buffer);
        await run([
            '-y', '-i', inFile,
            '-frames:v', '1',
            '-vf', "scale='min(720,iw)':-2",
            '-q:v', '4',
            outFile,
        ]);
        const out = fs.readFileSync(outFile);
        return out.length ? out : null;
    } catch (e) {
        logger.warn(`[videoDenoise] poster skipped: ${e.message}`);
        return null;
    } finally {
        for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch (_) { /* gone */ } }
    }
};

/**
 * Boot-time check, one log line: is ffmpeg runnable, which version, and is the
 * RNNoise model there. Read it in the Render logs after a deploy.
 */
const selfCheck = () => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-version'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => logger.error(`[videoDenoise] ffmpeg NOT runnable (${ffmpegPath}): ${e.message}`));
    child.on('close', (code) => {
        if (code !== 0) return logger.error(`[videoDenoise] ffmpeg exited ${code} on -version`);
        const version = (out.match(/ffmpeg version (\S+)/) || [])[1] || 'unknown';
        logger.info(`[videoDenoise] ffmpeg ${version} OK (${ffmpegPath}); RNNoise model ${hasModel ? 'present' : 'MISSING'}`);
    });
};
ensureBinary().then(selfCheck);

module.exports = { denoiseVideo, videoPoster, AUDIO_FILTER };
