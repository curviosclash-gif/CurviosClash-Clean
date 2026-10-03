// Belegt die Spielerzeilen der Rundentelemetrie: erst sie verbinden Fahrzeug,
// Waffe und Rundenausgang, sodass sich Fahrzeuge und Waffen gegeneinander
// abwaegen lassen. Die Rundensummen allein verraten nicht, wer womit gewann.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTelemetryReport } from '../scripts/telemetry-report-lib.mjs';
import { RoundRecorder } from '../src/state/RoundRecorder.js';
import { normalizeTelemetryHistoryEntry } from '../src/state/telemetry/TelemetryHistoryEntry.js';
import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';

test('the recorder hands one row per player with vehicle, kills and damage by weapon to the round summary', () => {
    const shooter = { index: 0, isBot: false, vehicleId: 'ship5', teamId: 'alpha' };
    const victim = { index: 1, isBot: true, vehicleId: 'ship7' };
    const parked = { index: 2, isBot: true, vehicleId: 'ship9', entitySlotActive: false };
    const recorder = new RoundRecorder();
    recorder.startRound([shooter, victim]);
    recorder.recordDamageEvent({ sourcePlayer: shooter, target: victim, damageResult: { applied: 40, absorbedByShield: 10 }, projectileType: 'rocket_strong' });
    recorder.recordDamageEvent({ sourcePlayer: shooter, target: victim, damageResult: { applied: 5, hpApplied: 5 }, cause: 'MG_BULLET' });
    // Eigenschaden zaehlt als erlitten, aber nicht als ausgeteilt.
    recorder.recordDamageEvent({ sourcePlayer: victim, target: victim, damageResult: { applied: 9, hpApplied: 9 }, cause: 'MG_BULLET' });
    recorder.logEvent('KILL', 1, 'cause=PROJECTILE killer=0 weapon=ROCKET_STRONG');
    recorder.logEvent('KILL', 0, 'cause=WALL killer=-1');

    const summary = recorder.finalizeRound(shooter, [shooter, victim, parked]);

    assert.deepEqual(summary.playerStats, [
        {
            index: 0, isBot: false, vehicleId: 'ship5', teamId: 'alpha', won: true,
            kills: 1, deaths: 1, damageDealt: 45, damageTaken: 0,
            killsByType: { ROCKET_STRONG: 1 }, damageByType: { ROCKET_STRONG: 40, MG_BULLET: 5 },
        },
        {
            index: 1, isBot: true, vehicleId: 'ship7', teamId: '', won: false,
            kills: 0, deaths: 1, damageDealt: 0, damageTaken: 54,
            killsByType: {}, damageByType: {},
        },
    ]);
    assert.deepEqual(recorder.getLastRoundMetrics().playerStats, summary.playerStats);

    recorder.startRound([shooter, victim]);
    const next = recorder.finalizeRound(null, [shooter, victim]);
    assert.equal(next.playerStats[0].kills, 0, 'eine neue Runde beginnt bei null');
    assert.equal(next.playerStats[0].won, false);
});

test('the round payload carries the player rows into the history entry', () => {
    const players = [{ index: 0, isBot: false }];
    const game = { entityManager: { players, getHumanPlayers: () => players, getHuntScoreboard: () => [] } };
    const controller = new MatchFlowTelemetryController({ game });
    const playerStats = [{ index: 0, isBot: false, vehicleId: 'ship5', won: true, kills: 2 }];
    const payload = controller.buildRoundEndTelemetryPayload({
        outcome: { state: 'ROUND_END' },
        recording: { roundMetrics: { winnerIndex: 0, duration: 30, playerStats } },
    });
    assert.equal(payload.telemetrySchemaVersion, 'round-telemetry.v3');
    assert.deepEqual(payload.players, playerStats);
    assert.equal(normalizeTelemetryHistoryEntry(payload).players[0].kills, 2);
});

test('history entries keep sane player rows and older rounds read as none', () => {
    const entry = normalizeTelemetryHistoryEntry({
        players: [
            {
                index: 2, isBot: true, vehicleId: ' ship7 ', won: 'yes', kills: -3, deaths: 2.7, damageDealt: 'x',
                killsByType: { rocket_strong: 2, '': 4 }, damageByType: { mg_bullet: 12.34 },
            },
            null,
        ],
    });
    assert.deepEqual(entry.players, [{
        index: 2, isBot: true, vehicleId: 'ship7', teamId: '', won: false,
        kills: 0, deaths: 2, damageDealt: 0, damageTaken: 0,
        killsByType: { ROCKET_STRONG: 2 }, damageByType: { MG_BULLET: 12.3 },
    }]);
    assert.deepEqual(normalizeTelemetryHistoryEntry({}).players, []);
});

function balanceRound(winnerIndex, overrides = {}) {
    return {
        at: '2026-10-01T10:00:00.000Z', mode: 'hunt', mapKey: 'pyramid', duration: 120,
        humanCount: 1, botCount: 1, botDifficulty: 'HARD', control: { source: 'human' },
        winnerType: winnerIndex === 0 ? 'human' : 'bot',
        players: [
            {
                index: 0, isBot: false, vehicleId: 'ship5', won: winnerIndex === 0, kills: 2, deaths: 1, damageDealt: 100,
                killsByType: { ROCKET_STRONG: 2 }, damageByType: { ROCKET_STRONG: 80, MG_BULLET: 20 },
            },
            {
                index: 1, isBot: true, vehicleId: 'ship7', won: winnerIndex === 1, kills: 1, deaths: 2, damageDealt: 60,
                killsByType: { MG_BULLET: 1 }, damageByType: { MG_BULLET: 60 },
            },
        ],
        ...overrides,
    };
}

test('real play rounds yield vehicle and weapon balance tables', () => {
    const { data, markdown } = buildTelemetryReport([
        balanceRound(0),
        balanceRound(0),
        balanceRound(1),
        balanceRound(1, { control: { source: 'automation' } }),
    ]);
    const ship5 = data.realPlay.vehicles.find((row) => row.vehicleId === 'ship5');
    assert.deepEqual(ship5, {
        vehicleId: 'ship5', controller: 'Mensch', seats: 3,
        winRate: 67, winInterval: [21, 94], expectedWinRate: 50,
        killsPerMinute: 1, deathsPerMinute: 0.5, damagePerMinute: 50,
        enough: false,
    });
    assert.equal(data.realPlay.vehicles.find((row) => row.vehicleId === 'ship7').controller, 'Bot');
    assert.deepEqual(data.realPlay.weapons, [
        { type: 'MG_BULLET', damage: 240, damageShare: 50, kills: 3, killShare: 33 },
        { type: 'ROCKET_STRONG', damage: 240, damageShare: 50, kills: 6, killShare: 67 },
    ]);
    assert.match(markdown, /### Fahrzeuge/);
    assert.match(markdown, /### Waffen/);
    assert.match(markdown, /\| ship5 \| Mensch \| 3 \| 67 % \(21–94\) \| 50 % \|/);
});

test('a history without player rows explains the gap instead of printing empty tables', () => {
    const { data, markdown } = buildTelemetryReport([{ at: '2026-09-01T10:00:00.000Z', control: { source: 'human' } }]);
    assert.deepEqual(data.realPlay.vehicles, []);
    assert.deepEqual(data.realPlay.weapons, []);
    assert.match(markdown, /Noch keine Spielerzeilen/);
    assert.doesNotMatch(markdown, /NaN|undefined/);
});
