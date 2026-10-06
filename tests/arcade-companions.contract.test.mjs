import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    ARCADE_COMPANION_AGGRESSIVENESS,
    buildArcadeCompanionTeamPlan,
    isArcadeCompanionTeamPair,
    resolveActiveArcadeCompanionCount,
} from '../src/shared/contracts/ArcadeCompanionContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { buildEntityManagerSetupOptions } from '../src/state/match-session/MatchSessionSetupOps.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { selectTarget } from '../src/entities/ai/BotTargetingOps.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { applyEmpPulse } from '../src/entities/systems/EmpPulseOps.js';
import { applyLiveRuntimeConfig } from '../src/entities/EntityManagerLiveConfigOps.js';
import { resolveArcadeModePlayerUpgradeBonuses } from '../src/modes/ArcadeModeUpgradeOps.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';

const ARCADE = Object.freeze({ enabled: true, runType: 'gauntlet', dailyChallenge: false, companionCount: 2 });

test('companions fly only in a normal gauntlet next to one human and only against a squad', () => {
    assert.equal(resolveActiveArcadeCompanionCount(ARCADE, { humanCount: 1, enemyCount: 3 }), 2);
    assert.equal(resolveActiveArcadeCompanionCount({ ...ARCADE, companionCount: 9 }, { humanCount: 1, enemyCount: 3 }), 2, 'at most two');
    assert.equal(resolveActiveArcadeCompanionCount(ARCADE, { humanCount: 2, enemyCount: 3 }), 0, 'not in split screen');
    assert.equal(resolveActiveArcadeCompanionCount(ARCADE, { humanCount: 1, enemyCount: 0 }), 0, 'not in a parcours sector');
    assert.equal(resolveActiveArcadeCompanionCount({ ...ARCADE, dailyChallenge: true }, { humanCount: 1, enemyCount: 3 }), 0, 'not in the daily');
    assert.equal(resolveActiveArcadeCompanionCount({ ...ARCADE, runType: 'arena_waves' }, { humanCount: 1, enemyCount: 3 }), 0, 'not in special runs');
    assert.deepEqual(buildArcadeCompanionTeamPlan({ humanCount: 1, enemyCount: 3, companionCount: 2 }), {
        humanTeamIds: ['ALPHA'], botTeamIds: ['BRAVO', 'BRAVO', 'BRAVO', 'ALPHA', 'ALPHA'],
    });
});

test('the saved companion choice survives normalization for every run type, only gauntlet uses it', () => {
    assert.equal(normalizeArcadeRunSettings({}).companionCount, 0, 'no companions by default');
    assert.equal(normalizeArcadeRunSettings({ companionCount: 2 }).companionCount, 2);
    assert.equal(normalizeArcadeRunSettings({ companionCount: '7' }).companionCount, 2);
    const waves = normalizeArcadeRunSettings({ runType: 'arena_waves', companionCount: 2 });
    assert.equal(waves.companionCount, 2, 'a detour into a special run keeps the choice');
    assert.equal(resolveActiveArcadeCompanionCount({ ...waves, enabled: true }, { humanCount: 1, enemyCount: 3 }), 0, 'but no companion flies there');
});

test('a sector with companions puts the human and the companions on one team, the squad on the other', () => {
    const runtimeConfig = { arcade: { ...ARCADE, activeCompanionCount: 2 }, session: { numBots: 5, numHumans: 1 }, hunt: {} };
    const options = buildEntityManagerSetupOptions({ numHumans: 1 }, runtimeConfig);
    assert.equal(options.humanConfigs[0].teamId, 'ALPHA');
    assert.deepEqual(options.botTeamIds, ['BRAVO', 'BRAVO', 'BRAVO', 'ALPHA', 'ALPHA']);
    assert.equal(options.arcadeCompanionCount, 2);
    const solo = buildEntityManagerSetupOptions({ numHumans: 1 }, { arcade: { ...ARCADE }, session: { numBots: 3, numHumans: 1 }, hunt: {} });
    assert.deepEqual(solo.botTeamIds, [], 'without active companions nobody gets a team');
    assert.equal(solo.humanConfigs[0].teamId ?? null, null);
});

