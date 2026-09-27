import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const FORMATS = Object.freeze({
    landscape: { width: 1920, height: 1080, captionSize: 58, detailSize: 43, markerSize: 28 },
    portrait: { width: 1080, height: 1920, captionSize: 60, detailSize: 42, markerSize: 27 },
});
const DURATION = 18;
const FRAMES = DURATION * 60;
const MUSIC = fileURLToPath(new URL('../../assets/audio/music/mozart-nachtmusik-advent-chamber.mp3', import.meta.url));
const ENDCARD = { start: 16, end: 18, key: 'endcard', copy: 'CURVIOSCLASH\nFollow development.' };
const PUBLICATION = 'Your trail is a weapon. Your next turn could be a trap.\n'
    + 'Discover Classic and the THICK item: fast 3D duels where every turn matters.\n'
    + 'Would you have escaped? Follow development on itch.io.\n'
    + 'Development footage.\n'
    + 'https://curviosclash.itch.io/\n'
    + 'Music: Mozart, Eine kleine Nachtmusik, performed by Advent Chamber Orchestra; CC BY-SA 2.0.\n'
    + 'https://commons.wikimedia.org/wiki/File:Mozart_-_Eine_kleine_Nachtmusik_-_1._Allegro.ogg\n';
const GHOST_PUBLICATION = 'No way out? GHOST lets you fly through an existing trail.\n'
    + 'Watch the pickup, the activation, and the escape in one real Classic round.\n'
    + 'Follow CurviosClash development on itch.io. Development footage.\n'
    + 'https://curviosclash.itch.io/\n'
    + 'Music: Mozart, Eine kleine Nachtmusik, performed by Advent Chamber Orchestra; CC BY-SA 2.0.\n'
    + 'https://commons.wikimedia.org/wiki/File:Mozart_-_Eine_kleine_Nachtmusik_-_1._Allegro.ogg\n';

function fail(message) {
    throw new Error(`[marketing:trail-short] ${message}`);
}

function offset(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 3600) {
        fail(`${label} must be a finite, nonnegative number of seconds`);
    }
    return value;
}

