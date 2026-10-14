import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
    SHORT_FORMAT, SHORT_PACKAGE_VERSION,
    SHORT_REVIEW_VERSION, SHORT_DURATION, validateBrief, validateCopy, validateEvidence,
    validateModelUsage, validateReview,
} from './short-quality-contract.mjs';

const VIDEO = 'curviosclash-portrait.mp4';
const COVER = 'thumbnail-portrait.png';
const SRT = 'captions-portrait.srt';

async function run(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let error = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { error += chunk; });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve({ output, error })
            : reject(new Error(`${path.basename(command)} exited ${code}: ${error.trim()}`)));
    });
}

async function mediaTools(root) {
    const requireElectron = createRequire(path.join(root, 'electron', 'package.json'));
    let bundledFfmpeg;
    try { bundledFfmpeg = requireElectron('ffmpeg-static'); } catch { /* PATH fallback */ }
    const ffmpeg = process.env.FFMPEG_PATH || bundledFfmpeg || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
    await run(ffmpeg, ['-version'], root);
    await run(ffprobe, ['-version'], root);
    return { ffmpeg, ffprobe };
}

export function validateVideoMetadata(metadata) {
    const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
    const audio = metadata.streams?.find((stream) => stream.codec_type === 'audio');
    const duration = Number(metadata.format?.duration);
    const [fpsTop, fpsBottom] = String(video?.avg_frame_rate || '').split('/').map(Number);
    if (video?.width !== SHORT_FORMAT.width || video?.height !== SHORT_FORMAT.height
        || video.codec_name !== 'h264' || !Number.isFinite(fpsTop / fpsBottom)
        || Math.abs(fpsTop / fpsBottom - SHORT_FORMAT.fps) > 0.01
        || !audio || audio.codec_name !== 'aac'
        || !Number.isFinite(duration) || duration < SHORT_DURATION.min || duration > SHORT_DURATION.max) {
        throw new Error('short needs 1080x1920 H.264 MP4, 60 fps, AAC audio and 10-30 seconds');
    }
    const frames = Number(video.nb_frames);
    if (!Number.isFinite(frames) || Math.abs(frames - duration * SHORT_FORMAT.fps) > 1) {
        throw new Error('short has missing or extra video frames');
    }
    if (Math.abs(Number(audio.start_time || 0) - Number(video.start_time || 0)) > 0.1
        || !Number.isFinite(Number(audio.duration))
        || Number(audio.duration) + 0.1 < duration) {
        throw new Error('gameplay audio is missing, short or out of sync');
    }
    return { duration, frames, codec: video.codec_name, audioCodec: audio.codec_name };
}

export function validateMediaDiagnostics(picture, sound) {
    if (/black_start:|freeze_start:/.test(picture)) throw new Error('gameplay contains a black or frozen interval');
    let silenceStart = null;
    const silence = [];
    for (const match of sound.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {
        if (match[1] === 'start') silenceStart = Number(match[2]);
        else if (silenceStart !== null) {
            silence.push(Number(match[2]) - silenceStart);
            silenceStart = null;
        }
    }
    if (silenceStart !== null || silence.some((duration) => duration >= 0.5)) {
        throw new Error('gameplay audio contains silence');
    }
    const maxVolume = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(sound);
    if (!maxVolume || Number(maxVolume[1]) >= 0) throw new Error('audio is missing, clipping or cannot be measured');
    return { maxVolumeDb: Number(maxVolume[1]), silenceIntervals: silence.length };
}

function srtMilliseconds(value) {
    const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
    if (!match) throw new Error(`invalid SRT time: ${value}`);
    return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]));
}

export function validateSrt(content, captions) {
    const blocks = content.trim().split(/\r?\n\s*\r?\n/);
    if (blocks.length !== captions.length) throw new Error('SRT cue count differs from approved captions');
    for (const [index, block] of blocks.entries()) {
        const lines = block.split(/\r?\n/);
        const times = /^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/.exec(lines[1] || '');
        if (Number(lines[0]) !== index + 1 || !times) throw new Error('SRT numbering or timing is invalid');
        const cue = captions[index];
        if (Math.abs(srtMilliseconds(times[1]) / 1000 - cue.start) > 0.01
            || Math.abs(srtMilliseconds(times[2]) / 1000 - cue.end) > 0.01
            || lines.slice(2).join('\n').trim() !== cue.text.trim()) {
            throw new Error(`SRT cue ${index + 1} differs from approved copy`);
        }
    }
    return blocks.length;
}

