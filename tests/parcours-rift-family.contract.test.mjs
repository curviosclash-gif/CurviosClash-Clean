import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

// The three Rift maps share one world and used to differ by little more than a few ring radii
// (precision was even milder on death than the base map). Each has to feel like its name.

const rift = MAP_PRESET_CATALOG.parcours_rift;
const sprint = MAP_PRESET_CATALOG.parcours_rift_sprint;
const precision = MAP_PRESET_CATALOG.parcours_rift_precision;
const rulesOf = (map) => buildRouteFromParcours(map.parcours).rules;
const ringsOf = (map) => [...map.parcours.checkpoints, map.parcours.finish];
const ringById = (map, id) => ringsOf(map).find((ring) => ring.id === id);
const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

test('rift precision rings are about 70 percent of the rift rings, ring for ring', () => {
    for (const ring of ringsOf(rift)) {
        const narrow = ringById(precision, ring.id);
        assert.ok(narrow, `precision has ${ring.id}`);
        const ratio = narrow.radius / ring.radius;
        assert.ok(ratio >= 0.66 && ratio <= 0.74, `${ring.id}: ${narrow.radius} / ${ring.radius} = ${ratio.toFixed(2)}`);
        assert.deepEqual(narrow.pos, ring.pos, `${ring.id} keeps its place`);
    }
});

test('rift precision punishes a death at least as hard as rift and a slow segment harder', () => {
    const base = rulesOf(rift);
    const strict = rulesOf(precision);
    assert.equal(strict.resetOnDeath, true, 'a death wipes the progress');
    assert.equal(strict.resetToLastValid, false, 'no fall back to the last ring');
    assert.equal(base.resetOnDeath, true);
    assert.ok(strict.maxSegmentTimeMs <= base.maxSegmentTimeMs * 0.7, `segment time ${strict.maxSegmentTimeMs} vs ${base.maxSegmentTimeMs}`);
    assert.ok(strict.wrongOrderPenaltyMs > base.wrongOrderPenaltyMs, 'wrong order costs more');
});

test('rift tunnel branch pays for its length: a speed item on the line and a portal at its exit', () => {
    const entry = ringById(rift, 'CP04').pos;
    const tunnel = ringById(rift, 'CP04A_TUNNEL').pos;
    const boost = ringById(rift, 'CP04B_BOOST').pos;
    const merge = ringById(rift, 'CP05').pos;
    const toSegment = (point) => {
        const line = tunnel.map((value, axis) => value - entry[axis]);
        const t = Math.min(1, Math.max(0, point.reduce((sum, value, axis) => sum + (value - entry[axis]) * line[axis], 0)
            / line.reduce((sum, value) => sum + value * value, 0)));
        return distance(point, entry.map((value, axis) => value + line[axis] * t));
    };
    const item = rift.items.find((entry) => entry.pickupType === 'SPEED_UP' && toSegment([entry.x, entry.y, entry.z]) <= 3);
    assert.ok(item, 'a SPEED_UP anchor lies on the way into the tunnel ring');

    const portal = rift.portals.find((pair) => distance(pair.a, tunnel) <= 12);
    assert.ok(portal, 'a portal opens within 12 units of the tunnel ring');
    // Tunnel plus portal jump against the boost lane: no longer a different race, within 10 percent.
    const viaTunnel = distance(entry, tunnel) + distance(tunnel, portal.a) + distance(portal.b, merge);
    const viaBoost = distance(entry, boost) + distance(boost, merge);
    assert.ok(viaTunnel <= viaBoost * 1.1, `tunnel ${viaTunnel.toFixed(1)} vs boost ${viaBoost.toFixed(1)}`);
});

test('rift sprint stays the short race', () => {
    assert.ok(ringsOf(sprint).length < ringsOf(rift).length / 1.5);
    assert.ok(rulesOf(sprint).maxSegmentTimeMs < rulesOf(rift).maxSegmentTimeMs);
});
