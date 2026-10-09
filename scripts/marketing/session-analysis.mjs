import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { MARKETING_PREROLL_MS, validateMarketingParticipants } from '../../src/shared/contracts/MarketingSessionContract.js';

const effectiveDamage = (event) => Number.isFinite(event.hpApplied) && Number.isFinite(event.shieldApplied)
    ? Math.max(0, event.hpApplied) + Math.max(0, event.shieldApplied) : Math.max(0, event.applied || 0);

export async function* readSessionRecords(file, expectedHash) {
    let previous = '';
    let lastSequence = -1;
    const input = createReadStream(file);
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            const batch = JSON.parse(line);
            const hash = createHash('sha256').update(previous).update(JSON.stringify(batch.records)).digest('hex');
            if (batch.previous !== previous || hash !== batch.hash || batch.sequence <= lastSequence) {
                throw new Error('journal_integrity_failed');
            }
            previous = hash; lastSequence = batch.sequence;
            for (const record of batch.records) yield record;
        }
        if (expectedHash && previous !== expectedHash) throw new Error('journal_incomplete');
    } finally { lines.close(); input.destroy(); }
}

export function chooseSessionCandidates({ manifest, matches, events, inputs, samples }) {
    const rejected = [];
    if (manifest.status !== 'complete' || manifest.provenance !== 'local-game-session') {
        return { candidates: [], rejected: ['incomplete_or_unverified_session'] };
    }
    const candidates = [];
    for (const match of matches) {
        const participantFailures = validateMarketingParticipants(manifest.setup, match.participants,
            inputs.filter((r) => r.match === match.match));
        if (participantFailures.length) { rejected.push(...participantFailures); continue; }
        const humans = match.participants.filter((p) => !p.isBot).map((p) => p.index);
        const opponents = humans.length === 2 ? [humans[1]] : match.participants.filter((p) => p.isBot).map((p) => p.index);
        for (const end of events.filter((e) => e.match === match.match && e.eventType === 'KILL')) {
            const endMs = end.timeMs + 1500;
            const startMs = endMs - 28000;
            const windowSamples = samples.filter((s) => s.match === match.match && s.round === end.round
                && s.timeMs >= startMs && s.timeMs <= endMs);
            const first = windowSamples[0];
            if (!first || first.activeMs - (first.timeMs - startMs) < MARKETING_PREROLL_MS) { rejected.push('insufficient_preroll'); continue; }
            if (windowSamples.at(-1).timeMs < endMs - 750 || windowSamples.some((s) => s.state !== 'PLAYING'
                && !(s.timeMs >= end.timeMs && ['ROUND_END', 'MATCH_END'].includes(s.state)))) {
                rejected.push('pause_or_missing_resolution'); continue;
            }
            const actions = events.filter((e) => e.match === match.match && e.round === end.round
                && e.timeMs >= startMs && e.timeMs <= endMs);
            for (const opponent of opponents) {
                const subjects = [humans[0], opponent];
                if (!subjects.includes(end.player)) continue;
                const killer = Number(/\bkiller=(-?\d+)\b/.exec(end.data || '')?.[1]);
                if (!subjects.includes(killer) || killer === end.player) { rejected.push('elimination_not_attributed_to_opponent'); continue; }
                const damage = actions.filter((e) => e.eventType === 'DAMAGE' && subjects.includes(e.player)
                    && subjects.includes(e.target) && e.player !== e.target && effectiveDamage(e) > 0);
                const totals = subjects.map((p) => damage.filter((e) => e.player === p).reduce((sum, e) => sum + effectiveDamage(e), 0));
                const share = totals[0] / (totals[0] + totals[1]);
                if (!(share >= 0.25 && share <= 0.75)) { rejected.push('one_sided_fight'); continue; }
                const rocket = actions.find((e) => e.eventType === 'ITEM_USE' && subjects.includes(e.player)
                    && /\bok=1\b/.test(e.data) && /\bmode=shoot\b/.test(e.data) && /\btype=\w*ROCKET\w*\b/.test(e.data));
                const pickup = actions.find((e) => e.eventType === 'ITEM_PICKUP' && subjects.includes(e.player)
                    && /\bok=1\b/.test(e.data));
                if (!rocket || !pickup) { rejected.push('missing_rocket_or_pickup'); continue; }
                let previousSign = 0; let reversal;
                for (const sample of windowSamples) {
                    const pilots = subjects.map((p) => sample.players.find((entry) => entry.index === p));
                    if (pilots.some((p) => !p?.alive)) { previousSign = 0; continue; }
                    const difference = (pilots[0].health + pilots[0].shieldHP) - (pilots[1].health + pilots[1].shieldHP);
                    const sign = Math.abs(difference) >= 10 ? Math.sign(difference) : 0;
                    if (sign && previousSign && sign !== previousSign) { reversal = sample; break; }
                    if (sign) previousSign = sign;
                }
                if (!reversal) { rejected.push('no_measured_reversal'); continue; }
                // Third-party damage is not silently attributed to the duel.
                if (actions.some((e) => e.eventType === 'DAMAGE' && subjects.includes(e.target)
                    && !subjects.includes(e.player) && effectiveDamage(e) > 0)) { rejected.push('third_party_damage'); continue; }
                if (candidates.some((c) => c.match === match.match && Math.abs(c.startMs - startMs) < 30000)) continue;
                const label = (index) => match.participants.find((p) => p.index === index)?.isBot ? `Bot ${index + 1}` : `Player ${index + 1}`;
                const caption = (event, text) => ({ start: (event.timeMs - startMs) / 1000,
                    end: Math.min(28, (event.timeMs - startMs) / 1000 + 2.4), text, eventId: event.id, player: event.player });
                const captions = [caption(pickup, `${label(pickup.player)} collects an item`),
                    caption(rocket, `${label(rocket.player)} fires a rocket`), caption(end, `${label(end.player)} is eliminated`)]
                    .sort((a, b) => a.start - b.start);
                const readable = captions.every((c, i) => c.end - c.start >= Math.max(1, c.text.length / 17)
                    && (!i || captions[i - 1].end <= c.start));
                if (!readable) { rejected.push('captions_overlap_or_too_fast'); continue; }
                candidates.push({ match: match.match, round: end.round, startMs, endMs, resolutionMs: end.timeMs, subjects,
                    modeLabel: humans.length === 1 ? 'Human vs bots' : 'Two local humans + bots',
                    metadata: match.metadata, captions, damageShare: share, reversalMs: reversal.timeMs,
                    criticalTimes: [pickup.timeMs, rocket.timeMs, end.timeMs, reversal.timeMs, ...damage.map((e) => e.timeMs)],
                    eventIds: [pickup.id, rocket.id, end.id], score: 100 - Math.abs(share - 0.5) * 100 });
            }
        }
    }
    return { candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 3), rejected: [...new Set(rejected)] };
}