/** Stands for EntityManager in the entity setup; the registry records what each policy is told. */
function createSetupOwner(runtimeConfig) {
    return {
        renderer: { addToScene() {}, removeFromScene() {}, getGraphicsStyle: () => 'modern' },
        entityRuntimeConfig: resolveEntityRuntimeConfig({}),
        runtimeConfig,
        arena: { currentMapDefinition: null },
        players: [], humanPlayers: [], bots: [], botByPlayer: new Map(),
        botDifficulty: 'HARD', botPolicyType: 'rule-based',
        botPolicyRegistry: { create: (options) => ({ options, aggressiveness: null, setArcadeBotAggressiveness(value) { this.aggressiveness = value; } }) },
        gameModeStrategy: { isEndlessParcours: () => false },
        combatModeType: 'ARCADE',
    };
}

test('companions spawn as flagged allies that hunt map units and keep the human colour', () => {
    const runtimeConfig = {
        arcade: { ...ARCADE, activeCompanionCount: 2 }, session: { numBots: 5, numHumans: 1 }, hunt: {},
        bot: { arcadeAggressiveness: 0.85, arcadeBotRoles: ['elite', 'interceptor', 'flanker'] },
    };
    const owner = createSetupOwner(runtimeConfig);
    const options = buildEntityManagerSetupOptions({ numHumans: 1 }, runtimeConfig);
    const setup = new EntitySetupOps(owner);
    const context = { ...setup.resolveSetupPlayerContext(options), humanConfigs: [{ ...options.humanConfigs[0], color: 0x123456 }] };
    try {
        setup.setupHumanPlayers(1, context);
        setup.setupBotPlayers(1, 5, context);
        assert.equal(owner.humanPlayers[0].color, 0x123456, 'the arcade colour of the human stays');
        const companions = owner.bots.filter(({ player }) => player.isArcadeCompanion === true);
        const enemies = owner.bots.filter(({ player }) => player.isArcadeCompanion !== true);
        assert.equal(companions.length, 2);
        assert.deepEqual(enemies.map(({ player }) => player.scenarioRole), ['elite', 'interceptor', 'flanker'], 'the squad keeps its roles');
        for (const { player, ai } of companions) {
            assert.equal(player.teamId, 'ALPHA');
            assert.equal(player.scenarioRole, '', 'a companion takes no squad role');
            assert.equal(player.botTargetsMapUnits, true, 'a companion helps against map units');
            assert.equal(ai.aggressiveness, ARCADE_COMPANION_AGGRESSIVENESS, 'a companion does not take the squad pressure');
        }
        assert.ok(enemies.every(({ player }) => player.teamId === 'BRAVO'));
    } finally {
        for (const player of owner.players) player.dispose?.();
    }
});

/** Stands for BotAI in target selection: state, profile, sense and the scratch vectors. */
function createBot() {
    return {
        state: { targetPlayer: null }, profile: {}, sense: {},
        _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpVec3: new THREE.Vector3(), _tmpForward: new THREE.Vector3(),
    };
}
const ship = (index, teamId, z, extra = {}) => ({
    index, teamId, alive: true, hp: 100, maxHp: 100, position: new THREE.Vector3(0, 0, z),
    getDirection(target) { return target.set(0, 0, 1); }, ...extra,
});

test('a companion never picks its own human as target and goes for the enemy instead', () => {
    const companion = ship(3, 'ALPHA', 0, { isBot: true, isArcadeCompanion: true });
    const human = ship(0, 'ALPHA', 8);
    const enemy = ship(1, 'BRAVO', 40, { isBot: true });
    const bot = createBot();
    selectTarget(bot, companion, [human, enemy, companion]);
    assert.equal(bot.state.targetPlayer, enemy);
});

function outcomeFor(players) {
    const system = new RoundOutcomeSystem({
        getPlayers: () => players,
        getHumanPlayers: () => players.filter((player) => !player.isBot),
        getBots: () => players.filter((player) => player.isBot),
        isRespawnEnabled: () => false,
    });
    return system.resolve();
}