export function validatePreparedPackage(packet) {
    if (packet?.contractVersion !== SHORT_PACKAGE_VERSION || packet.status !== 'needs-human-review') {
        throw new Error('prepared short package is missing');
    }
    if (!packet.briefId || !packet.title || !packet.description
        || !packet.callToAction?.url || !Array.isArray(packet.platforms) || !packet.platforms.length
        || !Array.isArray(packet.assets) || !packet.assets.length
        || !packet.checks?.video || !packet.checks?.audio || !packet.checks?.events
        || !packet.checks?.handoffs || !packet.checks?.captions
        || !packet.preview?.contactSheet) {
        throw new Error('prepared short package is incomplete');
    }
    for (const name of ['video', 'cover', 'subtitles']) {
        if (!/^[A-Za-z0-9._-]+$/.test(packet.files?.[name] || '')
            || !/^[a-f0-9]{64}$/.test(packet.hashes?.[name] || '')) {
            throw new Error(`prepared short package needs a verified ${name}`);
        }
    }
    for (const name of ['brief', 'evidence', 'copy']) {
        if (!packet.sources?.[name] || !/^[a-f0-9]{64}$/.test(packet.sourceHashes?.[name] || '')) {
            throw new Error(`prepared short package needs a verified ${name} source`);
        }
    }
    validateModelUsage(packet.modelUsage);
    return packet;
}

async function sha256(filename) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex');
}

async function probeVideo(ffprobe, filename, cwd) {
    const result = await run(ffprobe, [
        '-v', 'error', '-show_entries',
        'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,duration,start_time:format=duration',
        '-of', 'json', filename,
    ], cwd);
    return JSON.parse(result.output);
}

export async function prepareShort({ root, briefPath, evidencePath, copyPath, renderDir, usagePath = null }) {
    const brief = validateBrief(JSON.parse(await readFile(briefPath, 'utf8')));
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const validatedEvidence = validateEvidence(brief, evidence);
    const copy = JSON.parse(await readFile(copyPath, 'utf8'));
    validateCopy(brief, evidence, copy);
    const usage = usagePath ? JSON.parse(await readFile(usagePath, 'utf8'))
        : { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, revisions: 0 };
    validateModelUsage(usage);
    if (!usagePath && !copy.provenance?.startsWith('approved-')) {
        throw new Error('new model-written copy needs measured model usage');
    }
    const files = evidence.media || { video: VIDEO, cover: COVER, subtitles: SRT };
    const videoPath = path.join(renderDir, files.video);
    const coverPath = path.join(renderDir, files.cover);
    const srtPath = path.join(renderDir, files.subtitles);
    await Promise.all([videoPath, coverPath, srtPath].map((filename) => access(filename)));
    validateSrt(await readFile(srtPath, 'utf8'), copy.captions);
    const { ffmpeg, ffprobe } = await mediaTools(root);
    const video = validateVideoMetadata(await probeVideo(ffprobe, videoPath, root));
    const cover = await probeVideo(ffprobe, coverPath, root);
    const coverStream = cover.streams?.find((stream) => stream.codec_type === 'video');
    if (coverStream?.width !== SHORT_FORMAT.width || coverStream?.height !== SHORT_FORMAT.height) {
        throw new Error('cover needs a 1080x1920 portrait frame');
    }
    const gameplayLength = validatedEvidence.gameplayEnd;
    if (gameplayLength > video.duration + 0.05) throw new Error('gameplay timeline exceeds the exported video');
    const picture = await run(ffmpeg, ['-hide_banner', '-nostdin', '-ss', '0', '-t', String(gameplayLength),
        '-i', videoPath, '-vf', 'blackdetect=d=0.12:pix_th=0.015:pic_th=0.98,freezedetect=n=-60dB:d=0.5',
        '-an', '-f', 'null', '-'], root);
    const sound = await run(ffmpeg, ['-hide_banner', '-nostdin', '-ss', '0', '-t', String(gameplayLength),
        '-i', videoPath, '-vn', '-af', 'silencedetect=n=-50dB:d=0.5,volumedetect', '-f', 'null', '-'], root);
    const audio = validateMediaDiagnostics(picture.error, sound.error);
    const previewDir = path.join(renderDir, 'quality-preview');
    await mkdir(previewDir, { recursive: true });
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', videoPath,
        '-vf', `fps=8/${video.duration},scale=270:480:flags=lanczos,tile=4x2`, '-frames:v', '1',
        path.join(previewDir, 'contact-sheet.png')], root);
    const handoffClips = [];
    for (const handoff of evidence.handoffs) {
        const filename = `handoff-${String(handoff.at).replace('.', '-')}.mp4`;
        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-ss', String(Math.max(0, handoff.at - 0.75)), '-t', '1.5', '-i', videoPath,
            '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
            path.join(previewDir, filename)], root);
        handoffClips.push(path.join('quality-preview', filename));
    }
    const hashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([name, filename]) =>
        [name, await sha256(path.join(renderDir, filename))])));
    const sources = { brief: path.resolve(briefPath), evidence: path.resolve(evidencePath), copy: path.resolve(copyPath) };
    for (const [name, filename] of Object.entries(evidence.sourceFiles || {})) {
        sources[`raw-${name}`] = path.resolve(path.dirname(evidencePath), filename);
    }
    const sourceHashes = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, filename]) =>
        [name, await sha256(filename)])));
    const packet = {
        contractVersion: SHORT_PACKAGE_VERSION, briefId: brief.id, status: 'needs-human-review',
        files, hashes, title: copy.title.text,
        description: [...copy.description.map((line) => line.text), ...(copy.attribution || [])].join('\n'),
        callToAction: brief.callToAction, platforms: brief.platforms,
        sources, sourceHashes,
        checks: { video, audio, events: evidence.events.length, handoffs: evidence.handoffs.length,
            captions: copy.captions.length },
        assets: evidence.assets,
        preview: { contactSheet: path.join('quality-preview', 'contact-sheet.png'), handoffClips },
        modelUsage: usage,
    };
    validatePreparedPackage(packet);
    await writeFile(path.join(renderDir, 'publication.json'), `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx' });
    const review = { contractVersion: SHORT_REVIEW_VERSION, briefId: brief.id,
        fullWatch: { withSound: false, withoutSound: false, visualStory: false, mobileFraming: false,
            distinctiveMap: false, trailsReadable: false, playersReadable: false,
            transitionsSmooth: false, captionsReadable: false, noFlash: false,
            musicAndEffects: false, cover: false },
        phoneDevice: '',
        testers: Array.from({ length: 5 }, () => ({ testerId: '', independent: false, understood: false })),
        rights: evidence.assets.map((asset) => ({ assetId: asset.id, source: asset.source,
            approvedBy: '', evidence: '', platforms: [] })),
        developmentStatusApproved: false, claimsApproved: false, linkApproved: false,
        reviewer: '', reviewedAt: '',
    };
    await writeFile(path.join(renderDir, 'review-template.json'), `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' });
    await writeFile(path.join(previewDir, 'editorial-input.json'), `${JSON.stringify({
        brief: { id: brief.id, topic: brief.topic, scene: brief.scene, keyClaim: brief.keyClaim },
        events: evidence.events, handoffs: evidence.handoffs.map(({ at, playerIndex, direction }) =>
            ({ at, playerIndex, direction })),
        previews: packet.preview,
    }, null, 2)}\n`, { flag: 'wx' });
    return packet;
}

