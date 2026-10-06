import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCADE_SQUAD_PROFILES,
    resolveArcadeSectorRuntimeProfile,
} from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { resolveArcadeRoleAggressiveness } from '../src/shared/contracts/ArcadeBotAggressionContract.js';
import { ARENA_WAVES_BOT_CAPACITY, resolveArenaWavesAggression } from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { applyLiveRuntimeConfig } from '../src/entities/EntityManagerLiveConfigOps.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const ROLES = new Set(['guard', 'flanker', 'pursuer', 'interceptor', 'elite']);

/** Records what EntitySetupOps hands each bot policy, without building a real brain. */
function createRecordingPolicy() {
    return { aggressiveness: null, setArcadeBotAggressiveness(value) { this.aggressiveness = value; } };
}

/**
 * Stands for EntityManager in setupBotPlayers: a renderer that accepts meshes, a map without an
 * authored scenario unless one is passed, and a registry handing out recording policies.
 */
function createSetupOwner({ runtimeConfig, mapDefinition = null }) {
    return {
        renderer: { addToScene() {}, removeFromScene() {}, getGraphicsStyle: () => 'modern' },
        entityRuntimeConfig: resolveEntityRuntimeConfig({}),
        runtimeConfig,
        arena: { currentMapDefinition: mapDefinition },
        players: [], humanPlayers: [], bots: [], botByPlayer: new Map(),
        botDifficulty: 'NORMAL', botPolicyType: 'rule-based',
        botPolicyRegistry: { create: () => createRecordingPolicy() },
        gameModeStrategy: { isEndlessParcours: () => false },
        combatModeType: 'ARCADE',
    };
}

function setupBots(owner, count) {
    const setup = new EntitySetupOps(owner);
    setup.setupBotPlayers(1, count, { botTeamIds: [], botVehicleIds: ['ship5'], defaultVehicleId: 'ship5', modelScale: 1 });
    return owner.bots;
}

function disposeBots(owner) {
    for (const player of owner.players) player.dispose?.();
}

function arcadeSectorConfig(squadId) {
    const profile = resolveArcadeSectorRuntimeProfile({ sectorNumber: 4, squadId, pressure: 0.5 }, { mapKey: 'standard' });
    return {
        profile,
        runtimeConfig: {
            arcade: { enabled: true },
            bot: { arcadeAggressiveness: profile.aggressiveness, arcadeBotRoles: profile.botRoles },
        },
    };
}

test('every arcade squad hands one known role to each of its bots, and the boss squad leads with an elite', () => {
    for (const squad of Object.values(ARCADE_SQUAD_PROFILES)) {
        const profile = resolveArcadeSectorRuntimeProfile({ sectorNumber: 2, squadId: squad.id }, { mapKey: 'standard' });
        assert.equal(profile.botRoles.length, profile.botCount, `${squad.id} names a role for each bot`);
        assert.ok(profile.botRoles.every((role) => ROLES.has(role)), `${squad.id} only uses known roles`);
        assert.ok(new Set(profile.botRoles).size > 1, `${squad.id} mixes at least two roles`);
    }
    const boss = resolveArcadeSectorRuntimeProfile({ sectorNumber: 8, squadId: 'elite_lance', isBoss: true }, { mapKey: 'standard' });
    assert.equal(boss.botRoles[0], 'elite', 'the boss squad is led by an elite');
    const parcours = resolveArcadeSectorRuntimeProfile({ sectorNumber: 4, squadId: 'hunter_pack', parcoursEnabled: true }, { mapKey: 'standard' });
    assert.deepEqual(parcours.botRoles, [], 'a parcours sector has no bots and therefore no roles');
});

test('a role shifts the squad aggressiveness a little, never outside 0..1', () => {
    assert.ok(resolveArcadeRoleAggressiveness(0.6, 'elite') > resolveArcadeRoleAggressiveness(0.6, 'pursuer'));
    assert.ok(resolveArcadeRoleAggressiveness(0.6, 'pursuer') > resolveArcadeRoleAggressiveness(0.6, 'guard'));
    assert.equal(resolveArcadeRoleAggressiveness(0.6, ''), 0.6, 'a bot without role keeps the squad value');
    assert.equal(resolveArcadeRoleAggressiveness(0.99, 'elite'), 1);
    assert.equal(resolveArcadeRoleAggressiveness(0.01, 'guard'), 0);
});

