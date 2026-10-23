const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const logger = require('./logger');

/**
 * Server-side work on an uploaded gallery video, with the bundled ffmpeg:
 *   - MUTE: the host turned the sound off on the Trim screen (WhatsApp's
 *     speaker icon) → the sound track is dropped, the picture copied untouched.
 *   - PLAYABLE: a picture every phone cannot play (HEVC "hev1", 10-bit, 4:4:4)
 *     is converted to plain H.264.
 *   - POSTER: the first frame as a JPEG, the gallery tile's picture.
 *
 * There is NO sound processing: noise cancellation was removed (Jamal,
 * 2026-10-15) — a video's sound goes up exactly as recorded.
 */

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
    logger.warn(`[video] ffmpeg-static binary missing (${staticPath}); downloading it now`);
    const script = path.join(path.dirname(require.resolve('ffmpeg-static')), 'install.js');
    const child = spawn(process.execPath, [script], {
        cwd: path.dirname(script), windowsHide: true, env: { ...process.env, CI: '1' },
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { logger.error(`[video] download failed: ${e.message}`); resolve(); });
    child.on('close', (code) => {
        if (fs.existsSync(staticPath)) {
            ffmpegPath = staticPath;
            logger.info('[video] ffmpeg-static binary downloaded');
        } else {
            logger.error(`[video] download failed (exit ${code}): ${err.slice(-300)}`);
        }
        resolve();
    });
});

const TIMEOUT_MS = 60 * 1000;

/**
 * The file's streams, read from ffmpeg's stderr (it exits non-zero with no
 * output file, but prints them): video codec + pixel format, audio codec.
 */
const probe = (file) => new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', () => resolve({}));
    child.on('close', () => {
        const v = err.match(/Video: (\w+)[^\n]*?, (yuv\w+|nv12|gbrp|rgb\w*)/);
        const a = err.match(/Audio: (\w+)/);
        const d = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
        const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
        // The picture's stored size, and the turn a phone applies when it
        // plays it ("rotate: 90" / "displaymatrix: rotation of -90.00").
        const line = (err.match(/Video: [^\n]*/) || [''])[0];
        const size = line.match(/, (\d{2,5})x(\d{2,5})/);
        const turn = err.match(/rotation of (-?\d+(?:\.\d+)?) degrees/) || err.match(/rotate\s*:\s*(-?\d+)/);
        resolve({
            codec: v && v[1],
            pixFmt: v && v[2],
            audio: a ? a[1] : null,
            duration,
            width: size ? Number(size[1]) : null,
            height: size ? Number(size[2]) : null,
            rotation: turn ? Math.round(Number(turn[1])) : 0,
        });
    });
});

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

const tempPaths = (prefix, ext) => {
    const id = crypto.randomBytes(8).toString('hex');
    return [path.join(os.tmpdir(), `${prefix}-${id}-in`), path.join(os.tmpdir(), `${prefix}-${id}-out.${ext}`)];
};
const cleanup = (...files) => files.forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* gone */ } });

/**
 * Mute and / or make playable. Only what is needed is touched: a playable
 * video with its sound kept is returned AS IS (`applied: false`, no ffmpeg
 * run); muting a playable one copies the picture and drops the sound (no
 * quality loss, a second or so).
 *
 * Never throws: on any problem (no ffmpeg, unreadable file, timeout) it
 * returns the ORIGINAL with `applied: false` — and `muted: false`, so the
 * caller knows the sound is still there.
 */
