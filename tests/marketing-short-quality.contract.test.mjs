import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    SHORT_BRIEF_VERSION, SHORT_EVIDENCE_VERSION, SHORT_PACKAGE_VERSION, SHORT_REVIEW_VERSION,
    checkHandoffMotion, validateBrief, validateCopy, validateEvidence,
    validateModelUsage, validateReview,
} from '../scripts/marketing/short-quality-contract.mjs';
import { validateMediaDiagnostics, validatePreparedPackage, validateSrt,
    validateVideoMetadata } from '../scripts/marketing/short-quality.mjs';
import { isRetryableCandidateFailure, produceShort } from '../scripts/marketing/produce-short.mjs';
import { buildTrailTemplateCopy } from '../scripts/marketing/short-copy-templates.mjs';

const brief = validateBrief({
    contractVersion: SHORT_BRIEF_VERSION, id: 'dandelion-duel', topic: 'A narrow escape',
    scene: 'Two pilots turn around existing trails and escape at the last moment.',
    keyClaim: 'A trail changes the duel.', scenario: 'custom', mode: 'CLASSIC',
    mapKey: 'dandelion_sky', subjectPlayer: 0,
    requiredEvents: ['TRAILS_PRESENT', 'NEAR_MISS'],
    platforms: ['youtube-shorts', 'tiktok', 'instagram-reels'],
    callToAction: { phase: 'pre-demo', url: 'https://curviosclash.itch.io/' },
});

function camera(x) {
    return { position: [x, 10, 0], quaternion: [0, 0, 0, 1], fov: 70 };
}

function handoff() {
    return { at: 3, direction: 'to-gameplay', playerIndex: 0, hudFadeSeconds: 0.5,
        samples: {
            '-2': { cinematic: camera(0), gameplay: camera(0) },
            '-1': { cinematic: camera(0.1), gameplay: camera(0.1) },
            '0': { cinematic: camera(0.2), gameplay: camera(0.2) },
            '1': { cinematic: camera(0.3), gameplay: camera(0.3) },
        } };
}

function evidence() {
    return { contractVersion: SHORT_EVIDENCE_VERSION, briefId: brief.id,
        buildCommit: 'abc123', mode: brief.mode, mapKey: brief.mapKey,
        assets: [{ id: 'gameplay', source: 'desktop build' }, { id: 'music', source: 'licensed track' }],
        events: [
            { id: 'trails-start', type: 'TRAILS_PRESENT', at: 0 },
            { id: 'escape', type: 'NEAR_MISS', at: 5 },
        ],
        timeline: [
            { kind: 'cinematic', outputStart: 0, sourceTime: 0, duration: 3 },
            { kind: 'gameplay', outputStart: 3, sourceTime: 3, duration: 13 },
            { kind: 'endcard', outputStart: 16, duration: 2 },
        ],
        trailsAtStart: [{ playerId: 0, segmentCount: 40 }, { playerId: 1, segmentCount: 35 }],
        handoffs: [handoff()],
    };
}

function copy() {
    return { language: 'en', provenance: 'approved-example.v1',
        title: { text: 'A narrow escape', kind: 'gameplay', eventIds: ['escape'] },
        description: [
            { text: 'Two pilots weave past their trails.', kind: 'gameplay', eventIds: ['trails-start'] },
            { text: 'Follow development.', kind: 'cta' },
        ],
        captions: [
            { start: 0.2, end: 1.8, text: 'Two trails close the route.', kind: 'gameplay', eventIds: ['trails-start'] },
            { start: 4.7, end: 6.2, text: 'A narrow escape.', kind: 'gameplay', eventIds: ['escape'] },
        ],
        callToAction: brief.callToAction,
    };
}

function review() {
    return { contractVersion: SHORT_REVIEW_VERSION, briefId: brief.id,
        fullWatch: { withSound: true, withoutSound: true, visualStory: true, mobileFraming: true,
            distinctiveMap: true, trailsReadable: true, playersReadable: true,
            transitionsSmooth: true, captionsReadable: true, noFlash: true,
            musicAndEffects: true, cover: true },
        phoneDevice: 'Android phone, portrait',
        testers: Array.from({ length: 5 }, (_, index) => ({ testerId: `person-${index + 1}`,
            independent: true, understood: index !== 4 })),
        rights: evidence().assets.map((asset) => ({ assetId: asset.id, source: asset.source,
            approvedBy: 'owner', evidence: 'license record', platforms: brief.platforms })),
        developmentStatusApproved: true, claimsApproved: true, linkApproved: true,
        reviewer: 'editor', reviewedAt: '2026-09-28T12:00:00Z',
    };
}

test('brief locks scenario, map, event claims and destination link', () => {
    assert.equal(brief.id, 'dandelion-duel');
    assert.throws(() => validateBrief({ ...brief, contractVersion: 'unknown' }), /marketing-short-brief/);
    assert.throws(() => validateBrief({ ...brief, callToAction: {
        phase: 'demo-live', url: 'https://curviosclash.itch.io/',
    } }), /approved game page/);
    assert.throws(() => validateBrief({ ...brief, requiredEvents: [] }), /requiredEvents/);
});