export async function finalizeShort(renderDir, reviewPath) {
    const packet = validatePreparedPackage(JSON.parse(await readFile(path.join(renderDir, 'publication.json'), 'utf8')));
    const brief = validateBrief(JSON.parse(await readFile(packet.sources.brief, 'utf8')));
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    const evidence = JSON.parse(await readFile(packet.sources.evidence, 'utf8'));
    const signoff = validateReview(review, brief, evidence);
    for (const [name, filename] of Object.entries(packet.files)) {
        if (await sha256(path.join(renderDir, filename)) !== packet.hashes[name]) {
            throw new Error(`${name} changed after automated review`);
        }
    }
    for (const [name, filename] of Object.entries(packet.sources)) {
        if (await sha256(filename) !== packet.sourceHashes[name]) {
            throw new Error(`${name} source changed after automated review`);
        }
    }
    const release = { contractVersion: SHORT_PACKAGE_VERSION, briefId: brief.id,
        status: 'release-ready', files: packet.files, hashes: packet.hashes,
        title: packet.title, description: packet.description,
        callToAction: packet.callToAction, platforms: packet.platforms,
        checks: packet.checks, signoff, rights: review.rights, modelUsage: packet.modelUsage,
    };
    await writeFile(path.join(renderDir, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, { flag: 'wx' });
    return release;
}

async function main(args) {
    const root = process.cwd();
    const [command, ...rest] = args;
    if (command === 'prepare' && (rest.length === 4 || rest.length === 5)) {
        const [briefPath, evidencePath, copyPath, renderDir, usagePath] = rest.map((value) => path.resolve(value));
        const packet = await prepareShort({ root, briefPath, evidencePath, copyPath, renderDir, usagePath });
        console.log(`Short prepared for phone review: ${path.join(renderDir, 'publication.json')}`);
        return packet;
    }
    if (command === 'finalize' && rest.length === 2) {
        const [renderDir, reviewPath] = rest.map((value) => path.resolve(value));
        const release = await finalizeShort(renderDir, reviewPath);
        console.log(`Short release-ready: ${path.join(renderDir, 'release.json')}`);
        return release;
    }
    throw new Error('usage: short-quality.mjs prepare <brief.json> <evidence.json> <copy.json> <render-dir> [usage.json] | finalize <render-dir> <filled-review.json>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
}
