import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { selectTarget } from '../src/entities/ai/BotTargetingOps.js';
import { evaluatePursuit } from '../src/entities/ai/BotThreatOps.js';

/**
 * Stands for BotAI: selectTarget and evaluatePursuit only read state, profile, sense and the
 * scratch vectors, so a plain object with those fields drives the same code as a live bot.
 */
function createBot() {
    return {
        state: { targetPlayer: null },
        profile: { pursuitEnabled: true, pursuitRadius: 60 },
        sense: { immediateDanger: false, forwardRisk: 0 },
        _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpVec3: new THREE.Vector3(),
        _tmpForward: new THREE.Vector3(), _tmpRight: new THREE.Vector3(), _tmpUp: new THREE.Vector3(),
        _buildBasis(forward) {
            this._tmpRight.crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
            this._tmpUp.crossVectors(forward, this._tmpRight).normalize();
        },
    };
}

/** A bot flying along +z; map units come from the same list MapUnitSystem.getTargets() returns. */
function createScene({ huntsMapUnits, units }) {
    const entityManager = { _mapUnitSystem: { getTargets: () => units } };
    const player = {
        index: 1, isBot: true, alive: true, teamId: 'BRAVO', position: new THREE.Vector3(0, 0, 0),
        entityManager,
        getDirection(target) { return target.set(0, 0, 1); },
    };
    if (huntsMapUnits) player.botTargetsMapUnits = true;
    return { player };
}

function tank(z, extra = {}) {
    return { alive: true, hp: 100, maxHp: 100, position: new THREE.Vector3(0, 0, z), ...extra };
}

function farPlayerBehind() {
    return {
        index: 2, alive: true, hp: 100, maxHp: 100, position: new THREE.Vector3(0, 0, -70),
        getDirection(target) { return target.set(0, 0, 1); },
    };
}

test('a bot keeps ignoring map units unless it is told to hunt them', () => {
    const unit = tank(20);
    const { player } = createScene({ huntsMapUnits: false, units: [unit] });
    const bot = createBot();
    selectTarget(bot, player, [player]);
    assert.equal(bot.state.targetPlayer, null, 'an ordinary bot does not pick a map unit as target');
});

test('a map-unit hunter picks a tank ahead over a distant player behind and pursues it', () => {
    const unit = tank(20);
    const other = farPlayerBehind();
    const { player } = createScene({ huntsMapUnits: true, units: [unit] });
    const bot = createBot();
    selectTarget(bot, player, [player, other]);
    assert.equal(bot.state.targetPlayer, unit, 'the tank ahead becomes the target');
    assert.equal(bot.sense.targetInFront, true, 'the tank counts as in front');
    evaluatePursuit(bot, player);
    assert.equal(bot.sense.pursuitActive, true, 'the bot steers into a pursuit of the tank');
});

test('a map-unit hunter never targets escorts, teammates or wrecks', () => {
    const units = [
        tank(10, { escortTank: true }),
        tank(12, { teamId: 'BRAVO' }),
        tank(14, { alive: false }),
        tank(16, { hp: 0 }),
    ];
    const { player } = createScene({ huntsMapUnits: true, units });
    const bot = createBot();
    selectTarget(bot, player, [player]);
    assert.equal(bot.state.targetPlayer, null, 'no protected or destroyed unit is chosen');
    const enemy = tank(30, { teamId: 'ALPHA' });
    units.push(enemy);
    selectTarget(bot, player, [player]);
    assert.equal(bot.state.targetPlayer, enemy, 'an enemy-team unit is still a valid target');
});