test('event evidence blocks a false gameplay claim and wrong player', () => {
    assert.equal(validateEvidence(brief, evidence()).events.length, 2);
    assert.throws(() => validateEvidence(brief, { ...evidence(), events: evidence().events.slice(0, 1) }), /required events/);
    assert.throws(() => validateEvidence(brief, { ...evidence(), handoffs: [{ ...handoff(), playerIndex: 1 }] }), /wrong player/);
    assert.throws(() => validateEvidence(brief, { ...evidence(), trailsAtStart: [{ playerId: 0, segmentCount: 40 }] }), /two players/);
    assert.throws(() => validateEvidence(brief, { ...evidence(), timeline: [
        { kind: 'cinematic', outputStart: 0, sourceTime: 0, duration: 3 },
        { kind: 'gameplay', outputStart: 3, sourceTime: 2, duration: 13 },
        { kind: 'endcard', outputStart: 16, duration: 2 },
    ] }), /backward/);
    assert.throws(() => validateEvidence(brief, { ...evidence(), events: [
        evidence().events[0], { ...evidence().events[1], at: 17 },
    ] }), /outside the gameplay timeline/);
});

test('matching camera pose still fails when movement jerks across the cut', () => {
    assert.deepEqual(checkHandoffMotion(handoff()).failures, []);
    const jerk = handoff();
    jerk.samples['-2'].cinematic = camera(-1.5);
    jerk.samples['-1'].cinematic = camera(0);
    jerk.samples['0'].gameplay = camera(0);
    jerk.samples['1'].gameplay = camera(0);
    assert.match(checkHandoffMotion(jerk).failures.join(' '), /movement jerks/);
    assert.throws(() => validateEvidence(brief, { ...evidence(), handoffs: [jerk] }), /movement jerks/);
});

test('captions must be English, timed and tied to an actual event', () => {
    assert.equal(validateCopy(brief, evidence(), copy()).captions.length, 2);
    const missing = copy();
    missing.captions[1] = { ...missing.captions[1], eventIds: ['invented'] };
    assert.throws(() => validateCopy(brief, evidence(), missing), /recorded event IDs/);
    const early = copy();
    early.captions[1] = { ...early.captions[1], start: 2.5, end: 4.1 };
    assert.throws(() => validateCopy(brief, evidence(), early), /not timed/);
    assert.throws(() => validateCopy(brief, evidence(), { ...copy(), language: 'de' }), /English/);
});

test('approved THICK wording requires a recorded width increase, not only an item use', () => {
    const thickBrief = validateBrief({ ...brief, scenario: 'thick', mapKey: 'standard',
        requiredEvents: ['ITEM_USE', 'TRAIL_WIDENED'],
        approvedFacts: [{ id: 'classic-mode', approvedBy: 'product owner' }] });
    const thickEvidence = { ...evidence(), mapKey: 'standard', events: [
        { id: 'trails-start', type: 'TRAILS_PRESENT', at: 0 },
        { id: 'trails-duel', type: 'TRAILS_PRESENT', at: 3.3 },
        { id: 'use', type: 'ITEM_USE', at: 11 },
    ] };
    assert.throws(() => buildTrailTemplateCopy(thickBrief, thickEvidence, { use: 11 }), /effect has no recorded event/);
    thickEvidence.events.push({ id: 'widened', type: 'TRAIL_WIDENED', at: 11.5,
        beforeWidth: 0.6, afterWidth: 3 });
    const result = buildTrailTemplateCopy(thickBrief, thickEvidence, { use: 11 });
    assert.deepEqual(result.title.eventIds, ['widened']);
    assert.equal(validateCopy(thickBrief, thickEvidence, result).captions.length, 6);
});

test('technical gate rejects missing frames, silent audio, black and frozen gameplay', () => {
    const metadata = { streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920,
            avg_frame_rate: '60/1', nb_frames: '1080' },
        { codec_type: 'audio', codec_name: 'aac', start_time: '0', duration: '18' },
    ], format: { duration: '18' } };
    assert.equal(validateVideoMetadata(metadata).frames, 1080);
    assert.throws(() => validateVideoMetadata({ ...metadata, streams: [
        { ...metadata.streams[0], nb_frames: '1070' }, metadata.streams[1],
    ] }), /frames/);
    assert.throws(() => validateVideoMetadata({ ...metadata, streams: metadata.streams.slice(0, 1) }), /AAC/);
    assert.throws(() => validateVideoMetadata({ ...metadata, streams: [
        metadata.streams[0], { ...metadata.streams[1], duration: '14' },
    ] }), /audio/);
    assert.deepEqual(validateMediaDiagnostics('', 'max_volume: -1.0 dB'), { maxVolumeDb: -1, silenceIntervals: 0 });
    assert.throws(() => validateMediaDiagnostics('black_start:2', 'max_volume: -1.0 dB'), /black/);
    assert.throws(() => validateMediaDiagnostics('freeze_start:2', 'max_volume: -1.0 dB'), /frozen/);
    assert.throws(() => validateMediaDiagnostics('', 'silence_start: 1\nsilence_end: 2|max_volume: -1.0 dB'), /silence/);
    assert.throws(() => validateMediaDiagnostics('', 'silence_start: 1\nsilence_end: 1.2\nsilence_start: 3\nmax_volume: -1.0 dB'), /silence/);
    assert.throws(() => validateMediaDiagnostics('', 'max_volume: 0.0 dB'), /clipping/);
});