function inputFile(value, label, manifestDir) {
    if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a file path`);
    return path.resolve(manifestDir, value);
}

export function validateTake(take, manifestDir) {
    if (!take || typeof take !== 'object' || !take.orientations) fail('take needs orientations');
    const orientations = {};
    for (const name of Object.keys(FORMATS)) {
        const entry = take.orientations[name];
        if (!entry || typeof entry !== 'object') fail(`take needs orientations.${name}`);
        orientations[name] = {
            gameplay: inputFile(entry.gameplay, `${name}.gameplay`, manifestDir),
            cinematic: inputFile(entry.cinematic, `${name}.cinematic`, manifestDir),
            gameplayStart: offset(entry.gameplayStart, `${name}.gameplayStart`),
            cinematicStart: offset(entry.cinematicStart, `${name}.cinematicStart`),
            beats: entry.beats,
            handoffs: entry.handoffs,
        };
        buildCaptions(take.variant || 'thick', entry.beats);
        const expectedHandoffs = [3, 7, 10];
        if (JSON.stringify(entry.handoffs) !== JSON.stringify(expectedHandoffs)) {
            fail(`${name} has no verified camera handoffs at ${expectedHandoffs.join(', ')}s`);
        }
    }
    return orientations;
}

export function buildTimeline(entry) {
    return [
        { source: 'cinematic', start: entry.cinematicStart, at: 0, duration: 3, caption: 'hook' },
        { source: 'gameplay', start: entry.gameplayStart + 3, at: 3, duration: 4, caption: 'duel' },
        { source: 'cinematic', start: entry.cinematicStart + 7, at: 7, duration: 3, caption: 'classic' },
        { source: 'gameplay', start: entry.gameplayStart + 10, at: 10, duration: 6, caption: null },
        { source: 'endcard', start: 0, at: 16, duration: 2, caption: 'endcard' },
    ];
}

export function buildCaptions(variant, beats) {
    const cueTime = (value) => Math.round(value * 1000) / 1000;
    const use = Number(beats?.use);
    if (!Number.isFinite(use) || use < 10 || use >= 15) fail('item use must be verified between 10 and 15 seconds');
    const checked = (captions) => {
        for (let index = 0; index < captions.length; index += 1) {
            const cue = captions[index];
            if (cue.end - cue.start < 0.8 || (index && cue.start < captions[index - 1].end)) {
                fail(`caption ${cue.key} is too short or overlaps another cue`);
            }
        }
        return captions;
    };
    if (variant === 'ghost') {
        const pickup = Number(beats?.pickup);
        const crossing = Number(beats?.crossing);
        if (!Number.isFinite(pickup) || pickup < 3 || pickup >= 7
            || !Number.isFinite(crossing) || crossing <= use + 1.2 || crossing >= 15.5) {
            fail('GHOST pickup, activation and crossing must be verified in order');
        }
        const pickupStart = cueTime(Math.max(3.15, pickup - 0.1));
        const useStart = cueTime(Math.max(10.15, use - 0.05));
        const crossingStart = cueTime(Math.max(use + 1.1, crossing - 0.15));
        return checked([
            { start: 0.25, end: 2.35, key: 'hook', copy: 'A trail blocks the route.' },
            { start: pickupStart, end: cueTime(Math.min(pickup + 1.4, 6.5)), key: 'pickup', copy: 'GHOST picked up.' },
            { start: 7.25, end: 8.85, key: 'classic', copy: 'Classic: two pilots, one arena.' },
            { start: useStart, end: cueTime(Math.min(use + 1, crossingStart - 0.1)), key: 'activation', copy: 'GHOST activated.' },
            { start: crossingStart, end: cueTime(Math.min(15.8, crossing + 1.1)), key: 'crossing', copy: 'Now fly through the trail.' },
            ENDCARD,
        ]);
    }
    if (variant !== 'thick') fail(`unknown short variant: ${variant}`);
    const useStart = cueTime(Math.max(10.15, use - 0.05));
    return checked([
        { start: 0.25, end: 2.35, key: 'hook', copy: 'Every turn leaves a trail.' },
        { start: 3.3, end: 5.8, key: 'duel', copy: 'Two pilots weave their own barriers.' },
        { start: 7.25, end: 8.85, key: 'classic', copy: 'Classic: survive the trails.' },
        { start: useStart, end: cueTime(use + 1), key: 'activation', copy: 'THICK activated.' },
        { start: cueTime(use + 1.12), end: 15.8, key: 'effect', copy: 'The next trail grows wider.' },
        ENDCARD,
    ]);
}

function drawText(file, size, y, { color = 'white', boxed = true } = {}) {
    return `drawtext=font=Arial:textfile=${file}:fontcolor=${color}:fontsize=${size}`
        + `:x=(w-text_w)/2:y=${y}`
        + (boxed ? ':box=1:boxcolor=0x081320@0.82:boxborderw=18' : '')
        + ':fix_bounds=1';
}

function marker(format) {
    return `drawtext=font=Arial:textfile=captions/marker.txt:fontcolor=white@0.86`
        + `:fontsize=${format.markerSize}:x=w-text_w-${Math.round(format.width * 0.045)}`
        + `:y=h-text_h-${Math.round(format.height * (format.height > format.width ? 0.115 : 0.055))}`
        + ':box=1:boxcolor=0x081320@0.65:boxborderw=9:fix_bounds=1';
}

export function buildRenderArgs(name, entry, variant = 'thick') {
    const format = FORMATS[name];
    if (!format) fail(`unknown orientation: ${name}`);
    const captions = buildCaptions(variant, entry.beats);
    const timeline = buildTimeline(entry);
    const top = Math.round(format.height * (name === 'portrait' ? 0.12 : 0.145));
    const chains = timeline.slice(0, 4).map((shot, index) => {
        const sourceIndex = shot.source === 'gameplay' ? 0 : 1;
        const filters = [
            `trim=start=${shot.start}:duration=${shot.duration}`,
            'setpts=PTS-STARTPTS', 'fps=60',
            `scale=${format.width}:${format.height}:flags=lanczos`, 'setsar=1',
        ];
        filters.push(marker(format));
        return `[${sourceIndex}:v:0]${filters.join(',')}[v${index}]`;
    });
    chains.push(`[3:v:0]${drawText('captions/title.txt', name === 'portrait' ? 96 : 112,
        '(h-text_h)/2-95', { boxed: false })},`
        + `${drawText('captions/cta.txt', name === 'portrait' ? 53 : 61,
            '(h-text_h)/2+85', { color: '0x9cedff', boxed: false })}[v4]`);
    chains.push('[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[base]');
    const timed = captions.filter((caption) => caption.key !== 'endcard').map((caption) =>
        `${drawText(`captions/${name}/${caption.key}.txt`, format.captionSize, top)}`
        + `:enable='between(t,${caption.start},${caption.end})'`);
    chains.push(`[base]${timed.join(',')}[video]`);
    chains.push(`[0:a:0]atrim=start=${entry.gameplayStart}:duration=16,asetpts=PTS-STARTPTS,`
        + 'aresample=async=1:first_pts=0,loudnorm=I=-20:TP=-2:LRA=11,'
        + 'apad,atrim=duration=18[game]');
    chains.push('[2:a:0]atrim=start=2:duration=18,asetpts=PTS-STARTPTS,volume=0.24,'
        + 'afade=t=in:st=0:d=0.5,afade=t=out:st=16.5:d=1.5[music]');
    chains.push('[game][music]amix=inputs=2:duration=first:normalize=0,'
        + 'alimiter=limit=0.95[audio]');
    return [
        '-i', entry.gameplay, '-i', entry.cinematic, '-i', MUSIC,
        '-f', 'lavfi', '-i', `color=c=0x081320:s=${format.width}x${format.height}:r=60:d=2`,
        '-filter_complex', chains.join(';'), '-map', '[video]', '-map', '[audio]',
        '-frames:v', String(FRAMES), '-t', String(DURATION),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', '60', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+faststart', `curviosclash-${name}.mp4`,
    ];
}

export async function assertNewOutputDirectory(directory) {
    try {
        await stat(directory);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    fail(`output directory already exists: ${directory}`);
}

function run(command, args, cwd, { captureStderr = false } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve(captureStderr ? stderr : stdout) : reject(new Error(
            `${command} exited ${code}: ${stderr.trim()}`)));
    });
}

export function validateRenderedShortMetadata(metadata, format) {
    const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
    const audio = metadata.streams?.find((stream) => stream.codec_type === 'audio');
    if (video?.width !== format.width || video?.height !== format.height
        || video?.avg_frame_rate !== '60/1' || Number(video?.nb_frames) !== FRAMES
        || !audio || Math.abs(Number(metadata.format?.duration) - DURATION) > 0.05) {
        fail('rendered short failed size, 60 fps, 1080 frame, duration or audio verification');
    }
}

export function validatePictureDiagnostics(stderr) {
    if (/black_start:|freeze_start:/.test(stderr)) {
        fail('rendered gameplay contains a black or frozen interval');
    }
}

async function verifyRenderedShort(filename, format, ffprobe, ffmpeg, cwd) {
    const metadata = JSON.parse(await run(ffprobe, [
        '-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,nb_frames:format=duration',
        '-of', 'json', filename,
    ], cwd));
    validateRenderedShortMetadata(metadata, format);
    const diagnostics = await run(ffmpeg, [
        '-hide_banner', '-nostdin', '-ss', '0', '-t', '16', '-i', filename,
        '-vf', 'blackdetect=d=0.12:pix_th=0.015:pic_th=0.98,freezedetect=n=-60dB:d=0.5',
        '-an', '-f', 'null', '-',
    ], cwd, { captureStderr: true });
    validatePictureDiagnostics(diagnostics);
}

export function packetEndTime(line) {
    const stream = /(?:^|\|)stream_index=(\d+)/.exec(line);
    const pts = /(?:^|\|)pts_time=([\d.]+)/.exec(line);
    const duration = /(?:^|\|)duration_time=([\d.]+)/.exec(line);
    if (!stream || !pts) return null;
    const end = Number(pts[1]) + (duration ? Number(duration[1]) : 0);
    return Number.isFinite(end) ? { streamIndex: Number(stream[1]), end } : null;
}

function probePacketEnds(filename, ffprobe) {
    return new Promise((resolve, reject) => {
        const child = spawn(ffprobe, [
            '-v', 'error', '-show_packets', '-show_entries', 'packet=stream_index,pts_time,duration_time',
            '-of', 'compact=p=0:nk=0', filename,
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const ends = new Map();
        let pending = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            pending += chunk.toString();
            const lines = pending.split(/\r?\n/);
            pending = lines.pop();
            for (const line of lines) {
                const packet = packetEndTime(line);
                if (packet) ends.set(packet.streamIndex, Math.max(ends.get(packet.streamIndex) || 0, packet.end));
            }
        });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${stderr.trim()}`));
            const packet = packetEndTime(pending);
            if (packet) ends.set(packet.streamIndex, Math.max(ends.get(packet.streamIndex) || 0, packet.end));
            resolve(ends);
        });
    });
}

