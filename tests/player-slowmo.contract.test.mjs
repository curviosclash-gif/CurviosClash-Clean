import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import {
    resolveGlobalTimeScale,
    resolveMotionClockFactor,
    updatePlayerCharges,
} from '../src/entities/player/PlayerChargeOps.js';
import { updatePlayerMotion } from '../src/entities/player/PlayerMotionOps.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { PlanarAimAssistSystem } from '../src/core/PlanarAimAssistSystem.js';
import { Player } from '../src/entities/Player.js';
import { normalizeControlBindings } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';

// Boost: capacity 4 / recharge time 5 -> 0.8 charge per game second.
// Slow motion: capacity 3 / recharge time 8 -> 0.375 charge per game second.
const PLAYER_CONFIG = Object.freeze({
    SPEED: 10,
    TURN_SPEED: 2,
    ROLL_SPEED: 2,
    BOOST_MULTIPLIER: 2,
    BOOST_DURATION: 4,
    BOOST_COOLDOWN: 5,
    SLOWMO_DURATION: 3,
    SLOWMO_COOLDOWN: 8,
    SLOWMO_TIME_SCALE: 0.4,
    // Deliberately unequal: equal factors would let the two keys be swapped unnoticed.
    SLOWMO_BOOST_RECHARGE_BONUS: 2,
    BOOST_SLOWMO_RECHARGE_BONUS: 3,
    HITBOX_RADIUS: 0.8,
    AUTO_ROLL: false,
    AUTO_ROLL_SPEED: 3,
});

const RUNTIME_CONFIG = Object.freeze({
    PLAYER: PLAYER_CONFIG,
    GAMEPLAY: Object.freeze({ PLANAR_MODE: false }),
    POWERUP: Object.freeze({}),
});

const BOOST_RECHARGE_PER_GAME_SECOND = PLAYER_CONFIG.BOOST_DURATION / PLAYER_CONFIG.BOOST_COOLDOWN;
const SLOWMO_RECHARGE_PER_GAME_SECOND = PLAYER_CONFIG.SLOWMO_DURATION / PLAYER_CONFIG.SLOWMO_COOLDOWN;

function createChargePlayer(overrides = {}) {
    return {
        entityRuntimeConfig: RUNTIME_CONFIG,
        isBot: false,
        alive: true,
        boostCharge: PLAYER_CONFIG.BOOST_DURATION,
        boostTimer: PLAYER_CONFIG.BOOST_DURATION,
        boostCooldown: 0,
        manualBoostActive: false,
        isBoosting: false,
        slowMoCharge: PLAYER_CONFIG.SLOWMO_DURATION,
        slowMoTimer: PLAYER_CONFIG.SLOWMO_DURATION,
        slowMoCooldown: 0,
        manualSlowMoActive: false,
        isSlowMoActive: false,
        hasSlowTime: false,
        slowTimeScale: 1,
        ...overrides,
    };
}

function slowMoControl(pressed) {
    return { slowMo: true, slowMoPressed: pressed };
}

// Motion needs the reused THREE scratch objects a real Player carries.
function createMotionPlayer(overrides = {}) {
    return {
        ...createChargePlayer(overrides),
        turnSpeed: 2,
        rollSpeed: 2,
        baseSpeed: 10,
        speed: 10,
        boostPortalTimer: 0,
        boostPortalParams: null,
        slingshotTimer: 0,
        slingshotParams: null,
        currentPlanarY: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        _tmpEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpEuler2: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpQuat: new THREE.Quaternion(),
        _tmpVec: new THREE.Vector3(),
        _tmpDir: new THREE.Vector3(),
        boostPortalDir: new THREE.Vector3(),
        slingshotForward: new THREE.Vector3(),
        slingshotUp: new THREE.Vector3(),
    };
}

function linkPlayers(...players) {
    const entityManager = { players };
    for (const player of players) {
        player.entityManager = entityManager;
    }
    return entityManager;
}

const STEP = 1 / 60;

