import test from 'node:test';
import assert from 'node:assert/strict';

import { MatchFlowTelemetryController } from '../src/ui/MatchFlowTelemetryController.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { handleRocketIntercept } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import { collectEndlessRunXp } from '../src/entities/endless/EndlessParcoursProgressionOps.js';
import {
    beginArcadeSector,
    completeArcadeSector,
    createArcadeRunState,
} from '../src/state/arcade/ArcadeRunState.js';
import {
    XP_REWARD_TABLE,
    calculateSectorXp,
    loadVehicleProfiles,
} from '../src/state/arcade/ArcadeVehicleProfile.js';

const HUMAN_KILLS = 2;
const HUMAN_INTERCEPTS = 3;
const BOT_INTERCEPTS = 7;

/**
 * Telemetry without any intercept field, exactly as a build before S2.4 produced it.
 * The expected value below is pinned so the old arithmetic cannot drift unnoticed.
 */
const LEGACY_TELEMETRY = Object.freeze({
    kills: HUMAN_KILLS,
    multiplier: 1,
    missionsCompleted: 0,
    totalMissions: 0,
    cleanSector: false,
});
const LEGACY_EXPECTED_XP = 80; // 50 sectorComplete + 2 kills * 15 killBase

/**
 * Stands in for the arcade match: one human and one bot. Kills already travel this
 * way (MatchFlowTelemetryController reads the hunt scoreboard), so the intercepts
 * have to travel on the very same rows to share the per-sector reset.
 */
function createTelemetryGame(scoreboardRows) {
    return {
        arena: { currentMapKey: 'standard' },
        activeGameMode: 'ARCADE',
        entityManager: {
            players: [
                { index: 0, isBot: false },
                { index: 1, isBot: true },
            ],
            getHuntScoreboard: () => scoreboardRows,
        },
    };
}

function createScoringRows() {
    const scoring = new HuntScoring();
    for (let i = 0; i < HUMAN_INTERCEPTS; i += 1) scoring.registerIntercept(0);
    for (let i = 0; i < BOT_INTERCEPTS; i += 1) scoring.registerIntercept(1);
    for (let i = 0; i < HUMAN_KILLS; i += 1) {
        scoring.registerElimination({ index: 1, maxHp: 100 }, { killer: { index: 0 }, nowSeconds: 0 });
    }
    return scoring.getScoreboard([
        { index: 0, label: 'Spieler 1', isBot: false },
        { index: 1, label: 'Bot 2', isBot: true },
    ]);
}

function buildSectorTelemetryPayload(scoreboardRows) {
    const controller = new MatchFlowTelemetryController({ game: createTelemetryGame(scoreboardRows) });
    return controller.buildRoundEndTelemetryPayload({
        outcome: { state: 'ROUND_END', reason: 'ELIMINATION' },
        recording: {
            roundMetrics: {
                winnerIndex: 0,
                winnerIsBot: false,
                duration: 40,
                selfCollisions: 1,
                itemUseEvents: 0,
                mgHits: 0,
                rocketHits: 0,
                shieldAbsorb: 0,
                hpDamage: 0,
                stuckEvents: 0,
                heatmap: [],
            },
        },
    });
}

function createScoredArcadeRuntime() {
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    runtime._enabled = true;
    runtime._state = completeArcadeSector(beginArcadeSector(createArcadeRunState({
        config: { enabled: true, sectorCount: 4 },
        nowMs: 0,
        runId: 'arcade-intercept-xp-test',
    }), 0), 0);
    runtime.setActiveVehicle('ship1');
    runtime._vehicleProfiles = {};
    return runtime;
}

test('the xp reward table pays ten xp for an intercepted rocket', () => {
    assert.equal(XP_REWARD_TABLE.interceptBase, 10, 'an intercept is worth ten xp (E38)');
    assert.ok(
        XP_REWARD_TABLE.interceptBase < XP_REWARD_TABLE.killBase,
        'an intercept stays below a kill'
    );
});

test('three intercepts add thirty xp to the sector reward', () => {
    const withoutIntercepts = calculateSectorXp(LEGACY_TELEMETRY);
    const withIntercepts = calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: 3 });

    assert.equal(
        withIntercepts - withoutIntercepts,
        3 * XP_REWARD_TABLE.interceptBase,
        'three intercepts are worth thirty xp on top'
    );
});

test('telemetry without an intercept field still earns the old amount', () => {
    assert.equal(
        calculateSectorXp(LEGACY_TELEMETRY),
        LEGACY_EXPECTED_XP,
        'a caller that knows nothing about intercepts keeps its old result'
    );
});