async function probeSource(filename, expected, minDuration, needsAudio, ffprobe) {
    await access(filename);
    const result = JSON.parse(await run(ffprobe, [
        '-v', 'error', '-show_entries', 'stream=index,codec_type,width,height:format=duration',
        '-of', 'json', filename,
    ], process.cwd()));
    const video = result.streams?.find((stream) => stream.codec_type === 'video');
    if (video?.width !== expected.width || video?.height !== expected.height) {
        fail(`${filename} must be ${expected.width}x${expected.height}; got ${video?.width}x${video?.height}`);
    }
    if (needsAudio && !result.streams?.some((stream) => stream.codec_type === 'audio')) {
        fail(`${filename} has no game audio stream`);
    }
    const duration = Number(result.format?.duration);
    if (Number.isFinite(duration)) {
        if (duration + 0.05 < minDuration) fail(`${filename} is too short: ${duration}s; needs ${minDuration}s`);
        return;
    }
    const ends = await probePacketEnds(filename, ffprobe);
    const required = needsAudio
        ? [video, result.streams.find((stream) => stream.codec_type === 'audio')]
        : [video];
    for (const stream of required) {
        const end = ends.get(stream.index);
        if (!Number.isFinite(end)) fail(`${filename} has no reliable ${stream.codec_type} timeline`);
        if (end + 0.05 < minDuration) {
            fail(`${filename} ${stream.codec_type} is too short: ${end}s; needs ${minDuration}s`);
        }
    }
}

