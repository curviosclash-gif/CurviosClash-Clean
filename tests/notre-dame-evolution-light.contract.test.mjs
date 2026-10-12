import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/index.js';
import { NOTRE_DAME_EVOLUTION_MAPS } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import { AuthoredMapLightRig } from '../src/entities/arena/AuthoredMapLightRig.js';
import { MapFireFxController } from '../src/entities/arena/MapFireFxController.js';
import { MAP_LIGHT_SOURCE_LIMIT } from '../src/shared/contracts/MapLightSourcesContract.js';

const MAP_SCALE = 3;
const renderer = { addToScene() {}, removeFromScene() {} };

function build(key) {
    const map = NOTRE_DAME_EVOLUTION_MAPS[key];
    const lights = new AuthoredMapLightRig(renderer).build(map, MAP_SCALE);
    const controller = new MapFireFxController(renderer);
    controller.build(map, MAP_SCALE, lights);
    return { map, lights, controller };
}

const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

for (const [key, intactKey] of [['notre_dame', 'notre_dame'], ['notre_dame_arena', 'notre_dame_arena']]) {
    test(`${key}: bei t=0 sind die Innenlampen der intakten Kirche aktiv`, () => {
        const { map, lights, controller } = build(key);
        const intactLamps = NOTRE_DAME_MAPS[intactKey].lights;
        controller.setIntensity(0);
        controller.update(37.5);
        for (const lamp of intactLamps) {
            const match = lights.find((light) =>
                near(light.position.x, lamp.x * MAP_SCALE)
                && near(light.position.y, lamp.y * MAP_SCALE)
                && near(light.position.z, lamp.z * MAP_SCALE)
                && near(light.intensity, lamp.intensity)
                && near(light.distance, lamp.distance * MAP_SCALE)
                && light.color.getHex() === lamp.color);
            assert.ok(match, `${lamp.id} brennt bei Brandfortschritt 0 unverändert`);
        }
        assert.ok(map.lights.length <= MAP_LIGHT_SOURCE_LIMIT);
        assert.equal(lights.length, map.lights.length, 'nicht mehr Lichter als die Evolution heute stellt');
        const lit = lights.filter((light) => light.intensity > 0).length;
        assert.equal(lit, intactLamps.length, 'bei t=0 leuchten genau die sechs Innenlampen');
    });

    test(`${key}: bei vollem Brand gilt das kalibrierte Brandlicht`, () => {
        const { map, lights, controller } = build(key);
        controller.setIntensity(1);
        controller.update(0);
        for (const source of map.lights) {
            const light = lights.find((entry) => entry.userData.authoredLightId === source.id);
            assert.ok(light, source.id);
            assert.ok(near(light.position.x, source.x * MAP_SCALE) && near(light.position.y, source.y * MAP_SCALE));
            assert.ok(near(light.distance, source.distance * MAP_SCALE));
            assert.equal(light.color.getHex(), source.color);
            assert.ok(Math.abs(light.intensity - source.intensity) <= source.intensity * 0.25 + 1e-6, source.id);
        }
    });

    test(`${key}: der Übergang ist stetig und der Abbau stellt die Brandwerte wieder her`, () => {
        const { map, lights, controller } = build(key);
        controller.setIntensity(0);
        const dayWest = lights.find((l) => l.userData.authoredLightId === 'ndf_attic_west');
        const dayX = dayWest.position.x;
        controller.setIntensity(0.5);
        const midX = dayWest.position.x;
        controller.setIntensity(1);
        const fireX = dayWest.position.x;
        assert.ok(dayX < midX && midX < fireX);
        controller.setIntensity(0);
        controller.clear();
        const source = map.lights.find((entry) => entry.id === 'ndf_attic_west');
        assert.ok(near(dayWest.position.x, source.x * MAP_SCALE));
        assert.ok(near(dayWest.intensity, source.intensity));
    });
}
