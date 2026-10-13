import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeMarketingSetup, validateMarketingParticipants } from '../src/shared/contracts/MarketingSessionContract.js';
import { chooseSessionCandidates, readSessionRecords, loadCandidateReplay } from '../scripts/marketing/session-analysis.mjs';
import { checkCameraSamples } from '../scripts/marketing/process-session.mjs';

function fixture(humans = 1) {
    const setup = normalizeMarketingSetup({ humans, bots: 3, confirmedHumans: humans });
    const participants = Array.from({ length: humans + 3 }, (_, index) => ({ index, isBot: index >= humans }));
    const inputs = participants.filter((p) => !p.isBot).flatMap((p) => [
        { match: 1, player: p.index, type: 'physical-input', source: 'keydown', trusted: true },
        { match: 1, player: p.index, type: 'applied-input', source: 'keyboard', active: true },
    ]);
    const events = [
        { id: 'pickup', eventType: 'ITEM_PICKUP', timeMs: 126000, player: 0, data: 'ok=1 type=ROCKET' },
        { id: 'rocket', eventType: 'ITEM_USE', timeMs: 132000, player: 0, data: 'ok=1 mode=shoot type=ROCKET' },
        { id: 'damage-1', eventType: 'DAMAGE', timeMs: 133000, player: 0, target: 1, applied: 60 },
        { id: 'damage-2', eventType: 'DAMAGE', timeMs: 140000, player: 1, target: 0, applied: 55 },
        { id: 'death', eventType: 'KILL', timeMs: 148000, player: 1, data: 'cause=projectile killer=0' },
    ].map((e) => ({ ...e, match: 1, round: 1 }));
    const samples = Array.from({ length: 58 }, (_, i) => ({ match: 1, round: 1,
        timeMs: 121500 + i * 500, activeMs: 121500 + i * 500, state: 'PLAYING',
        players: [{ index: 0, alive: true, health: i < 25 ? 60 : 100, shieldHP: 0 },
            { index: 1, alive: true, health: i < 25 ? 100 : 60, shieldHP: 0 }] }));
    return { manifest: { status: 'complete', provenance: 'local-game-session', setup },
        matches: [{ match: 1, metadata: {}, participants }], inputs, events, samples };
}

test('setup supports solo and local two-player sessions without relabeling bots', () => {
    for (const humans of [1, 2]) {
        const data = fixture(humans);
        const result = chooseSessionCandidates(data);
        assert.equal(result.candidates.length, 1);
        assert.equal(result.candidates[0].modeLabel, humans === 1 ? 'Human vs bots' : 'Two local humans + bots');
        assert.equal(result.candidates[0].captions.at(-1).text, humans === 1 ? 'Bot 2 is eliminated' : 'Player 2 is eliminated');
    }
    assert.throws(() => normalizeMarketingSetup({ humans: 2, bots: 3, confirmedHumans: 1 }));
    assert.throws(() => normalizeMarketingSetup({ humans: 0, bots: 3, confirmedHumans: 0 }));
});

test('non-bot slots alone, scripted sources and synthetic events cannot establish human provenance', () => {
    const data = fixture(2);
    assert.ok(validateMarketingParticipants(data.manifest.setup, data.matches[0].participants, []).length);
    data.inputs.push({ match: 1, player: 1, type: 'applied-input', source: 'scripted-input', active: true });
    assert.equal(chooseSessionCandidates(data).candidates.length, 0);
    const synthetic = fixture(); synthetic.inputs[0].trusted = false;
    assert.equal(chooseSessionCandidates(synthetic).candidates.length, 0);
});

test('selection rejects insufficient preroll, one-sided fights, third parties and fabricated rocket claims', () => {
    const mutations = [
        (data) => { data.samples.forEach((s) => { s.activeMs -= 100000; }); },
        (data) => { data.events.find((e) => e.id === 'damage-2').applied = 1; },
        (data) => { data.events.find((e) => e.id === 'rocket').data = 'ok=0 mode=shoot type=ROCKET'; },
        (data) => { data.events.push({ match: 1, round: 1, timeMs: 145000, eventType: 'DAMAGE', player: 2, target: 0, applied: 5 }); },
        (data) => { data.samples.forEach((s) => { s.players[0].health = 10; }); },
        (data) => { data.manifest.status = 'partial'; },
        (data) => { data.manifest.provenance = 'scripted-input'; },
        (data) => { data.events.at(-1).data = 'cause=projectile killer=3'; },
        (data) => { data.events.at(-1).data = 'cause=wall killer=-1'; },
    ];
    for (const mutate of mutations) {
        const data = fixture(); mutate(data);
        assert.equal(chooseSessionCandidates(data).candidates.length, 0);
    }
});