const processVideo = async (buffer, mimetype, { mute = false } = {}) => {
    const original = { buffer, mimetype, applied: false, muted: false };
    if (!ffmpegPath || !buffer || !buffer.length) return original;

    const isWebm = mimetype === 'video/webm';
    const [inFile, outFile] = tempPaths('vp', isWebm ? 'webm' : 'mp4');

    try {
        fs.writeFileSync(inFile, buffer);
        const { codec, pixFmt, audio } = await probe(inFile);

        // Copy the picture ONLY when every phone can play it as-is: 8-bit
        // 4:2:0 H.264 (or VP8 / VP9 in webm).
        const playable = isWebm ? ['vp8', 'vp9'].includes(codec) : codec === 'h264' && pixFmt === 'yuv420p';
        // Sound already in a codec its container plays everywhere.
        const soundOk = !audio || (isWebm ? ['opus', 'vorbis'].includes(audio) : ['aac', 'mp3'].includes(audio));

        if (playable && !mute) return original; // nothing to do
        if (playable && mute && !audio) return { ...original, muted: true }; // already silent

        const videoArgs = playable
            ? ['-c:v', 'copy']
            : isWebm
                ? ['-c:v', 'libvpx', '-b:v', '600k', '-pix_fmt', 'yuv420p']
                : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-profile:v', 'main'];
        const audioArgs = mute || !audio
            ? ['-an']
            : ['-map', '0:a:0', ...(soundOk
                ? ['-c:a', 'copy']
                : isWebm ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-c:a', 'aac', '-b:a', '128k'])];

        await run([
            '-y', '-i', inFile,
            '-map', '0:v:0',
            ...videoArgs,
            ...audioArgs,
            ...(isWebm ? [] : ['-movflags', '+faststart']),
            outFile,
        ]);
        const out = fs.readFileSync(outFile);
        if (!out.length) return original;
        return { buffer: out, mimetype: isWebm ? 'video/webm' : 'video/mp4', applied: true, muted: mute || !audio };
    } catch (e) {
        logger.warn(`[video] processing skipped, original kept: ${e.message}`);
        return original;
    } finally {
        cleanup(inFile, outFile);
    }
};

/**
 * The video's FIRST frame as a JPEG (max 720 px wide) — the gallery tile's
 * poster. Returns a Buffer, or null on any problem (never throws).
 */
const videoPoster = async (buffer) => {
    if (!ffmpegPath || !buffer || !buffer.length) return null;
    const [inFile, outFile] = tempPaths('vposter', 'jpg');
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
        logger.warn(`[video] poster skipped: ${e.message}`);
        return null;
    } finally {
        cleanup(inFile, outFile);
    }
};

/**
 * A video's length in seconds and whether it plays PORTRAIT (taller than
 * wide, the phone's rotation counted). Either is null when it cannot be read
 * (never throws). Shorts are refused over a minute or when landscape.
 */
const videoInfo = async (buffer) => {
    const none = { duration: null, portrait: null };
    if (!ffmpegPath || !buffer || !buffer.length) return none;
    const [inFile] = tempPaths('vinfo', 'mp4');
    try {
        fs.writeFileSync(inFile, buffer);
        const { duration, width, height, rotation } = await probe(inFile);
        const turned = Math.abs(rotation || 0) % 180 === 90;
        const shownW = turned ? height : width;
        const shownH = turned ? width : height;
        return {
            duration: Number.isFinite(duration) ? duration : null,
            portrait: shownW && shownH ? shownH > shownW : null,
        };
    } catch (_) {
        return none;
    } finally {
        cleanup(inFile);
    }
};

/** A video's length in seconds, or null when it cannot be read. */
const videoDuration = async (buffer) => (await videoInfo(buffer)).duration;

/**
 * A short's background music (Jamal, 2026-10-23): the song REPLACES the
 * video's own sound, fitted to the video — looped when the song is shorter,
 * cut at the video's end when longer, with a short fade-out at the end. The
 * picture is copied when every phone can already play it, else made plain
 * H.264. Always an MP4.
 *
 * THROWS on failure — unlike processVideo, a short the host asked to carry
 * music must not quietly go up without it. The caller turns it into a 400.
 */
const addMusic = async (videoBuffer, videoMime, musicBuffer, { start = 0 } = {}) => {
    if (!ffmpegPath) throw new Error('ffmpeg is not available');
    const [vIn, outFile] = tempPaths('vm', 'mp4');
    const [mIn] = tempPaths('vm-music', 'audio');
    try {
        fs.writeFileSync(vIn, videoBuffer);
        fs.writeFileSync(mIn, musicBuffer);
        const [{ codec, pixFmt, duration }, music] = await Promise.all([probe(vIn), probe(mIn)]);
        if (!duration) throw new Error('the video could not be read');
        if (!music.audio) throw new Error('the music file has no sound');

        const playable = videoMime !== 'video/webm' && codec === 'h264' && pixFmt === 'yuv420p';
        const fade = Math.min(1.5, duration / 4);
        // The music trim: the song starts this far in. Ignored when it would
        // leave less song than the clip (the app sends 0 then).
        const from = Number(start) > 0 && music.duration && Number(start) + duration <= music.duration + 0.5
            ? Number(start)
            : 0;
        await run([
            '-y',
            '-i', vIn,
            // Loop the song for as long as the picture needs it, starting at
            // the chosen second.
            '-stream_loop', '-1',
            ...(from > 0 ? ['-ss', from.toFixed(2)] : []),
            '-i', mIn,
            '-map', '0:v:0', '-map', '1:a:0',
            ...(playable
                ? ['-c:v', 'copy']
                : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-profile:v', 'main']),
            '-af', `afade=t=out:st=${Math.max(0, duration - fade).toFixed(2)}:d=${fade.toFixed(2)}`,
            '-c:a', 'aac', '-b:a', '128k',
            // Exactly the picture's length.
            '-t', duration.toFixed(2),
            '-movflags', '+faststart',
            outFile,
        ]);
        const out = fs.readFileSync(outFile);
        if (!out.length) throw new Error('ffmpeg wrote nothing');
        return { buffer: out, mimetype: 'video/mp4', duration };
    } finally {
        cleanup(vIn, mIn, outFile);
    }
};

/** Boot-time check, one log line: is ffmpeg runnable, and which version. */
const selfCheck = () => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-version'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => logger.error(`[video] ffmpeg NOT runnable (${ffmpegPath}): ${e.message}`));
    child.on('close', (code) => {
        if (code !== 0) return logger.error(`[video] ffmpeg exited ${code} on -version`);
        const version = (out.match(/ffmpeg version (\S+)/) || [])[1] || 'unknown';
        logger.info(`[video] ffmpeg ${version} OK (${ffmpegPath})`);
    });
};
ensureBinary().then(selfCheck);

module.exports = { processVideo, videoPoster, videoDuration, videoInfo, addMusic };