test('the combo multiplier scales the intercept reward like every other item', () => {
    const plain = calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: 2 });
    const doubled = calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: 2, multiplier: 2 });

    assert.equal(doubled, plain * 2, 'the multiplier applies to the whole sector sum');
});

test('a broken intercept count is worth nothing instead of breaking the reward', () => {
    const base = calculateSectorXp(LEGACY_TELEMETRY);

    assert.equal(calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: -5 }), base, 'negative counts as zero');
    assert.equal(calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: NaN }), base, 'NaN counts as zero');
    assert.equal(calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: 'drei' }), base, 'text counts as zero');
    assert.equal(calculateSectorXp({ ...LEGACY_TELEMETRY, intercepts: null }), base, 'null counts as zero');
});

test('an intercept event travels from the hunt scoreboard into the round telemetry', () => {
    const payload = buildSectorTelemetryPayload(createScoringRows());

    assert.equal(payload.intercepts, HUMAN_INTERCEPTS, 'only the human intercepts reach the payload');
    assert.equal(payload.kills, HUMAN_KILLS, 'the kill count is unaffected');
});

test('a bot intercept never pays the player', () => {
    const botOnlyRows = createScoringRows().map((row) => (row.playerIndex === 0
        ? { ...row, intercepts: 0 }
        : row));
    const payload = buildSectorTelemetryPayload(botOnlyRows);

    assert.equal(payload.intercepts, 0, 'seven bot intercepts are worth nothing');
});

test('the intercepts of a sector raise the awarded arcade xp', () => {
    const withRuntime = createScoredArcadeRuntime();
    withRuntime.handleRoundEndTelemetry(buildSectorTelemetryPayload(createScoringRows()));

    const withoutRuntime = createScoredArcadeRuntime();
    const plainPayload = { ...buildSectorTelemetryPayload(createScoringRows()), intercepts: 0 };
    withoutRuntime.handleRoundEndTelemetry(plainPayload);

    assert.equal(
        withRuntime._state.lastSectorXp.earned - withoutRuntime._state.lastSectorXp.earned,
        HUMAN_INTERCEPTS * XP_REWARD_TABLE.interceptBase,
        'the three intercepts of the sector are paid once'
    );
});

test('the endless parcours pays the same ten xp for an intercept', () => {
    const runtime = { runXp: 0, _xpBonusPct: 0 };
    const earned = collectEndlessRunXp(runtime, 'intercept', 2);

    assert.equal(earned, 2 * XP_REWARD_TABLE.interceptBase, 'two intercepts pay twenty xp');
    assert.equal(runtime.runXp, earned, 'the run xp carries the reward');
});

test('a vehicle profile stored before the change still loads with its level and xp', () => {
    const stored = {
        ship1: {
            schemaVersion: 'arcade-vehicle-profile.v1',
            vehicleId: 'ship1',
            xp: 700,
            level: 4,
            unlockedSlots: ['core', 'nose'],
            upgrades: { core: 'T2' },
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: '2026-09-01T00:00:00.000Z',
        },
    };
    const store = {
        loadJsonRecord: (_key, fallback) => (JSON.parse(JSON.stringify(stored)) || fallback),
        saveJsonRecord: () => true,
    };

    const loaded = loadVehicleProfiles(store);

    assert.equal(loaded.ship1.xp, 700, 'the stored xp survives');
    assert.equal(loaded.ship1.level, 4, 'the stored level survives');
    assert.equal(loaded.ship1.upgrades.core, 'T2', 'the stored upgrade survives');
    assert.ok(!('intercepts' in loaded.ship1), 'the profile format gained no intercept field');
});

// The endless parcours books run xp per event, not from the round telemetry, so the
// intercept has to reach its runtime at the moment it happens - and only for a human.
test('an intercept pays the endless parcours run the moment it happens', () => {
    const calls = [];
    const owner = { endlessParcoursRuntime: { collectRunXp: (kind, count) => calls.push([kind, count]) } };

    handleRocketIntercept(owner, { defender: { index: 0, isBot: false }, target: { type: 'ROCKET_WEAK' } });
    assert.deepEqual(calls, [['intercept', 1]]);

    handleRocketIntercept(owner, { defender: { index: 1, isBot: true }, target: { type: 'ROCKET_WEAK' } });
    handleRocketIntercept(owner, { defender: { index: -1, staticTurret: true }, target: { type: 'ROCKET_WEAK' } });
    assert.equal(calls.length, 1, 'bots and turrets earn the player nothing');

    assert.doesNotThrow(() => handleRocketIntercept({}, { defender: { index: 0, isBot: false } }));
});