test('bullet time moves only the key holder in real time', () => {
    const actor = createMotionPlayer({ manualSlowMoActive: true });
    const bystander = createMotionPlayer();
    linkPlayers(actor, bystander);

    const actorMotionDt = STEP * resolveMotionClockFactor(actor);
    const bystanderMotionDt = STEP * resolveMotionClockFactor(bystander);
    updatePlayerMotion(actor, STEP, null, 1, actorMotionDt);
    updatePlayerMotion(bystander, STEP, null, 1, bystanderMotionDt);

    const expectedActor = -actor.speed * (STEP / PLAYER_CONFIG.SLOWMO_TIME_SCALE);
    const expectedBystander = -bystander.speed * STEP;
    assert.ok(Math.abs(actor.position.z - expectedActor) < 1e-9);
    assert.ok(Math.abs(bystander.position.z - expectedBystander) < 1e-9);
    assert.ok(Math.abs(actor.position.z / bystander.position.z - 2.5) < 1e-9);
});

test('bullet time turns the key holder in real time', () => {
    const actor = createMotionPlayer({ manualSlowMoActive: true });
    linkPlayers(actor);

    const motionDt = STEP * resolveMotionClockFactor(actor);
    updatePlayerMotion(actor, STEP, { yawInput: 1 }, 1, motionDt);

    const rotation = new THREE.Euler().setFromQuaternion(actor.quaternion, 'YXZ');
    const expected = actor.turnSpeed * (STEP / PLAYER_CONFIG.SLOWMO_TIME_SCALE);
    assert.ok(Math.abs(rotation.y - expected) < 1e-9);
});

test('the SLOW_TIME powerup alone speeds nobody up', () => {
    const carrier = createMotionPlayer({ hasSlowTime: true, slowTimeScale: 0.4 });
    const other = createMotionPlayer();
    linkPlayers(carrier, other);

    assert.equal(resolveMotionClockFactor(carrier), 1);
    assert.equal(resolveMotionClockFactor(other), 1);

    updatePlayerMotion(carrier, STEP, null, 1, STEP * resolveMotionClockFactor(carrier));
    updatePlayerMotion(other, STEP, null, 1, STEP * resolveMotionClockFactor(other));

    assert.ok(Math.abs(carrier.position.z - (-carrier.speed * STEP)) < 1e-9);
    assert.ok(Math.abs(other.position.z - (-other.speed * STEP)) < 1e-9);
});

test('bullet time drains the key holder boost in real time, the others in game time', () => {
    const actor = createChargePlayer({ manualSlowMoActive: true, manualBoostActive: true });
    const bystander = createChargePlayer({ manualBoostActive: true });
    linkPlayers(actor, bystander);

    updatePlayerCharges(actor, STEP, null);
    updatePlayerCharges(bystander, STEP, null);

    const expectedActor = PLAYER_CONFIG.BOOST_DURATION - (STEP / PLAYER_CONFIG.SLOWMO_TIME_SCALE);
    const expectedBystander = PLAYER_CONFIG.BOOST_DURATION - STEP;
    assert.ok(Math.abs(actor.boostCharge - expectedActor) < 1e-9);
    assert.ok(Math.abs(bystander.boostCharge - expectedBystander) < 1e-9);
});

test('resolveMotionClockFactor stays neutral for dead players and bots', () => {
    const corpse = createChargePlayer({ manualSlowMoActive: true, alive: false });
    const bot = createChargePlayer({ manualSlowMoActive: true, isBot: true });
    const idle = createChargePlayer();
    linkPlayers(corpse, bot, idle);

    assert.equal(resolveMotionClockFactor(corpse), 1);
    assert.equal(resolveMotionClockFactor(bot), 1);
    assert.equal(resolveMotionClockFactor(idle), 1);
});