test('caption overlap and paused action are rejected instead of silently rearranging events', () => {
    const data = fixture(); data.events[1].timeMs = data.events[0].timeMs + 200;
    assert.equal(chooseSessionCandidates(data).candidates.length, 0);
    const paused = fixture(); paused.samples[3].state = 'PAUSED';
    assert.equal(chooseSessionCandidates(paused).candidates.length, 0);
});

test('duel balance uses actual health and shield loss instead of requested overkill damage', () => {
    const data = fixture();
    Object.assign(data.events[2], { applied: 1000, hpApplied: 40, shieldApplied: 20 });
    Object.assign(data.events[3], { applied: 1000, hpApplied: 55, shieldApplied: 0 });
    assert.equal(chooseSessionCandidates(data).candidates[0].damageShare, 60 / 115);
    data.events[3].hpApplied = 1;
    assert.equal(chooseSessionCandidates(data).candidates.length, 0);
});

test('warmup loading gaps are allowed, but missing frames inside or across the clip boundary are rejected', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'curvios-replay-gap-'));
    const file = path.join(directory, 'journal.ndjson');
    const candidate = { match: 1, round: 0, startMs: 5000, endMs: 5100, subjects: [0, 1], metadata: {} };
    async function load(times, snapshotTargetFps) {
        const records = times.map((timeMs) => ({ type: 'snapshot', match: 1, round: 0, timeMs,
            snapshot: { timeMs, gameStateId: 'PLAYING' } }));
        const hash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
        await writeFile(file, JSON.stringify({ sequence: 0, previous: '', hash, records }) + '\n');
        return loadCandidateReplay({ journalSha256: hash, snapshotTargetFps }, file, candidate);
    }
    assert.equal((await load([500, 4000, 4900, 5000, 5050, 5100])).sampleFps, 30);
    assert.equal((await load([500, 4000, 4900, 5000, 5050, 5100], 60)).sampleFps, 60);
    await assert.rejects(load([500, 4000, 5000, 5050, 5100]), /replay_sample_gap/);
    await assert.rejects(load([500, 4900, 5000, 5200]), /replay_sample_gap/);
});

test('the decisive elimination can include its match-end resolution, but not an earlier match end', () => {
    const data = fixture();
    data.samples.filter((s) => s.timeMs >= 148000).forEach((s) => { s.state = 'MATCH_END'; });
    assert.equal(chooseSessionCandidates(data).candidates.length, 1);
    data.samples[5].state = 'MATCH_END';
    assert.equal(chooseSessionCandidates(data).candidates.length, 0);
});

test('journal validates the chain, truncation and modified event payloads', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'curvios-journal-test-'));
    const file = path.join(directory, 'journal.ndjson');
    const records = [{ type: 'event', eventType: 'ITEM_USE', timeMs: 10 }];
    const hash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    await writeFile(file, JSON.stringify({ sequence: 0, previous: '', hash, records }) + '\n');
    const collected = []; for await (const r of readSessionRecords(file, hash)) collected.push(r);
    assert.deepEqual(collected, records);
    const consume = async (expected) => { for await (const record of readSessionRecords(file, expected)) void record; };
    await assert.rejects(consume('bad'), /journal_incomplete/);
    await writeFile(file, (await readFile(file, 'utf8')).replace('ITEM_USE', 'DEATH'));
    await assert.rejects(consume(hash), /journal_integrity_failed/);
});

test('camera quality gate detects an instantaneous jump even with an otherwise valid export', () => {
    const samples = [0, 0.2, 0.4].map((x, frame) => ({ frame, position: { x, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 60 }));
    assert.deepEqual(checkCameraSamples(samples), []);
    samples[1].position.x = 100;
    assert.ok(checkCameraSamples(samples).length);
});
