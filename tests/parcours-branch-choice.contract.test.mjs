import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

// A fork is only a choice if the two ways differ: one is clearly shorter and pays for it with a
// tighter ring. Before 10/2026 these forks differed by 0-12 percent in length (mirror_docks: 0).
// Length = previous ring -> option ring -> first ring after the fork, in authored units.

const MIN_SAVING = 0.15;
const MAX_RADIUS_RATIO = 0.85;
const CHOICES = Object.freeze({
    mirror_docks: ['CP04_LEFT', 'CP04_RIGHT'],
    glass_serpent: ['CP07_TUBE', 'CP07_BALCONY'],
    storm_switchyard: ['CP05_LOW', 'CP05_HIGH'],
    chrono_spillway: ['CP08_SLUICE', 'CP08_OVERFLOW'],
    wind_cathedral: ['CP05', 'CP05_R'],
    sky_ladder_star: ['CP05_SPOKE', 'CP05_RIM'],
});

const distance = (a, b) => Math.hypot(...a.map((value, axis) => value - b[axis]));

function optionLength(mapKey, id) {
    const route = buildRouteFromParcours(MAP_PRESET_CATALOG[mapKey].parcours);
    const option = route.checkpoints.find((entry) => entry.id === id);
    const stageOf = (index) => route.checkpoints.find((entry) => entry.routeIndex === index) || route.finish;
    const previous = stageOf(option.routeIndex - 1);
    const next = stageOf(option.routeIndex + 1);
    return { length: distance(previous.pos, option.pos) + distance(option.pos, next.pos), radius: option.radius };
}

for (const [mapKey, [first, second]] of Object.entries(CHOICES)) {
    test(`${mapKey}: ${first} / ${second} is a real choice, the short way is the tight one`, () => {
        const options = [optionLength(mapKey, first), optionLength(mapKey, second)];
        const [short, long] = options[0].length <= options[1].length ? options : [options[1], options[0]];
        const saving = 1 - short.length / long.length;
        assert.ok(saving >= MIN_SAVING, `${mapKey} short way saves only ${(saving * 100).toFixed(1)} percent (${short.length.toFixed(1)} vs ${long.length.toFixed(1)})`);
        assert.ok(short.radius <= long.radius * MAX_RADIUS_RATIO, `${mapKey} short way ring ${short.radius} is not tighter than ${long.radius}`);
    });
}