test('arcade sector bots spawn with their squad roles and role-adjusted aggressiveness', () => {
    const { profile, runtimeConfig } = arcadeSectorConfig('hunter_pack');
    const owner = createSetupOwner({ runtimeConfig });
    try {
        const bots = setupBots(owner, profile.botCount);
        assert.deepEqual(bots.map(({ player }) => player.scenarioRole), profile.botRoles, 'each bot drives its squad role');
        for (const { player, ai } of bots) {
            assert.equal(ai.aggressiveness, resolveArcadeRoleAggressiveness(profile.aggressiveness, player.scenarioRole),
                `the ${player.scenarioRole} gets its role-adjusted aggressiveness`);
        }
    } finally {
        disposeBots(owner);
    }
});

test('authored map roles still win, and outside arcade nobody inherits squad roles', () => {
    const { runtimeConfig } = arcadeSectorConfig('striker_tri');
    const mapDefinition = { singlePlayerScenario: { enabled: true, botRoles: ['guard'] } };
    const authored = createSetupOwner({ runtimeConfig, mapDefinition });
    const classic = createSetupOwner({ runtimeConfig: { ...runtimeConfig, arcade: { enabled: false } } });
    try {
        assert.deepEqual(setupBots(authored, 3).map(({ player }) => player.scenarioRole), ['guard', 'guard', 'guard']);
        const classicBots = setupBots(classic, 3);
        assert.deepEqual(classicBots.map(({ player }) => player.scenarioRole), ['', '', '']);
        assert.deepEqual(classicBots.map(({ ai }) => ai.aggressiveness), [null, null, null], 'no arcade tuning outside arcade');
    } finally {
        disposeBots(authored);
        disposeBots(classic);
    }
});

test('a live arcade config update keeps each bot role offset instead of flattening the squad', () => {
    const elite = { player: { scenarioRole: 'elite' }, ai: createRecordingPolicy() };
    const guard = { player: { scenarioRole: 'guard' }, ai: createRecordingPolicy() };
    const em = { bots: [elite, guard], players: [], humanPlayers: [], entityRuntimeConfig: resolveEntityRuntimeConfig({}) };
    applyLiveRuntimeConfig(em, resolveEntityRuntimeConfig({}), { arcade: { enabled: true }, bot: { arcadeAggressiveness: 0.6 } });
    assert.equal(elite.ai.aggressiveness, resolveArcadeRoleAggressiveness(0.6, 'elite'));
    assert.equal(guard.ai.aggressiveness, resolveArcadeRoleAggressiveness(0.6, 'guard'));
});

/** Stands for the arena-waves slot pool; activateBotSlot keeps the role it is given like EntityManager. */
function arenaFixture() {
    const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, fightLoadout: {}, position: { x: 0, y: 1, z: 0 } };
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({
        player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100, scenarioRole: '' },
        ai: createRecordingPolicy(),
        slot,
    }));
    const manager = {
        humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot, role = '' }) { bots[slot].player.scenarioRole = String(role || 'pursuer'); bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {} },
    };
    return { bots, manager };
}

test('an arena elite wave spawns a real elite among mixed roles', () => {
    const f = arenaFixture();
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1);
    for (let wave = 2; wave <= 5; wave += 1) { runtime.update(59); runtime.update(1); if (runtime.phase === 'upgrade') runtime.selectChoice(runtime.getHudState().choices[0]); }
    while (runtime.wave < 5) runtime.update(1);
    const fifth = f.bots.filter(({ slot }) => runtime._slotWave.get(slot) === 5);
    const elites = fifth.filter(({ player }) => player.arenaWavesElite);
    assert.equal(elites.length, 1, 'the fifth wave has one elite');
    assert.equal(elites[0].player.scenarioRole, 'elite', 'the elite slot drives the elite role');
    assert.ok(new Set(fifth.map(({ player }) => player.scenarioRole)).size >= 3, 'the rest of the wave mixes roles');
    const pursuer = fifth.find(({ player }) => player.scenarioRole === 'pursuer');
    assert.ok(pursuer, 'the wave still has a pursuer');
    assert.equal(elites[0].ai.aggressiveness, resolveArcadeRoleAggressiveness(resolveArenaWavesAggression(0, 5), 'elite'));
    assert.ok(elites[0].ai.aggressiveness > pursuer.ai.aggressiveness, 'the elite drives more aggressively than a pursuer');
});
