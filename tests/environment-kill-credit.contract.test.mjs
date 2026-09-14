import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ENVIRONMENT_KILL_HIT_WINDOW_SECONDS,
    ENVIRONMENT_KILL_THREAT_WINDOW_SECONDS,
    isEnvironmentKillCause,
    resolveEnvironmentKillCredit,
} from '../src/hunt/EnvironmentKillCreditOps.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { killPlayer } from '../src/entities/EntityPlayerDeathOps.js';
import { senseProjectiles } from '../src/entities/ai/BotThreatOps.js';
import { resolveDirectionalProjectileThreat } from '../src/entities/ai/HeuristicProjectileSafetyOps.js';
import * as THREE from 'three';

function makePlayer(index, overrides = {}) {
    return {
        index,
        alive: true,
        isBot: false,
        maxHp: 100,
        maxShieldHp: 0,
        position: { x: 0, y: 0, z: 0 },
        fightSpawnedAtSeconds: 0,
        kill() { this.alive = false; },
        ...overrides,
    };
}

// The damage history is stamped on the scoring clock, so tests place hits relative to it.
function scoringSecondsAgo(seconds) {
    return (performance.now() * 0.001) - seconds;
}

function makeEntityManager(players, scoring, simulationClockMs) {
    const feed = [];
    const events = [];
    return {
        players,
        feed,
        events,
        _simulationClockMs: simulationClockMs,
        _huntScoring: scoring,
        isFightOutcomeAuthority: true,
        gameModeStrategy: { hasScoring: () => true },
        _respawnSystem: { onPlayerDied() {} },
        _eventBus: {
            emitHuntFeed: (text) => feed.push(text),
            emitPlayerDied() {},
        },
        recorder: {
            markPlayerDeath() {},
            logEvent: (type, playerIndex, details) => events.push({ type, playerIndex, details }),
        },
    };
}

test('environment kill credit: a hit inside the window credits the shooter', () => {
    const victim = makePlayer(1, { isBot: true });
    const shooter = makePlayer(0);
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [shooter, victim],
        damageHistory: [{ attackerIndex: 0, ageSeconds: 2 }],
        nowSeconds: 20,
    });
    assert.equal(result.credit, 'hit');
    assert.equal(result.killer, shooter);
});

test('environment kill credit: a stale hit credits nobody', () => {
    const victim = makePlayer(1, { isBot: true });
    const shooter = makePlayer(0);
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [shooter, victim],
        damageHistory: [{ attackerIndex: 0, ageSeconds: 10 }],
        nowSeconds: 20,
    });
    assert.equal(result.credit, null);
    assert.equal(result.killer, null);
});

test('environment kill credit: a dodged threat credits the projectile owner', () => {
    const victim = makePlayer(2, {
        isBot: true,
        fightLastThreatSourceIndex: 1,
        fightLastThreatAtSeconds: 19,
    });
    const bystander = makePlayer(0);
    const threatOwner = makePlayer(1);
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [bystander, threatOwner, victim],
        damageHistory: [],
        nowSeconds: 20,
    });
    assert.equal(result.credit, 'threat');
    assert.equal(result.killer, threatOwner);
});

test('environment kill credit: a stale threat credits nobody', () => {
    const victim = makePlayer(2, {
        isBot: true,
        fightLastThreatSourceIndex: 1,
        fightLastThreatAtSeconds: 10,
    });
    const threatOwner = makePlayer(1);
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [threatOwner, victim],
        damageHistory: [],
        nowSeconds: 20,
    });
    assert.equal(result.credit, null);
    assert.equal(result.killer, null);
});

test('environment kill credit: a hit beats a dodged threat', () => {
    const victim = makePlayer(2, {
        isBot: true,
        fightLastThreatSourceIndex: 1,
        fightLastThreatAtSeconds: 19.5,
    });
    const shooter = makePlayer(0);
    const threatOwner = makePlayer(1);
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [shooter, threatOwner, victim],
        damageHistory: [{ attackerIndex: 0, ageSeconds: 3 }],
        nowSeconds: 20,
    });
    assert.equal(result.credit, 'hit');
    assert.equal(result.killer, shooter);
});

