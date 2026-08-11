import test from 'node:test';
import assert from 'node:assert/strict';

import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';
import { computeArcadeSectorScoreBreakdown } from '../src/state/arcade/ArcadeScoreOps.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import {
    beginArcadeSector,
    completeArcadeSector,
    createArcadeRunState,
} from '../src/state/arcade/ArcadeRunState.js';
import { XP_REWARD_TABLE } from '../src/state/arcade/ArcadeVehicleProfile.js';

/** Points per kill in the arcade sector score (ArcadeScoreOps KILL_SCORE_BASE). */
const KILL_SCORE_BASE = 35;
const HUMAN_KILLS = 3;
const BOT_KILLS = 5;

function createTelemetryGame() {
    return {
        arena: { currentMapKey: 'standard' },
        activeGameMode: 'ARCADE',
        entityManager: {
            players: [
                { index: 0, isBot: false },
                { index: 1, isBot: true },
            ],
            getHuntScoreboard: () => ([
                {
                    playerIndex: 1,
                    label: 'Bot 2',
                    kills: BOT_KILLS,
                    assists: 0,
                    deaths: 1,
                    damage: 0,
                    shieldDamage: 0,
                    spawnDeaths: 0,
                },
                {
                    playerIndex: 0,
                    label: 'Spieler 1',
                    kills: HUMAN_KILLS,
                    assists: 0,
                    deaths: 0,
                    damage: 0,
                    shieldDamage: 0,
                    spawnDeaths: 2,
                },
            ]),
        },
    };
}

function createRoundEndPlan(selfCollisions = 0) {
    return {
        outcome: { state: 'ROUND_END', reason: 'ELIMINATION' },
        recording: {
            roundMetrics: {
                winnerIndex: 0,
                winnerIsBot: false,
                duration: 40,
                selfCollisions,
                itemUseEvents: 0,
                mgHits: 0,
                rocketHits: 0,
                shieldAbsorb: 0,
                hpDamage: 0,
                stuckEvents: 0,
                heatmap: [],
            },
        },
    };
}

function buildSectorTelemetryPayload(selfCollisions = 0) {
    const controller = new MatchFlowTelemetryController({ game: createTelemetryGame() });
    return controller.buildRoundEndTelemetryPayload(createRoundEndPlan(selfCollisions));
}

function createScoredArcadeRuntime() {
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    runtime._enabled = true;
    runtime._state = completeArcadeSector(beginArcadeSector(createArcadeRunState({
        config: { enabled: true, sectorCount: 4 },
        nowMs: 0,
        runId: 'arcade-sector-telemetry-test',
    }), 0), 0);
    runtime.setActiveVehicle('ship1');
    runtime._vehicleProfiles = {};
    return runtime;
}

test('Round end telemetry reports the human kills of the finished sector', () => {
    const payload = buildSectorTelemetryPayload(0);

    assert.equal(payload.kills, HUMAN_KILLS);
});

test('Round end telemetry kills reach the arcade sector score breakdown', () => {
    const payload = buildSectorTelemetryPayload(0);
    const breakdown = computeArcadeSectorScoreBreakdown(payload, { sectorTemplateId: 'sector_intro' });

    assert.equal(breakdown.kills, HUMAN_KILLS * KILL_SCORE_BASE);
});

test('Sector XP rewards kills and grants the clean bonus only without self collisions', () => {
    const cleanRuntime = createScoredArcadeRuntime();
    cleanRuntime.handleRoundEndTelemetry(buildSectorTelemetryPayload(0));

    const dirtyRuntime = createScoredArcadeRuntime();
    dirtyRuntime.handleRoundEndTelemetry(buildSectorTelemetryPayload(2));

    const expectedDirtyXp = XP_REWARD_TABLE.sectorComplete + (HUMAN_KILLS * XP_REWARD_TABLE.killBase);
    const expectedCleanXp = expectedDirtyXp + XP_REWARD_TABLE.cleanSector;

    assert.equal(dirtyRuntime._state.lastSectorXp.earned, expectedDirtyXp);
    assert.equal(cleanRuntime._state.lastSectorXp.earned, expectedCleanXp);
});