export async function analyzeSession(manifest, journalPath) {
    const matches = [], events = [], inputs = [], samples = [];
    let lastSample = -Infinity; let eventId = 0;
    const evidenceKeys = new Set();
    for await (const record of readSessionRecords(journalPath, manifest.journalSha256)) {
        if (record.type === 'match-start') matches.push(record);
        if (record.type === 'event') events.push({ ...record, id: `event-${++eventId}` });
        if (['physical-input', 'applied-input'].includes(record.type)) {
            const key = [record.match, record.player, record.type, record.source, record.trusted, record.active].join(':');
            if (!evidenceKeys.has(key)) { inputs.push(record); evidenceKeys.add(key); }
        }
        if (record.type === 'snapshot' && record.timeMs - lastSample >= 400) {
            lastSample = record.timeMs;
            samples.push({ timeMs: record.timeMs, activeMs: record.activeMs, match: record.match, round: record.round,
                state: record.snapshot.gameStateId,
                players: record.snapshot.players.map((p) => ({ index: p.index, alive: p.alive,
                    health: Number(p.health) || 0, shieldHP: Number(p.shieldHP) || 0 })) });
        }
        if (events.length > 500000 || samples.length > 100000) throw new Error('analysis_size_limit');
    }
    return chooseSessionCandidates({ manifest, matches, events, inputs, samples });
}

export async function loadCandidateReplay(manifest, journalPath, candidate) {
    const snapshots = []; let previousTime = null; let lastTime = null;
    // Read from round start: older trails must exist before the first exported frame.
    for await (const record of readSessionRecords(journalPath, manifest.journalSha256)) {
        if (record.type !== 'snapshot' || record.match !== candidate.match || record.round !== candidate.round
            || record.timeMs > candidate.endMs + 100) continue;
        // Warmup applies ordered trail deltas without exporting images. Loading
        // stalls there do not invalidate a later, fully sampled clip.
        if (previousTime !== null && (record.snapshot.timeMs <= previousTime
            || (record.snapshot.timeMs >= candidate.startMs && previousTime < candidate.endMs
                && record.snapshot.timeMs - previousTime > 150))) throw new Error('replay_sample_gap');
        if (record.timeMs >= candidate.startMs && record.timeMs <= candidate.endMs
            && record.snapshot.gameStateId !== 'PLAYING'
            && !(record.timeMs >= candidate.resolutionMs && ['ROUND_END', 'MATCH_END'].includes(record.snapshot.gameStateId))) {
            throw new Error('pause_in_selected_interval');
        }
        previousTime = record.snapshot.timeMs; lastTime = previousTime;
        if (snapshots.length < 2) snapshots.push(record.snapshot);
    }
    if (snapshots.length < 2 || lastTime < candidate.endMs) throw new Error('replay_resolution_missing');
    return { contractVersion: 'cinematic-replay.v2', matchId: `marketing-${candidate.match}`,
        sampleFps: manifest.snapshotTargetFps === 60 ? 60 : 30,
        durationMs: candidate.endMs, exportStartMs: candidate.startMs, snapshots, subjects: candidate.subjects,
        metadata: { ...candidate.metadata, localPlayerIndex: candidate.subjects[0], hudMode: 'clean',
            settings: { ...candidate.metadata.settings, recording: { profile: 'cinematic', orientation: 'portrait', hudMode: 'clean' } } } };
}