test('slow motion toggles on the key press and off on the next press', () => {
    const player = createChargePlayer();

    updatePlayerCharges(player, 1 / 60, slowMoControl(true));
    assert.equal(player.manualSlowMoActive, true);
    assert.equal(player.isSlowMoActive, true);

    updatePlayerCharges(player, 1 / 60, slowMoControl(false));
    assert.equal(player.manualSlowMoActive, true);

    updatePlayerCharges(player, 1 / 60, slowMoControl(true));
    assert.equal(player.manualSlowMoActive, false);
    assert.equal(player.isSlowMoActive, false);
});

test('bots never activate slow motion even when the control state asks for it', () => {
    const bot = createChargePlayer({ isBot: true });

    updatePlayerCharges(bot, 1 / 60, slowMoControl(true));
    assert.equal(bot.manualSlowMoActive, false);

    updatePlayerCharges(bot, 1 / 60, slowMoControl(true));
    assert.equal(bot.manualSlowMoActive, false);
    assert.equal(bot.slowMoCharge, PLAYER_CONFIG.SLOWMO_DURATION);
});

test('slow motion refuses to start below the minimum activation charge', () => {
    // Minimum activation charge is max(0.05, capacity * 0.02) = 0.06 here.
    const player = createChargePlayer({ slowMoCharge: 0.05 });

    updatePlayerCharges(player, 1 / 60, slowMoControl(true));
    assert.equal(player.manualSlowMoActive, false);
});

test('an emptied slow-motion reserve switches the effect off', () => {
    const player = createChargePlayer({ slowMoCharge: 0.2, manualSlowMoActive: true });

    updatePlayerCharges(player, 0.2, slowMoControl(false));
    assert.equal(player.slowMoCharge, 0);
    assert.equal(player.manualSlowMoActive, false);
});

test('slow motion drains on the real clock, not on game time', () => {
    const player = createChargePlayer({ manualSlowMoActive: true });

    // One real second at time scale 0.4 arrives as 0.4 seconds of game time.
    updatePlayerCharges(player, 0.4, slowMoControl(false));
    assert.ok(Math.abs(player.slowMoCharge - (PLAYER_CONFIG.SLOWMO_DURATION - 1)) < 1e-9);
});

test('boost recharge without slow motion stays on plain game time', () => {
    const player = createChargePlayer({ boostCharge: 0 });

    updatePlayerCharges(player, 1, null);
    assert.ok(Math.abs(player.boostCharge - BOOST_RECHARGE_PER_GAME_SECOND) < 1e-9);
    assert.ok(Math.abs(player.boostTimer - player.boostCharge) < 1e-9);
});

test('boost recharges per real second faster while slow motion is active', () => {
    const plain = createChargePlayer({ boostCharge: 0 });
    updatePlayerCharges(plain, 1, null);

    const slowed = createChargePlayer({ boostCharge: 0, manualSlowMoActive: true });
    // 0.4 seconds of game time are one real second at time scale 0.4.
    updatePlayerCharges(slowed, 0.4, slowMoControl(false));

    const expected = BOOST_RECHARGE_PER_GAME_SECOND * PLAYER_CONFIG.SLOWMO_BOOST_RECHARGE_BONUS;
    assert.ok(Math.abs(slowed.boostCharge - expected) < 1e-9);
    assert.ok(Math.abs(slowed.boostCharge / plain.boostCharge - PLAYER_CONFIG.SLOWMO_BOOST_RECHARGE_BONUS) < 1e-9);
});

test('slow motion recharges faster while boost is active', () => {
    const plain = createChargePlayer({ slowMoCharge: 0 });
    updatePlayerCharges(plain, 1, null);

    const boosted = createChargePlayer({ slowMoCharge: 0, manualBoostActive: true });
    updatePlayerCharges(boosted, 1, null);

    assert.ok(Math.abs(plain.slowMoCharge - SLOWMO_RECHARGE_PER_GAME_SECOND) < 1e-9);
    const expected = SLOWMO_RECHARGE_PER_GAME_SECOND * PLAYER_CONFIG.BOOST_SLOWMO_RECHARGE_BONUS;
    assert.ok(Math.abs(boosted.slowMoCharge - expected) < 1e-9);
});

