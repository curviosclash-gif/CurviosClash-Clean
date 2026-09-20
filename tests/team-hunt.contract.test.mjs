import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createTeamScoreboard,
    normalizeTeamHuntSettings,
    resolveTeamRoster,
} from '../src/shared/contracts/TeamHuntContract.js';
import { TEAM_IDS } from '../src/shared/contracts/TeamCombatContract.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { buildEntityManagerSetupOptions } from '../src/state/match-session/MatchSessionSetupOps.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createMenuSettingsDefaults } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { getNearestEnemy } from '../src/hunt/HuntBotPolicy.js';
import { resolveOpportunisticEnemy } from '../src/entities/ai/HeuristicHuntTargetingOps.js';
import { coordinateRoundEnd } from '../src/ui/MatchFlowRoundEndCoordinator.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import * as THREE from 'three';

function combatant(index, teamId, alive = true) {
    return { index, teamId, alive, entitySlotActive: true, isBot: index > 1 };
}

test('team settings default to a 4v4 roster and normalize per-team bot difficulty', () => {
    assert.deepEqual(normalizeTeamHuntSettings({ teamMode: true, teamSize: 99, teamBotDifficulty: { ALPHA: 'easy', BRAVO: 'hard' } }), {
        enabled: true,
        teamSize: 5,
        botDifficulty: { ALPHA: 'EASY', BRAVO: 'HARD' },
    });
    assert.deepEqual(resolveTeamRoster({ humanCount: 3, teamSize: 4 }), {
        totalSlots: 8,
        botCount: 5,
        teamIds: [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO],
    });
    assert.deepEqual(resolveTeamRoster({ humanCount: 5, teamSize: 2 }), {
        totalSlots: 6,
        botCount: 1,
        teamIds: [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO],
    });
    assert.equal(normalizeTeamHuntSettings({ enabled: true, teamMode: false }).enabled, false);
});

test('team round wins increment every teammate and reach the match limit together', () => {
    const players = [
        { index: 0, teamId: TEAM_IDS.ALPHA, score: 1 },
        { index: 1, teamId: TEAM_IDS.BRAVO, score: 0 },
        { index: 2, teamId: TEAM_IDS.ALPHA, score: 1 },
    ];
    const result = coordinateRoundEnd({
        winner: players[2],
        winnerTeamId: TEAM_IDS.ALPHA,
        players,
        roundStateController: {
            deriveOnRoundEndPlan: (roundPlayers) => ({
                outcome: { matchWinner: roundPlayers.find((player) => player.score >= 2) || null },
                transition: {},
            }),
        },
        winsNeeded: 2,
        logger: { log() {} },
    });
    assert.deepEqual(players.map((player) => player.score), [2, 0, 2]);
    assert.equal(result.outcome.matchWinner.teamId, TEAM_IDS.ALPHA);
});

test('team round scoring excludes departed network slots', () => {
    const players = [
        { index: 0, teamId: TEAM_IDS.ALPHA, score: 0, entitySlotActive: true },
        { index: 2, teamId: TEAM_IDS.ALPHA, score: 0, entitySlotActive: false },
        { index: 1, teamId: TEAM_IDS.BRAVO, score: 0, entitySlotActive: true },
    ];
    coordinateRoundEnd({
        winner: players[0], winnerTeamId: TEAM_IDS.ALPHA, players,
        roundStateController: { deriveOnRoundEndPlan: () => ({ outcome: {}, transition: {} }) },
        logger: { log() {} },
    });
    assert.deepEqual(players.map((player) => player.score), [1, 0, 0]);
});