test('environment kill credit: the most recent attacker wins', () => {
    const victim = makePlayer(2, { isBot: true });
    const early = makePlayer(0);
    const late = makePlayer(1);
    const result = resolveEnvironmentKillCredit({
        cause: 'TRAIL_SELF',
        victim,
        players: [early, late, victim],
        damageHistory: [
            { attackerIndex: 0, ageSeconds: 3 },
            { attackerIndex: 1, ageSeconds: 1 },
        ],
        nowSeconds: 20,
    });
    assert.equal(result.credit, 'hit');
    assert.equal(result.killer, late);
});

test('environment kill credit: the victim never credits itself', () => {
    const victim = makePlayer(1, {
        isBot: true,
        fightLastThreatSourceIndex: 1,
        fightLastThreatAtSeconds: 19.5,
    });
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [victim],
        damageHistory: [{ attackerIndex: 1, ageSeconds: 1 }],
        nowSeconds: 20,
    });
    assert.equal(result.credit, null);
    assert.equal(result.killer, null);
});

test('environment kill credit: stamps that outlived a round reset are ignored', () => {
    const victim = makePlayer(2, {
        isBot: true,
        fightLastThreatSourceIndex: 1,
        fightLastThreatAtSeconds: 40,
    });
    const shooter = makePlayer(0);
    const threatOwner = makePlayer(1);
    const result = resolveEnvironmentKillCredit({
        cause: 'WALL',
        victim,
        players: [shooter, threatOwner, victim],
        damageHistory: [{ attackerIndex: 0, ageSeconds: -30 }],
        nowSeconds: 2,
    });
    assert.equal(result.credit, null);
    assert.equal(result.killer, null);
});

test('environment kill credit: only environment causes are credited', () => {
    assert.equal(isEnvironmentKillCause('WALL'), true);
    assert.equal(isEnvironmentKillCause('TRAIL_SELF'), true);
    assert.equal(isEnvironmentKillCause('TRAIL_OTHER'), true);
    assert.equal(isEnvironmentKillCause('PLAYER_CRASH'), false);
    assert.equal(isEnvironmentKillCause('ROCKET'), false);

    const victim = makePlayer(1, { isBot: true });
    const shooter = makePlayer(0);
    const result = resolveEnvironmentKillCredit({
        cause: 'PLAYER_CRASH',
        victim,
        players: [shooter, victim],
        damageHistory: [{ attackerIndex: 0, ageSeconds: 1 }],
        nowSeconds: 20,
    });
    assert.equal(result.credit, null);
    assert.equal(result.killer, null);
});

test('environment kill credit: windows default to 4 and 2 seconds', () => {
    assert.equal(ENVIRONMENT_KILL_HIT_WINDOW_SECONDS, 4);
    assert.equal(ENVIRONMENT_KILL_THREAT_WINDOW_SECONDS, 2);
});