test('a reserve never recharges while it is active itself', () => {
    const player = createChargePlayer({
        boostCharge: 1,
        manualBoostActive: true,
        slowMoCharge: 1,
        manualSlowMoActive: true,
    });

    updatePlayerCharges(player, 0.1, slowMoControl(false));
    assert.ok(player.boostCharge < 1);
    assert.ok(player.slowMoCharge < 1);
});

test('boost gains the slow-motion bonus while another player holds the key', () => {
    // Slow motion bends the clock for everyone, so the faster boost refill must reach
    // every player, not only the one pressing the key.
    const plain = createChargePlayer({ boostCharge: 0 });
    updatePlayerCharges(plain, 1, null);

    const bystander = createChargePlayer({ boostCharge: 0 });
    const holder = createChargePlayer({ manualSlowMoActive: true });
    const entityManager = { players: [bystander, holder] };
    bystander.entityManager = entityManager;
    holder.entityManager = entityManager;

    // 0.4 seconds of game time are one real second at time scale 0.4.
    updatePlayerCharges(bystander, 0.4, null);

    const expected = BOOST_RECHARGE_PER_GAME_SECOND * PLAYER_CONFIG.SLOWMO_BOOST_RECHARGE_BONUS;
    assert.ok(Math.abs(bystander.boostCharge - expected) < 1e-9);
    assert.ok(Math.abs(bystander.boostCharge / plain.boostCharge - PLAYER_CONFIG.SLOWMO_BOOST_RECHARGE_BONUS) < 1e-9);
});

test('kill clears the slow-motion flag so a dead player stops bending the clock', () => {
    const player = {
        alive: true,
        hp: 40,
        manualSlowMoActive: true,
        isSlowMoActive: true,
        hasSlowTime: true,
        slowTimeScale: 0.4,
    };

    Player.prototype.kill.call(player);

    assert.equal(player.alive, false);
    assert.equal(player.manualSlowMoActive, false);
    assert.equal(player.isSlowMoActive, false);
    assert.equal(player.hasSlowTime, false);
    assert.equal(player.slowTimeScale, 1);
});

test('resolveGlobalTimeScale ignores dead players', () => {
    const survivor = createChargePlayer();
    const corpse = createChargePlayer({ manualSlowMoActive: true, hasSlowTime: true, slowTimeScale: 0.2, alive: false });
    const entityManager = { players: [survivor, corpse] };
    survivor.entityManager = entityManager;
    corpse.entityManager = entityManager;

    assert.equal(resolveGlobalTimeScale(survivor), 1);
});

test('applyPlayingTimeScaleFromEffects ignores dead players', () => {
    const appliedScales = [];
    const players = [
        { alive: true, hasSlowTime: false, slowTimeScale: 1, manualSlowMoActive: false, entityRuntimeConfig: RUNTIME_CONFIG },
        { alive: false, hasSlowTime: true, slowTimeScale: 0.2, manualSlowMoActive: true, entityRuntimeConfig: RUNTIME_CONFIG },
    ];
    const system = new PlanarAimAssistSystem({
        getEntityManager: () => ({ players }),
        getGameLoop: () => ({ setTimeScale: (value) => appliedScales.push(value) }),
        getEntityRuntimeConfig: () => RUNTIME_CONFIG,
    });

    system.applyPlayingTimeScaleFromEffects();
    assert.equal(appliedScales.at(-1), 1);
});

test('resolveGlobalTimeScale takes the minimum of powerup and slow-motion key', () => {
    const keyPlayer = createChargePlayer({ manualSlowMoActive: true });
    assert.ok(Math.abs(resolveGlobalTimeScale(keyPlayer) - PLAYER_CONFIG.SLOWMO_TIME_SCALE) < 1e-9);

    const powerupPlayer = createChargePlayer({ hasSlowTime: true, slowTimeScale: 0.25 });
    assert.ok(Math.abs(resolveGlobalTimeScale(powerupPlayer) - 0.25) < 1e-9);

    const idle = createChargePlayer();
    assert.equal(resolveGlobalTimeScale(idle), 1);

    // Any player in the match slows the shared clock down.
    const bystander = createChargePlayer();
    const slower = createChargePlayer({ manualSlowMoActive: true });
    const entityManager = { players: [bystander, slower] };
    bystander.entityManager = entityManager;
    slower.entityManager = entityManager;
    assert.ok(Math.abs(resolveGlobalTimeScale(bystander) - PLAYER_CONFIG.SLOWMO_TIME_SCALE) < 1e-9);
});