test('all standard bot target selectors skip teammates', () => {
    const bot = combatant(0, TEAM_IDS.ALPHA);
    bot.position = new THREE.Vector3();
    const teammate = combatant(2, TEAM_IDS.ALPHA);
    teammate.position = new THREE.Vector3(1, 0, 0);
    teammate.hp = 1;
    teammate.maxHp = 100;
    const enemy = combatant(1, TEAM_IDS.BRAVO);
    enemy.position = new THREE.Vector3(4, 0, 0);
    enemy.hp = 100;
    enemy.maxHp = 100;
    assert.equal(getNearestEnemy(bot, [bot, teammate, enemy], new THREE.Vector3()).enemy, enemy);
    const policy = { profile: { opportunistBias: 1, openingFanoutBias: 0 } };
    assert.equal(resolveOpportunisticEnemy(policy, bot, [bot, teammate, enemy], enemy), enemy);
});

test('team scoreboard aggregates the selected Hunt metric and keeps player statistics', () => {
    const players = [combatant(0, TEAM_IDS.ALPHA), combatant(1, TEAM_IDS.BRAVO), combatant(2, TEAM_IDS.ALPHA)];
    const rows = [
        { playerIndex: 0, kills: 2, points: 5, deaths: 1, assists: 1, damage: 20 },
        { playerIndex: 1, kills: 4, points: 8, deaths: 2, assists: 0, damage: 30 },
        { playerIndex: 2, kills: 3, points: 7, deaths: 1, assists: 2, damage: 40 },
    ];
    const teams = createTeamScoreboard(rows, players, { scoreKey: 'kills' });
    assert.deepEqual(teams.map((row) => [row.teamId, row.kills, row.points, row.playerIndices]), [
        [TEAM_IDS.ALPHA, 5, 12, [0, 2]],
        [TEAM_IDS.BRAVO, 4, 8, [1]],
    ]);
    assert.deepEqual(teams.map((row) => [row.label, row.color]), [
        ['Team Blau', 0x00aaff],
        ['Team Orange', 0xff8800],
    ]);
});

test('local team HUD derives team rows without an authoritative network snapshot', () => {
    const players = [combatant(0, TEAM_IDS.ALPHA), combatant(1, TEAM_IDS.BRAVO)];
    const rows = [{ playerIndex: 0, kills: 2 }, { playerIndex: 1, kills: 1 }];
    const entityManager = {
        players,
        runtimeConfig: { hunt: { teamMode: true, teamObjective: 'HUNT' } },
        entityRuntimeConfig: { HUNT: { WIN_CONDITION: 'kills_time' } },
        gameModeStrategy: { hasCombatHud: () => true, isRespawnEnabled: () => true, getPickupModeType: () => 'HUNT' },
        getHuntScoreboard: () => rows,
        getHuntScoreboardSummary: () => 'summary',
    };
    const projection = buildMatchRuntimeProjection({
        game: { entityManager, state: 'PLAYING' },
        runtimeState: { activeGameMode: 'HUNT' },
    });
    assert.deepEqual(projection.hunt.scoreboardRows.map((row) => [row.teamId, row.kills]), [
        [TEAM_IDS.ALPHA, 2], [TEAM_IDS.BRAVO, 1],
    ]);
    assert.deepEqual(projection.players.map((player) => player.teamId), [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO]);
});

test('team deathmatch ends on the aggregate kill target and returns a winning team representative', () => {
    const players = [combatant(0, TEAM_IDS.ALPHA), combatant(1, TEAM_IDS.BRAVO), combatant(2, TEAM_IDS.ALPHA)];
    const system = new RoundOutcomeSystem({
        getPlayers: () => players,
        getScoreboard: () => [
            { playerIndex: 0, kills: 3 },
            { playerIndex: 1, kills: 4 },
            { playerIndex: 2, kills: 2 },
        ],
        isRespawnEnabled: () => true,
        isTeamMode: () => true,
        getDeathmatchKillLimit: () => 5,
    });
    const outcome = system.resolve();
    assert.equal(outcome.shouldEnd, true);
    assert.equal(outcome.winner.teamId, TEAM_IDS.ALPHA);
    assert.equal(outcome.winnerTeamId, TEAM_IDS.ALPHA);
});

