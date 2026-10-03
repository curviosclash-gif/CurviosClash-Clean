import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveAuthoredAnchorScale } from '../src/shared/contracts/GameplayConfigContract.js';

const readSystem = (name) => readFileSync(fileURLToPath(new URL(`../src/entities/systems/${name}`, import.meta.url)), 'utf8');

test('authored anchor scaling stays opt-in and preserves the MAP_SCALE fallback and clamp', () => {
    const map = { scaleAuthoredAnchors: true };

    assert.equal(resolveAuthoredAnchorScale(null, { ARENA: { MAP_SCALE: 3 } }), 1);
    assert.equal(resolveAuthoredAnchorScale({}, { ARENA: { MAP_SCALE: 3 } }), 1);
    assert.equal(resolveAuthoredAnchorScale({ scaleAuthoredAnchors: false }, { ARENA: { MAP_SCALE: 3 } }), 1);
    assert.equal(resolveAuthoredAnchorScale({ scaleAuthoredAnchors: 1 }, { ARENA: { MAP_SCALE: 3 } }), 1);
    assert.equal(resolveAuthoredAnchorScale(map, { ARENA: { MAP_SCALE: '2.5' } }), 2.5);
    assert.equal(resolveAuthoredAnchorScale(map, { ARENA: { MAP_SCALE: 0 } }), 1);
    assert.equal(resolveAuthoredAnchorScale(map, { ARENA: { MAP_SCALE: Number.NaN } }), 1);
    assert.equal(resolveAuthoredAnchorScale(map, { ARENA: { MAP_SCALE: -3 } }), 0.001);
    assert.equal(resolveAuthoredAnchorScale(map, { ARENA: { MAP_SCALE: 0.0001 } }), 0.001);
    assert.equal(resolveAuthoredAnchorScale(map, { ARENA: { MAP_SCALE: Number.POSITIVE_INFINITY } }), Number.POSITIVE_INFINITY);
    assert.equal(resolveAuthoredAnchorScale(map, null), 3);
    assert.equal(resolveAuthoredAnchorScale(map, { entityRuntimeConfig: { ARENA: { MAP_SCALE: 4 } } }), 4);
});

test('all seven runtime anchor consumers use the shared opt-in scale rule', () => {
    const consumers = [
        ['MapUnitSystem.js', 'mapDefinition', 'owner'],
        ['StaticTurretSystem.js', 'mapDefinition', 'owner'],
        ['FlagObjectiveSystem.js', 'map', 'this.entityManager'],
        ['WaterZoneSystem.js', 'map', 'this.entityManager'],
        ['MapOwnedPickupSystem.js', 'map', 'owner'],
        ['MapHazardSystem.js', 'map', 'this.entityManager'],
        ['MapDestructibleSystem.js', 'map', 'this.entityManager'],
    ];

    for (const [file, mapName, configSource] of consumers) {
        const source = readSystem(file);
        assert.match(source, /import \{ resolveAuthoredAnchorScale \} from '\.\.\/\.\.\/shared\/contracts\/GameplayConfigContract\.js';/, file);
        assert.match(source, new RegExp(`resolveAuthoredAnchorScale\\(${mapName}, ${configSource}\\)`), file);
    }
});