function srtTime(seconds) {
    const milliseconds = Math.round(seconds * 1000);
    return `00:00:${String(Math.floor(milliseconds / 1000)).padStart(2, '0')},`
        + String(milliseconds % 1000).padStart(3, '0');
}

export function buildSrt(variant, beats) {
    return buildCaptions(variant, beats).map(({ start, end, copy }, index) =>
        `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${copy}\n`).join('\n');
}

async function main(args) {
    if (args.length !== 2) fail('usage: node scripts/marketing/render-trail-short.mjs <take.json> <new-output-dir>');
    const manifestPath = path.resolve(args[0]);
    const outputDir = path.resolve(args[1]);
    const take = JSON.parse(await readFile(manifestPath, 'utf8'));
    const variant = take.variant || 'thick';
    const entries = validateTake(take, path.dirname(manifestPath));
    await assertNewOutputDirectory(outputDir);
    const root = process.cwd();
    const requireElectron = createRequire(path.join(root, 'electron', 'package.json'));
    let bundledFfmpeg;
    try { bundledFfmpeg = requireElectron('ffmpeg-static'); } catch { /* PATH fallback */ }
    const ffmpeg = process.env.FFMPEG_PATH || bundledFfmpeg || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    await run(ffmpeg, ['-version'], root);
    for (const [name, entry] of Object.entries(entries)) {
        await probeSource(entry.gameplay, FORMATS[name], entry.gameplayStart + 16, true, ffprobe);
        await probeSource(entry.cinematic, FORMATS[name], entry.cinematicStart + (variant === 'ghost' ? 10.5 : 10), false, ffprobe);
    }
    await mkdir(path.dirname(outputDir), { recursive: true });
    await mkdir(outputDir);
    await mkdir(path.join(outputDir, 'captions'));
    const captions = {
        'marker.txt': 'Development footage\n',
        'title.txt': 'CURVIOSCLASH\n',
        'cta.txt': 'Follow development.\n',
    };
    await Promise.all(Object.entries(captions).map(([name, copy]) => writeFile(
        path.join(outputDir, 'captions', name), copy, { flag: 'wx' })));
    await writeFile(path.join(outputDir, 'publication.txt'), variant === 'ghost' ? GHOST_PUBLICATION : PUBLICATION,
        { flag: 'wx' });
    for (const [name, entry] of Object.entries(entries)) {
        const captionDir = path.join(outputDir, 'captions', name);
        await mkdir(captionDir);
        await Promise.all(buildCaptions(variant, entry.beats).filter((caption) => caption.key !== 'endcard')
            .map((caption) => writeFile(path.join(captionDir, `${caption.key}.txt`), `${caption.copy}\n`, { flag: 'wx' })));
        await writeFile(path.join(outputDir, `captions-${name}.srt`), buildSrt(variant, entry.beats), { flag: 'wx' });
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
            ...buildRenderArgs(name, entry, variant)], outputDir);
        await verifyRenderedShort(path.join(outputDir, `curviosclash-${name}.mp4`), FORMATS[name], ffprobe, ffmpeg, outputDir);
        console.log(`[marketing:trail-short] ${name} video verified`);
    }
    const landscape = entries.landscape;
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-ss', String(variant === 'ghost' ? landscape.gameplayStart + landscape.beats.crossing
            : landscape.gameplayStart + landscape.beats.use + 1.2),
        '-i', landscape.gameplay,
        '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos,setsar=1',
        'thumbnail-landscape.png'], outputDir);
    const portrait = entries.portrait;
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
        '-ss', String(portrait.gameplayStart + (variant === 'ghost' ? portrait.beats.crossing : portrait.beats.use + 1.2)),
        '-i', portrait.gameplay,
        '-frames:v', '1', '-vf', 'scale=1080:1920:flags=lanczos,setsar=1',
        'thumbnail-portrait.png'], outputDir);
    console.log(`[marketing:trail-short] Saved to ${outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