test('match setup assigns every human and bot slot to the balanced roster', () => {
    const runtimeConfig = {
        session: { activeGameMode: 'HUNT', numHumans: 2 },
        hunt: { teamMode: true, teamSize: 4, teamBotDifficulty: { ALPHA: 'EASY', BRAVO: 'HARD' } },
    };
    const options = buildEntityManagerSetupOptions({ gameplay: {}, vehicles: {}, hunt: {} }, runtimeConfig);
    assert.deepEqual(options.humanConfigs.map((entry) => entry.teamId), [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO]);
    assert.deepEqual(options.botTeamIds, [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO, TEAM_IDS.ALPHA, TEAM_IDS.BRAVO]);
});

test('team setup colors every human, bot and trail blue or orange', () => {
    const renderer = {
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle: () => 'modern',
    };
    const owner = {
        renderer,
        entityRuntimeConfig: resolveEntityRuntimeConfig({}),
        runtimeConfig: {},
        arena: { currentMapDefinition: null },
        players: [],
        humanPlayers: [],
        bots: [],
        botByPlayer: new Map(),
        botDifficulty: 'NORMAL',
        botPolicyType: 'heuristic',
        botPolicyRegistry: { create: () => ({}) },
        gameModeStrategy: { isEndlessParcours: () => false },
        combatModeType: 'HUNT',
    };
    const setup = new EntitySetupOps(owner);
    const context = {
        normalizeVehicleId: () => 'ship5',
        humanConfigs: [
            { teamId: TEAM_IDS.ALPHA, color: 0x111111 },
            { teamId: TEAM_IDS.BRAVO, color: 0x222222 },
        ],
        botTeamIds: [TEAM_IDS.ALPHA, TEAM_IDS.BRAVO],
        botVehicleIds: ['ship5'],
        defaultVehicleId: 'ship5',
        teamBotDifficulty: { ALPHA: 'NORMAL', BRAVO: 'NORMAL' },
        modelScale: 1,
    };
    try {
        setup.setupHumanPlayers(2, context);
        setup.setupBotPlayers(2, 2, context);
        assert.deepEqual(owner.players.map((player) => player.color), [0x00aaff, 0xff8800, 0x00aaff, 0xff8800]);
        assert.deepEqual(owner.players.map((player) => player.trail.color), [0x00aaff, 0xff8800, 0x00aaff, 0xff8800]);
    } finally {
        for (const player of owner.players) player.dispose();
    }
});

test('team Hunt settings enter the immutable match snapshot', () => {
    const defaults = createMenuSettingsDefaults();
    const settings = {
        ...defaults,
        gameMode: 'HUNT',
        hunt: {
            ...defaults.hunt,
            respawnEnabled: true,
            teamMode: true,
            teamSize: 3,
            teamBotDifficulty: { ALPHA: 'HARD', BRAVO: 'EASY' },
        },
    };
    const runtime = createRuntimeConfigSnapshot(settings);
    assert.equal(settings.hunt.teamMode, true);
    assert.equal(runtime.hunt.teamMode, true);
    assert.equal(runtime.hunt.teamSize, 3);
    assert.deepEqual(runtime.hunt.teamBotDifficulty, { ALPHA: 'HARD', BRAVO: 'EASY' });
});

test('lethal friendly fire records the death without awarding a team kill', () => {
    const scoring = new HuntScoring(() => 1);
    const attacker = combatant(0, TEAM_IDS.ALPHA);
    const teammate = combatant(2, TEAM_IDS.ALPHA);
    scoring.registerElimination(teammate, { killer: attacker, nowSeconds: 1 });
    const rows = scoring.getScoreboard([attacker, teammate]);
    assert.equal(rows.find((row) => row.playerIndex === 0).kills, 0);
    assert.equal(rows.find((row) => row.playerIndex === 2).deaths, 1);
});