test('applyPlayingTimeScaleFromEffects takes the minimum of powerup and slow-motion key', () => {
    const appliedScales = [];
    const players = [
        { hasSlowTime: false, slowTimeScale: 1, manualSlowMoActive: false },
        { hasSlowTime: false, slowTimeScale: 1, manualSlowMoActive: false },
    ];
    const system = new PlanarAimAssistSystem({
        getEntityManager: () => ({ players }),
        getGameLoop: () => ({ setTimeScale: (value) => appliedScales.push(value) }),
        getEntityRuntimeConfig: () => RUNTIME_CONFIG,
    });

    players[1].manualSlowMoActive = true;
    system.applyPlayingTimeScaleFromEffects();
    assert.equal(appliedScales.at(-1), PLAYER_CONFIG.SLOWMO_TIME_SCALE);

    players[0].hasSlowTime = true;
    players[0].slowTimeScale = 0.25;
    system.applyPlayingTimeScaleFromEffects();
    assert.equal(appliedScales.at(-1), 0.25);

    players[0].hasSlowTime = false;
    players[0].slowTimeScale = 1;
    players[1].manualSlowMoActive = false;
    system.applyPlayingTimeScaleFromEffects();
    assert.equal(appliedScales.at(-1), 1);
});

test('default key bindings reserve KeyV and Numpad0 for slow motion', () => {
    assert.equal(CONFIG_SECTIONS.KEYS.PLAYER_1.SLOWMO, 'KeyV');
    assert.equal(CONFIG_SECTIONS.KEYS.PLAYER_2.SLOWMO, 'Numpad0');
    assert.equal(CONFIG_SECTIONS.PLAYER.SLOWMO_DURATION, 3.0);
    assert.equal(CONFIG_SECTIONS.PLAYER.SLOWMO_COOLDOWN, 8.0);
    assert.equal(CONFIG_SECTIONS.PLAYER.SLOWMO_TIME_SCALE, 0.4);
    assert.equal(CONFIG_SECTIONS.PLAYER.SLOWMO_BOOST_RECHARGE_BONUS, 2);
    assert.equal(CONFIG_SECTIONS.PLAYER.BOOST_SLOWMO_RECHARGE_BONUS, 2);
});

test('normalizeControlBindings fills a missing slow-motion key from the defaults', () => {
    const base = { ...CONFIG_SECTIONS.KEYS.PLAYER_1 };
    const legacy = { ...base };
    delete legacy.SLOWMO;

    assert.equal(normalizeControlBindings(legacy, base).SLOWMO, 'KeyV');
    assert.equal(normalizeControlBindings({ ...base, SLOWMO: 'KeyB' }, base).SLOWMO, 'KeyB');
});

test('the runtime player projection carries the slow-motion reserve', () => {
    const projection = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        slowMoCharge: 1.5,
        slowMoCapacity: 3,
        slowMoRecharging: true,
        slowMoActive: true,
    });

    assert.equal(projection.slowMoCharge, 1.5);
    assert.equal(projection.slowMoCapacity, 3);
    assert.equal(projection.slowMoRecharging, true);
    assert.equal(projection.slowMoActive, true);

    const fallback = createMatchRuntimePlayerProjection({ playerIndex: 1 });
    assert.equal(fallback.slowMoCharge, 0);
    assert.equal(fallback.slowMoCapacity, 1);
    assert.equal(fallback.slowMoRecharging, false);
    assert.equal(fallback.slowMoActive, false);
});
