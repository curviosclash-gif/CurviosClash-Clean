import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    assertNewOutputDirectory,
    buildCaptions,
    buildRenderArgs,
    buildSrt,
    buildTimeline,
    packetEndTime,
    validateTake,
    validatePictureDiagnostics,
    validateRenderedShortMetadata,
} from '../scripts/marketing/render-trail-short.mjs';

const entry = {
    gameplay: path.resolve('a video; no shell.webm'),
    cinematic: path.resolve('cinematic.mp4'),
    gameplayStart: 1.25,
    cinematicStart: 2.5,
    beats: { pickup: null, use: 12.2, crossing: null },
    handoffs: [3, 7, 10],
};

test('take requires both orientations, finite offsets, and resolved input paths', () => {
    const raw = { orientations: {
        landscape: { gameplay: 'game.webm', cinematic: 'cinema.webm', gameplayStart: 1, cinematicStart: 2,
            beats: entry.beats, handoffs: entry.handoffs },
        portrait: { gameplay: 'tall.webm', cinematic: 'tall-cinema.webm', gameplayStart: 3, cinematicStart: 4,
            beats: entry.beats, handoffs: entry.handoffs },
    } };
    const entries = validateTake(raw, path.resolve('takes'));
    assert.equal(entries.landscape.gameplay, path.resolve('takes/game.webm'));
    assert.equal(entries.portrait.cinematicStart, 4);
    assert.throws(() => validateTake({ orientations: { landscape: raw.orientations.landscape } }, '.'), /portrait/);
    assert.throws(() => validateTake({ orientations: {
        ...raw.orientations, portrait: { ...raw.orientations.portrait, gameplayStart: Infinity },
    } }, '.'), /finite/);
    assert.throws(() => validateTake({ orientations: {
        ...raw.orientations, portrait: { ...raw.orientations.portrait, handoffs: [3, 7] },
    } }, '.'), /verified camera handoffs/);
});

test('timeline covers exactly 18 seconds with capture offsets and a clean gameplay stretch', () => {
    const shots = buildTimeline(entry);
    assert.deepEqual(shots.map(({ source, at, duration, caption }) =>
        [source, at, duration, caption]), [
        ['cinematic', 0, 3, 'hook'],
        ['gameplay', 3, 4, 'duel'],
        ['cinematic', 7, 3, 'classic'],
        ['gameplay', 10, 6, null],
        ['endcard', 16, 2, 'endcard'],
    ]);
    assert.deepEqual(shots.map(({ start }) => start), [2.5, 4.25, 9.5, 11.25, 0]);
    assert.equal(shots.at(-1).at + shots.at(-1).duration, 18);
    assert.ok(shots.every((shot, index) => index === 0 || shot.at === shots[index - 1].at + shots[index - 1].duration));
});

test('render args preserve source paths as argv and set exact format, fps, codecs, and audio', () => {
    for (const [name, dimensions] of Object.entries({ landscape: '1920:1080', portrait: '1080:1920' })) {
        const args = buildRenderArgs(name, entry);
        const graph = args[args.indexOf('-filter_complex') + 1];
        assert.equal(args[args.indexOf('-i') + 1], entry.gameplay);
        assert.equal(args[args.indexOf('-i') + 3], entry.cinematic);
        assert.match(args[args.indexOf('-i') + 5], /mozart-nachtmusik-advent-chamber\.mp3$/);
        assert.match(graph, new RegExp(`scale=${dimensions}:flags=lanczos`));
        assert.match(graph, /fps=60/);
        const captionTop = Number(new RegExp(`textfile=captions/${name}/hook\\.txt:[^;]*?:y=(\\d+)`).exec(graph)?.[1]);
        assert.equal(captionTop, name === 'landscape' ? 157 : 230);
        if (name === 'landscape') assert.ok(captionTop > 126 && captionTop + 58 + 18 < 252);
        assert.match(graph, /trim=start=11\.25:duration=6,.*\[v3\]/);
        assert.match(graph, new RegExp(`captions/${name}/activation\\.txt.*enable='between\\(t,12\\.15,13\\.2\\)'`));
        assert.doesNotMatch(graph, /overlay=/, 'the cut must not ghost two different world views');
        assert.match(graph, /atrim=start=1\.25:duration=16.*\[game\]/);
        assert.match(graph, /atrim=start=2:duration=18.*\[music\]/);
        assert.match(graph, /\[game\]\[music\]amix=/);
        assert.match(graph, name === 'portrait' ? /:y=h-text_h-221/ : /:y=h-text_h-59/);
        assert.deepEqual(args.slice(args.indexOf('-frames:v'), args.indexOf('-frames:v') + 2), ['-frames:v', '1080']);
        assert.deepEqual(args.slice(args.indexOf('-r'), args.indexOf('-r') + 2), ['-r', '60']);
        assert.deepEqual(args.slice(args.indexOf('-pix_fmt'), args.indexOf('-pix_fmt') + 2), ['-pix_fmt', 'yuv420p']);
        assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 2), ['-c:a', 'aac']);
        assert.equal(args.at(-1), `curviosclash-${name}.mp4`);
        assert.ok(!graph.includes(entry.gameplay), 'paths never enter filter syntax');
    }
});

