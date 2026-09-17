import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { handleRocketIntercept } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { HuntInterceptAnnouncer } from '../src/ui/HuntInterceptAnnouncer.js';

/**
 * Stands for a player as the scoreboard reads one: an index and an active slot are
 * all `getScoreboard` looks at, plus `isBot` for the label.
 */
function createScoreboardPlayer(index, isBot = false) {
    return { index, isBot, entitySlotActive: true, maxHp: 100, maxShieldHp: 0 };
}

/**
 * Stands for the EntityManager the intercept callback is wired against: the scoring
 * it credits and the recorder it logs to, nothing else.
 */
function createInterceptOwner(scoring) {
    const loggedEvents = [];
    return {
        _huntScoring: scoring,
        loggedEvents,
        recorder: {
            logEvent(type, playerIndex, data = '') {
                loggedEvents.push({ type, playerIndex, data });
            },
        },
    };
}

test('registerIntercept credits only the defender and leaves the kill stats alone', () => {
    const scoring = new HuntScoring(() => 0);
    const players = [createScoreboardPlayer(0), createScoreboardPlayer(1)];

    scoring.registerIntercept(0);
    scoring.registerIntercept(0);

    const rows = scoring.getScoreboard(players);
    const defenderRow = rows.find((row) => row.playerIndex === 0);
    const otherRow = rows.find((row) => row.playerIndex === 1);
    assert.equal(defenderRow.intercepts, 2, 'the defender is credited with both intercepts');
    assert.equal(otherRow.intercepts, 0, 'the other player is credited with none');
    assert.equal(defenderRow.kills, 0, 'an intercept is never a kill (E75)');
    assert.equal(defenderRow.assists, 0, 'an intercept is never an assist');
    assert.equal(defenderRow.deaths, 0, 'an intercept never counts as a death');
});

test('registerIntercept ignores a missing or negative player index', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerIntercept(-1);
    scoring.registerIntercept(null);
    scoring.registerIntercept(1.5);
    assert.deepEqual(
        scoring.getScoreboard([createScoreboardPlayer(0)]).map((row) => row.intercepts),
        [0],
        'a turret owner (index -1) leaves the scoreboard untouched'
    );
});

test('intercepts never move a player up the scoreboard (E75)', () => {
    const scoring = new HuntScoring(() => 0);
    const players = [createScoreboardPlayer(0), createScoreboardPlayer(1)];
    for (let i = 0; i < 9; i += 1) scoring.registerIntercept(0);
    scoring.registerElimination(createScoreboardPlayer(0), { killer: players[1], nowSeconds: 0 });

    const rows = scoring.getScoreboard(players);
    assert.equal(rows[0].playerIndex, 1, 'the one kill still ranks above nine intercepts');
    assert.equal(rows[1].intercepts, 9, 'the intercepts are still counted, just not ranked');
});

test('the intercept count survives the network snapshot and old rows read as zero', () => {
    const players = [createScoreboardPlayer(0), createScoreboardPlayer(1)];
    const hostScoring = new HuntScoring(() => 0);
    hostScoring.registerIntercept(1);
    hostScoring.registerIntercept(1);
    hostScoring.registerIntercept(1);
    const host = { huntEnabled: true, players, _huntScoring: hostScoring };
    const snapshot = JSON.parse(JSON.stringify(createHuntNetworkState(host)));

    const clientScoring = new HuntScoring(() => 0);
    applyHuntNetworkState({ huntEnabled: true, players, _huntScoring: clientScoring }, snapshot);
    const clientRows = clientScoring.getScoreboard(players);
    assert.equal(clientRows.find((row) => row.playerIndex === 1).intercepts, 3, 'the client takes the hosts count');

    const legacyScoring = new HuntScoring(() => 0);
    legacyScoring.applyScoreboard([{ playerIndex: 0, kills: 2, deaths: 1 }]);
    assert.equal(
        legacyScoring.getScoreboard(players).find((row) => row.playerIndex === 0).intercepts,
        0,
        'a snapshot from an older host without the field reads as zero'
    );
});

test('the runtime projection carries the intercept count to the hud', () => {
    const projection = createMatchRuntimeProjection({
        hunt: { active: true, scoreboardRows: [{ playerIndex: 0, label: 'P1', kills: 1, intercepts: 4 }] },
    });
    assert.equal(projection.hunt.scoreboardRows[0].intercepts, 4, 'the count reaches the hud projection');

    const legacy = createMatchRuntimeProjection({
        hunt: { active: true, scoreboardRows: [{ playerIndex: 0, label: 'P1', kills: 1 }] },
    });
    assert.equal(legacy.hunt.scoreboardRows[0].intercepts, 0, 'a row without the field reads as zero');
});

test('the wired callback credits the defender and logs the intercept', () => {
    const scoring = new HuntScoring(() => 0);
    const owner = createInterceptOwner(scoring);
    const defender = createScoreboardPlayer(0);

    handleRocketIntercept(owner, {
        defender,
        interceptor: { type: 'ROCKET_WEAK' },
        target: { type: 'ROCKET_STRONG' },
        position: new THREE.Vector3(1, 2, 3),
    });

    assert.equal(
        scoring.getScoreboard([defender]).find((row) => row.playerIndex === 0).intercepts,
        1,
        'the defender is credited once per reported hit'
    );
    assert.equal(owner.loggedEvents.length, 1, 'the recorder sees one event');
    assert.equal(owner.loggedEvents[0].type, 'ROCKET_INTERCEPT', 'the event names the intercept');
    assert.equal(owner.loggedEvents[0].playerIndex, 0, 'the event belongs to the defender');
});