test('a sector ends when only the human team is left, and at once when the human is out', () => {
    const won = outcomeFor([
        ship(0, 'ALPHA', 0), ship(1, 'BRAVO', 9, { isBot: true, alive: false }),
        ship(2, 'BRAVO', 9, { isBot: true, alive: false }), ship(3, 'ALPHA', 4, { isBot: true, isArcadeCompanion: true }),
    ]);
    assert.equal(won.shouldEnd, true, 'the human team is the last one standing');
    assert.equal(won.winner?.index, 0, 'the human wins the sector, not the companion');
    const lost = outcomeFor([
        ship(0, 'ALPHA', 0, { alive: false }), ship(1, 'BRAVO', 9, { isBot: true }),
        ship(3, 'ALPHA', 4, { isBot: true, isArcadeCompanion: true }),
    ]);
    assert.equal(lost.shouldEnd, true, 'a surviving companion does not keep the run alive');
});

test('there is no friendly fire between the human and a companion', () => {
    const human = ship(0, 'ALPHA', 0);
    const companion = ship(3, 'ALPHA', 2, { isBot: true, isArcadeCompanion: true });
    const enemy = ship(1, 'BRAVO', 3, { isBot: true });
    assert.equal(isArcadeCompanionTeamPair(human, companion), true);
    assert.equal(isArcadeCompanionTeamPair(companion, enemy), false);
    assert.equal(isArcadeCompanionTeamPair(human, enemy), false);
    const hit = [];
    for (const target of [human, enemy]) target.applyPowerup = (type) => hit.push(`${target.index}:${type}`);
    applyEmpPulse({ owner: companion, players: [human, companion, enemy], radius: 20 });
    assert.deepEqual(hit, ['1:EMP'], 'the companion EMP spares the human');
});

test('live config updates and rank bonuses leave companions alone', () => {
    const companion = { player: { isBot: true, isArcadeCompanion: true, scenarioRole: '' }, ai: { value: null, setArcadeBotAggressiveness(v) { this.value = v; } } };
    const enemy = { player: { isBot: true, scenarioRole: 'pursuer' }, ai: { value: null, setArcadeBotAggressiveness(v) { this.value = v; } } };
    const em = { bots: [companion, enemy], players: [], humanPlayers: [], entityRuntimeConfig: resolveEntityRuntimeConfig({}) };
    applyLiveRuntimeConfig(em, resolveEntityRuntimeConfig({}), { arcade: { enabled: true }, bot: { arcadeAggressiveness: 0.85 } });
    assert.equal(companion.ai.value, ARCADE_COMPANION_AGGRESSIVENESS);
    assert.ok(enemy.ai.value > 0.85);
    const strategy = { isNormalArcadeRun: () => true, _botRankBonuses: { hpFactor: 1.4 } };
    const fallback = { hpFactor: 1 };
    assert.equal(resolveArcadeModePlayerUpgradeBonuses(strategy, companion.player, fallback), fallback, 'companions get no enemy buffs');
    assert.equal(resolveArcadeModePlayerUpgradeBonuses(strategy, enemy.player, fallback), strategy._botRankBonuses);
});

test('every sector with companions rebuilds the match, so a fallen companion returns next sector', () => {
    const applied = [];
    const runtimeState = {
        runtimeConfig: {
            arcade: { ...ARCADE, seed: 12, sectorCount: 4 }, bot: { activeDifficulty: 'NORMAL' },
            session: { mapKey: 'standard', numBots: 5, numHumans: 1 }, player: { vehicles: { PLAYER_1: 'ship2' } },
        },
    };
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => runtimeState, applySectorRuntimeProfile: (value) => applied.push(value) });
    support._pendingSectorTransition = resolveArcadeSectorRuntimeProfile({ sectorNumber: 2, squadId: 'striker_tri' }, { mapKey: 'standard' });
    const transition = support.consumePendingSectorTransition();
    assert.equal(transition.companionCount, 2, 'the sector brings two companions');
    assert.equal(transition.botCount, 3, 'bot count stays the squad size');
    assert.equal(transition.requiresSessionRebuild, true, 'same map and same total still rebuild');
});