test('packet endpoint uses timestamps and durations rather than packet count for VFR clips', () => {
    assert.deepEqual(packetEndTime('stream_index=0|pts_time=15.983000|duration_time=0.041000'),
        { streamIndex: 0, end: 16.024 });
    assert.deepEqual(packetEndTime('stream_index=1|pts_time=16.010000|duration_time=N/A'),
        { streamIndex: 1, end: 16.01 });
    assert.equal(packetEndTime('stream_index=0|pts_time=N/A|duration_time=N/A'), null);
});

test('subtitles follow the verified THICK activation and describe the visible consequence', () => {
    const srt = buildSrt('thick', entry.beats);
    assert.match(srt, /00:00:00,250 --> 00:00:02,350\nEvery turn leaves a trail\./);
    assert.match(srt, /00:00:07,250 --> 00:00:08,850\nClassic: survive the trails\./);
    assert.match(srt, /00:00:12,150 --> 00:00:13,200\nTHICK activated\./);
    assert.match(srt, /00:00:13,320 --> 00:00:15,800\nThe next trail grows wider\./);
    assert.match(srt, /00:00:16,000 --> 00:00:18,000\nCURVIOSCLASH\nFollow development\./);
    assert.throws(() => buildCaptions('thick', { use: null }), /item use/);
});

test('GHOST story stays chronological and its captions follow pickup, use and crossing', () => {
    const ghost = { ...entry, beats: { pickup: 3.44, use: 11.99, crossing: 14.32 } };
    const args = buildRenderArgs('portrait', ghost, 'ghost');
    const graph = args[args.indexOf('-filter_complex') + 1];
    assert.match(graph, /trim=start=2\.5:duration=3/);
    assert.match(graph, /trim=start=4\.25:duration=4/);
    assert.match(graph, /trim=start=11\.25:duration=6/);
    assert.doesNotMatch(graph, /tpad=stop_mode=clone/);
    assert.match(graph, /atrim=start=1\.25:duration=16/);
    const srt = buildSrt('ghost', ghost.beats);
    assert.match(srt, /00:00:03,340 --> 00:00:04,840\nGHOST picked up\./);
    assert.match(srt, /00:00:11,940 --> 00:00:12,990\nGHOST activated\./);
    assert.match(srt, /00:00:14,170 --> 00:00:15,420\nNow fly through the trail\./);
    const laterPortrait = buildSrt('ghost', { pickup: 3.71, use: 12.26, crossing: 14.59 });
    assert.match(laterPortrait, /00:00:12,210 --> 00:00:13,260\nGHOST activated\./);
    assert.notEqual(laterPortrait, srt, 'each orientation needs its own event timing');
    assert.throws(() => buildCaptions('ghost', { pickup: 3.4, use: 12, crossing: 11 }), /in order/);
});

test('existing output path fails preflight', async () => {
    await assert.rejects(assertNewOutputDirectory(import.meta.filename), /already exists/);
});

test('export gate rejects missing frames, audio and black or frozen gameplay', () => {
    const format = { width: 1920, height: 1080 };
    const metadata = { streams: [
        { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '60/1', nb_frames: '1080' },
        { codec_type: 'audio' },
    ], format: { duration: '18.000000' } };
    assert.doesNotThrow(() => validateRenderedShortMetadata(metadata, format));
    assert.throws(() => validateRenderedShortMetadata({ ...metadata, streams: metadata.streams.slice(0, 1) }, format), /verification/);
    assert.throws(() => validateRenderedShortMetadata({ ...metadata, streams: [
        { ...metadata.streams[0], nb_frames: '1079' }, metadata.streams[1],
    ] }, format), /verification/);
    assert.doesNotThrow(() => validatePictureDiagnostics('frame=1080 time=00:00:18.00'));
    assert.throws(() => validatePictureDiagnostics('[blackdetect] black_start:3.1 black_end:3.3'), /black or frozen/);
    assert.throws(() => validatePictureDiagnostics('[freezedetect] freeze_start:9.4'), /black or frozen/);
});