test('the wired callback ignores turrets, missing defenders and a mode without scoring', () => {
    const scoring = new HuntScoring(() => 0);
    const owner = createInterceptOwner(scoring);
    const turretOwner = { index: -1, staticTurret: true };

    handleRocketIntercept(owner, { defender: turretOwner, position: new THREE.Vector3() });
    handleRocketIntercept(owner, { defender: null, position: new THREE.Vector3() });
    handleRocketIntercept(owner, null);
    assert.deepEqual(
        scoring.getScoreboard([createScoreboardPlayer(0)]).map((row) => row.intercepts),
        [0],
        'a turret intercept is credited to nobody'
    );
    assert.equal(owner.loggedEvents.length, 0, 'nothing is logged for a missing defender');

    assert.doesNotThrow(
        () => handleRocketIntercept({ _huntScoring: null }, { defender: createScoreboardPlayer(0) }),
        'a mode without hunt scoring must not crash'
    );
});

test('intercepts never decide a deathmatch round', () => {
    const scoring = new HuntScoring(() => 0);
    const players = [createScoreboardPlayer(0), createScoreboardPlayer(1)];
    for (let i = 0; i < 12; i += 1) scoring.registerIntercept(0);
    const outcomeSystem = new RoundOutcomeSystem({
        getPlayers: () => players,
        getScoreboard: () => scoring.getScoreboard(players),
        isRespawnEnabled: () => true,
        getDeathmatchKillLimit: () => 3,
        getDeathmatchTimeLimitSeconds: () => 0,
    });

    assert.equal(outcomeSystem.resolve().shouldEnd, false, 'twelve intercepts win nothing');
});

test('the hud announces an intercept once, and only for the local player', () => {
    const announcer = new HuntInterceptAnnouncer();
    const rows = [
        { playerIndex: 0, label: 'P1', kills: 0, intercepts: 0 },
        { playerIndex: 1, label: 'Bot 2', kills: 0, intercepts: 0 },
    ];
    const localIndices = [0];

    assert.equal(announcer.consume(rows, localIndices), null, 'the first look never announces');

    rows[0].intercepts = 1;
    assert.equal(announcer.consume(rows, localIndices), 'Abgefangen!', 'the rising count announces once');
    assert.equal(announcer.consume(rows, localIndices), null, 'a steady count stays quiet');

    rows[1].intercepts = 4;
    assert.equal(announcer.consume(rows, localIndices), null, 'another players intercept stays quiet');

    rows[0].intercepts = 0;
    assert.equal(announcer.consume(rows, localIndices), null, 'a new round resetting the count stays quiet');
    rows[0].intercepts = 1;
    assert.equal(announcer.consume(rows, localIndices), 'Abgefangen!', 'the next intercept announces again');
});

test('the hud names the player when two humans share one screen', () => {
    const announcer = new HuntInterceptAnnouncer();
    const rows = [
        { playerIndex: 0, label: 'P1', intercepts: 0 },
        { playerIndex: 1, label: 'P2', intercepts: 0 },
    ];
    announcer.consume(rows, [0, 1]);
    rows[1].intercepts = 1;
    assert.equal(announcer.consume(rows, [0, 1]), 'Abgefangen! P2', 'the split screen says whose half it is');
});

test('the hud announcer forgets everything on reset', () => {
    const announcer = new HuntInterceptAnnouncer();
    const rows = [{ playerIndex: 0, label: 'P1', intercepts: 2 }];
    announcer.consume(rows, [0]);
    announcer.reset();
    assert.equal(announcer.consume(rows, [0]), null, 'after a reset the first look is quiet again');
});

test('a real intercept hit raises the count by exactly one', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const scoring = new HuntScoring(() => 0);
    const defender = {
        index: 0,
        alive: true,
        isBot: false,
        entitySlotActive: true,
        hitboxRadius: 1,
        position: new THREE.Vector3(-40, 0, 0),
        getDirection(out) { return out.set(1, 0, 0); },
        getAimDirection(out) { return out.set(1, 0, 0); },
        takeDamage(amount) { return { applied: amount, isDead: false }; },
    };
    const attacker = { ...defender, index: 1, position: new THREE.Vector3(40, 0, 0) };
    const owner = createInterceptOwner(scoring);
    const system = new ProjectileSystem({
        entityRuntimeConfig,
        players: [defender, attacker],
        arena: null,
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
        onRocketIntercepted: (event) => handleRocketIntercept(owner, event),
    });

    const spawnRocket = (rocketOwner, position, velocity) => {
        const projectile = system.spawnExternalProjectile({
            owner: rocketOwner,
            type: 'ROCKET_WEAK',
            position: { x: position.x, y: position.y, z: position.z },
            direction: { x: Math.sign(velocity.x) || 1, y: 0, z: 0 },
        });
        projectile.position.copy(position);
        projectile.previousPosition.copy(position);
        projectile.velocity.copy(velocity);
        projectile.mesh?.position.copy(position);
        return projectile;
    };

    const incoming = spawnRocket(attacker, new THREE.Vector3(3.4, 0, 0), new THREE.Vector3(-45, 0, 0));
    const interceptor = spawnRocket(defender, new THREE.Vector3(0, 0, 0), new THREE.Vector3(45, 0, 0));
    interceptor.isInterceptor = true;
    interceptor.interceptTargetId = incoming.traversalId;

    system.update(1 / 60);

    assert.equal(system.projectiles.length, 0, 'both rockets left the field');
    assert.equal(
        scoring.getScoreboard([defender, attacker]).find((row) => row.playerIndex === 0).intercepts,
        1,
        'one intercept hit is credited exactly once'
    );
    system.dispose();
});