test('subtitle file matches exactly the approved event-timed copy', () => {
    const srt = '1\n00:00:00,200 --> 00:00:01,800\nTwo trails close the route.\n\n'
        + '2\n00:00:04,700 --> 00:00:06,200\nA narrow escape.\n';
    assert.equal(validateSrt(srt, copy().captions), 2);
    assert.throws(() => validateSrt(srt.replace('A narrow escape.', 'A rocket hits.'), copy().captions), /differs/);
});

test('release needs every phone check, rights and four of five independent viewers', () => {
    assert.equal(validateReview(review(), brief, evidence()).understood, 4);
    const three = review();
    three.testers[3].understood = false;
    assert.throws(() => validateReview(three, brief, evidence()), /four of five/);
    const duplicate = review();
    duplicate.testers[4].testerId = duplicate.testers[0].testerId;
    assert.throws(() => validateReview(duplicate, brief, evidence()), /five independent/);
    const noRights = review();
    noRights.rights[0].platforms = ['youtube-shorts'];
    assert.throws(() => validateReview(noRights, brief, evidence()), /rights/);
    const wrongSource = review();
    wrongSource.rights[0].source = 'another asset';
    assert.throws(() => validateReview(wrongSource, brief, evidence()), /rights/);
    const falseClaim = review();
    falseClaim.claimsApproved = false;
    assert.throws(() => validateReview(falseClaim, brief, evidence()), /claims/);
    const standard = { ...brief, mapKey: 'standard' };
    assert.throws(() => validateReview(review(), standard, evidence()), /standard arena/);
});

test('incomplete publication package cannot enter the release gate', () => {
    const valid = { contractVersion: SHORT_PACKAGE_VERSION, briefId: brief.id, status: 'needs-human-review',
        title: 'A narrow escape', description: 'Development footage.', callToAction: brief.callToAction,
        platforms: brief.platforms, assets: evidence().assets,
        checks: { video: { frames: 1080 }, audio: { maxVolumeDb: -1 }, events: 2, handoffs: 1, captions: 2 },
        preview: { contactSheet: 'quality-preview/contact-sheet.png' },
        files: { video: 'short.mp4', cover: 'cover.png', subtitles: 'captions.srt' },
        hashes: { video: 'a'.repeat(64), cover: 'b'.repeat(64), subtitles: 'c'.repeat(64) },
        sources: { brief: 'brief.json', evidence: 'evidence.json', copy: 'copy.json' },
        sourceHashes: { brief: 'd'.repeat(64), evidence: 'e'.repeat(64), copy: 'f'.repeat(64) },
        modelUsage: { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, revisions: 0 },
    };
    assert.equal(validatePreparedPackage(valid).briefId, brief.id);
    assert.throws(() => validatePreparedPackage({ ...valid, files: { video: 'short.mp4' } }), /cover/);
    assert.throws(() => validatePreparedPackage({ ...valid, checks: { ...valid.checks, audio: null } }), /incomplete/);
});

test('model usage accepts measured counts and rejects invented zero-call spending', () => {
    assert.equal(validateModelUsage({ calls: 0, inputTokens: 0, outputTokens: 0,
        cachedTokens: 0, revisions: 0 }).calls, 0);
    assert.throws(() => validateModelUsage({ calls: 0, inputTokens: 200,
        outputTokens: 0, cachedTokens: 0, revisions: 0 }), /zero model calls/);
    assert.throws(() => validateModelUsage({ calls: 1, inputTokens: 100,
        outputTokens: 20, cachedTokens: 101, revisions: 0, source: 'response usage' }), /counts/);
});

test('capture retries are bounded and do not repeat nonrecoverable errors', async (t) => {
    assert.equal(isRetryableCandidateFailure(new Error('Rehearsal failed: pilots crashed')), true);
    assert.equal(isRetryableCandidateFailure(new Error('commercial rights missing')), false);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'marketing-short-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const briefPath = path.join(directory, 'brief.json');
    await writeFile(briefPath, JSON.stringify({ ...brief, id: 'trail-retry', scenario: 'thick',
        mapKey: 'standard', subjectPlayer: 0, requiredEvents: ['ITEM_USE', 'TRAIL_WIDENED'],
        approvedFacts: [{ id: 'classic-mode', approvedBy: 'product owner' }],
    }));
    let attempts = 0;
    await assert.rejects(produceShort({ briefPath, outputRoot: path.join(directory, 'out'),
        root: process.cwd(), capture: async () => { attempts += 1; throw new Error('Rehearsal failed'); },
    }), /after 3 attempt/);
    assert.equal(attempts, 3);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'out', 'candidates.json'), 'utf8')).length, 3);
});
