import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    assertNewOutputDirectory,
    buildRenderArgs,
    buildSrt,
    buildTimeline,
    packetEndTime,
    validateTake,
} from '../scripts/marketing/render-trail-short.mjs';

const entry = {
    gameplay: path.resolve('a video; no shell.webm'),
    cinematic: path.resolve('cinematic.mp4'),
    gameplayStart: 1.25,
    cinematicStart: 2.5,
};

test('take requires both orientations, finite offsets, and resolved input paths', () => {
    const raw = { orientations: {
        landscape: { gameplay: 'game.webm', cinematic: 'cinema.webm', gameplayStart: 1, cinematicStart: 2 },
        portrait: { gameplay: 'tall.webm', cinematic: 'tall-cinema.webm', gameplayStart: 3, cinematicStart: 4 },
    } };
    const entries = validateTake(raw, path.resolve('takes'));
    assert.equal(entries.landscape.gameplay, path.resolve('takes/game.webm'));
    assert.equal(entries.portrait.cinematicStart, 4);
    assert.throws(() => validateTake({ orientations: { landscape: raw.orientations.landscape } }, '.'), /portrait/);
    assert.throws(() => validateTake({ orientations: {
        ...raw.orientations, portrait: { ...raw.orientations.portrait, gameplayStart: Infinity },
    } }, '.'), /finite/);
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
        const captionTop = Number(/textfile=captions\/hook\.txt:[^;]*?:y=(\d+)/.exec(graph)?.[1]);
        assert.equal(captionTop, name === 'landscape' ? 157 : 230);
        if (name === 'landscape') assert.ok(captionTop > 126 && captionTop + 58 + 18 < 252);
        assert.match(graph, /trim=start=11\.25:duration=6,.*\[v3\]/);
        assert.match(graph, /captions\/thick\.txt.*enable='between\(t,10\.55,13\.6\)'/);
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

test('subtitles follow the hook, duel, mode, and THICK item beats', () => {
    const srt = buildSrt();
    assert.match(srt, /00:00:00,250 --> 00:00:02,350\nYour trail is a weapon\./);
    assert.match(srt, /00:00:07,250 --> 00:00:08,850\nClassic mode\./);
    assert.match(srt, /00:00:10,550 --> 00:00:13,600\nTHICK makes the trail wider\./);
    assert.match(srt, /00:00:16,000 --> 00:00:18,000\nCURVIOSCLASH\nFollow development\./);
});

test('GHOST cut follows the real pickup, activation and crossing and keeps trails behind its endcard', () => {
    const args = buildRenderArgs('portrait', entry, 'ghost');
    const graph = args[args.indexOf('-filter_complex') + 1];
    assert.match(graph, /trim=start=10:duration=3/);
    assert.match(graph, /trim=start=4\.25:duration=13/);
    assert.match(graph, /tpad=stop_mode=clone:stop_duration=2/);
    assert.match(graph, /\[hookaudio\]\[storyaudio\]concat=n=2:v=0:a=1/);
    assert.match(graph, /captions\/classic\.txt.*between\(t,11\.5,12\.8\)/);
    assert.match(graph, /captions\/effect\.txt.*between\(t,13\.4,15\.3\)/);
    assert.doesNotMatch(graph, /color=c=0x081320/);
    const srt = buildSrt('ghost');
    assert.match(srt, /00:00:11,500 --> 00:00:12,800\nUse GHOST\./);
    assert.match(srt, /00:00:13,400 --> 00:00:15,300\nThrough the trail\./);
});

test('existing output path fails preflight', async () => {
    await assert.rejects(assertNewOutputDirectory(import.meta.filename), /already exists/);
});