test('environment kill credit: a wall death after a hit scores for the shooter', () => {
    const shooter = makePlayer(0);
    const victim = makePlayer(1, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(shooter, victim, { applied: 30, hpApplied: 30 }, scoringSecondsAgo(2));
    const entityManager = makeEntityManager([shooter, victim], scoring, 20000);

    killPlayer(entityManager, victim, 'WALL');

    const scoreboard = scoring.getScoreboard([shooter, victim]);
    assert.equal(scoreboard.find((row) => row.playerIndex === 0).kills, 1);
    assert.equal(scoreboard.find((row) => row.playerIndex === 1).deaths, 1);
    assert.deepEqual(entityManager.feed, ['P1 -> Bot 2: in die Wand getrieben']);
    assert.equal(entityManager.events[0].details, 'cause=WALL killer=0 credit=hit');
});

test('environment kill credit: a trail death after a hit reads as trail in the feed', () => {
    const shooter = makePlayer(0);
    const victim = makePlayer(1, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(shooter, victim, { applied: 30, hpApplied: 30 }, scoringSecondsAgo(2));
    const entityManager = makeEntityManager([shooter, victim], scoring, 20000);

    killPlayer(entityManager, victim, 'TRAIL_SELF');

    assert.deepEqual(entityManager.feed, ['P1 -> Bot 2: in die Spur getrieben']);
    assert.equal(entityManager.events[0].details, 'cause=TRAIL_SELF killer=0 credit=hit');
});

test('environment kill credit: a known trail owner keeps the kill and the plain feed text', () => {
    const owner = makePlayer(0);
    const shooter = makePlayer(2);
    const victim = makePlayer(1, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(shooter, victim, { applied: 30, hpApplied: 30 }, scoringSecondsAgo(1));
    const entityManager = makeEntityManager([owner, victim, shooter], scoring, 20000);

    killPlayer(entityManager, victim, 'TRAIL_OTHER', { killer: owner });

    const scoreboard = scoring.getScoreboard([owner, victim, shooter]);
    assert.equal(scoreboard.find((row) => row.playerIndex === 0).kills, 1);
    assert.equal(scoreboard.find((row) => row.playerIndex === 2).kills, 0);
    assert.deepEqual(entityManager.feed[0], 'P1 -> Bot 2: ausgeschaltet');
    assert.equal(entityManager.events[0].details, 'cause=TRAIL_OTHER killer=0');
});

test('environment kill credit: an uncredited wall death stays uncredited', () => {
    const shooter = makePlayer(0);
    const victim = makePlayer(1, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(shooter, victim, { applied: 30, hpApplied: 30 }, scoringSecondsAgo(10));
    const entityManager = makeEntityManager([shooter, victim], scoring, 20000);

    killPlayer(entityManager, victim, 'WALL');

    const scoreboard = scoring.getScoreboard([shooter, victim]);
    assert.equal(scoreboard.find((row) => row.playerIndex === 0).kills, 0);
    assert.deepEqual(entityManager.feed, []);
    assert.equal(entityManager.events[0].details, 'cause=WALL killer=-1');
});

test('environment kill credit: a dodged threat credits through the death path', () => {
    const threatOwner = makePlayer(0);
    const victim = makePlayer(1, {
        isBot: true,
        fightLastThreatSourceIndex: 0,
        fightLastThreatAtSeconds: 19,
    });
    const scoring = new HuntScoring();
    const entityManager = makeEntityManager([threatOwner, victim], scoring, 20000);

    killPlayer(entityManager, victim, 'WALL');

    const scoreboard = scoring.getScoreboard([threatOwner, victim]);
    assert.equal(scoreboard.find((row) => row.playerIndex === 0).kills, 1);
    assert.equal(entityManager.events[0].details, 'cause=WALL killer=0 credit=threat');
});

test('environment kill credit: the assist window keeps using the scoring clock', () => {
    const killer = makePlayer(0);
    const helper = makePlayer(2);
    const straggler = makePlayer(3);
    const victim = makePlayer(1, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(helper, victim, { applied: 30, hpApplied: 30 }, scoringSecondsAgo(3));
    scoring.registerDamage(straggler, victim, { applied: 30, hpApplied: 30 }, scoringSecondsAgo(12));
    // The simulation clock stands at 20 s; if it leaked into the assist window, the 12 s old
    // hit would look fresh and hand out an extra assist.
    const entityManager = makeEntityManager([killer, victim, helper, straggler], scoring, 20000);

    killPlayer(entityManager, victim, 'PLAYER_CRASH', { killer });

    const scoreboard = scoring.getScoreboard([killer, victim, helper, straggler]);
    assert.equal(scoreboard.find((row) => row.playerIndex === 2).assists, 1);
    assert.equal(scoreboard.find((row) => row.playerIndex === 3).assists, 0);
    assert.deepEqual(entityManager.feed, [
        'P1 -> Bot 2: ausgeschaltet',
        'P3: Assist bei Bot 2',
    ]);
});

test('environment kill credit: the damage history reports hit ages before elimination', () => {
    const shooter = makePlayer(0);
    const other = makePlayer(2);
    const victim = makePlayer(1, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(shooter, victim, { applied: 30, hpApplied: 30 }, 18);
    scoring.registerDamage(other, victim, { applied: 5, hpApplied: 5 }, 19.5);
    assert.deepEqual(scoring.getDamageHistoryAges(1, 20), [
        { attackerIndex: 0, ageSeconds: 2 },
        { attackerIndex: 2, ageSeconds: 0.5 },
    ]);
    assert.deepEqual(scoring.getDamageHistoryAges(7, 20), []);

    // The elimination path still clears the history, so a credited kill cannot count twice.
    scoring.registerElimination(victim, { killer: shooter, nowSeconds: 20 });
    assert.deepEqual(scoring.getDamageHistoryAges(1, 20), []);
});

function makeThreatPolicyScratch() {
    return {
        _tmpForward: new THREE.Vector3(),
        _tmpRight: new THREE.Vector3(),
        _tmpUp: new THREE.Vector3(),
        _tmpProjectileRelative: new THREE.Vector3(),
        _tmpProjectileVelocity: new THREE.Vector3(),
        _tmpEvade: new THREE.Vector3(),
    };
}

test('environment kill credit: the heuristic bot stamps the dodged threat on the simulation clock', () => {
    const owner = makePlayer(0);
    const victim = makePlayer(1, {
        isBot: true,
        position: new THREE.Vector3(0, 0, 0),
        speed: 0,
        hitboxRadius: 0.8,
        getDirection(out) { return out.set(0, 0, 1); },
    });
    const projectile = {
        owner,
        position: new THREE.Vector3(10, 0, 0),
        velocity: new THREE.Vector3(-20, 0, 0),
        radius: 0.5,
    };
    const runtimeContext = { projectiles: [projectile], entityManager: { _simulationClockMs: 20000 } };
    const state = { planarMode: true };
    const config = { projectileThreatRange: 25, projectileImpactHorizon: 2, projectileSafetyRadius: 1 };

    const threatened = resolveDirectionalProjectileThreat(makeThreatPolicyScratch(), state, victim, runtimeContext, config);

    assert.equal(threatened, true);
    assert.equal(victim.fightLastThreatSourceIndex, 0);
    assert.equal(victim.fightLastThreatAtSeconds, 20);
});

test('environment kill credit: the rule-based bot stamps the dodged threat on the simulation clock', () => {
    const owner = makePlayer(0);
    const entityManager = { _simulationClockMs: 20000 };
    const victim = makePlayer(1, {
        isBot: true,
        entityManager,
        position: new THREE.Vector3(0, 0, 0),
        getDirection(out) { return out.set(0, 0, 1); },
    });
    const projectile = {
        owner,
        position: new THREE.Vector3(0, 0, 10),
        velocity: new THREE.Vector3(0, 0, -20),
    };
    const bot = {
        profile: { projectileAwareness: 1 },
        sense: {},
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpVec3: new THREE.Vector3(),
        _tmpForward: new THREE.Vector3(),
        _tmpRight: new THREE.Vector3(),
        _tmpUp: new THREE.Vector3(),
        _random: () => 0,
        _buildBasis(forward) {
            this._tmpRight.crossVectors(new THREE.Vector3(0, 1, 0), forward);
            if (this._tmpRight.lengthSq() < 0.000001) this._tmpRight.set(1, 0, 0);
            else this._tmpRight.normalize();
            this._tmpUp.crossVectors(forward, this._tmpRight).normalize();
        },
    };

    senseProjectiles(bot, victim, [projectile]);

    assert.equal(bot.sense.projectileThreat, true);
    assert.equal(victim.fightLastThreatSourceIndex, 0);
    assert.equal(victim.fightLastThreatAtSeconds, 20);
});
