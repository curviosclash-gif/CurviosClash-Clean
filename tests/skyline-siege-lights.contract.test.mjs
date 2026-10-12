import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapLightSources } from '../src/shared/contracts/MapLightSourcesContract.js';
import { MAP_SCALE, placeMapGlbModel, worldMeshBounds } from './helpers/placed-glb-model.mjs';

// Lights are authored in the same space as spawns and anchors, and AuthoredMapLightRig multiplies
// position AND range by MAP_SCALE for maps with scaleAuthoredAnchors. The Skyline beacons were
// written in world units, so after the multiplication they hung far outside the 180x100x180 map.
const BEACON_TOWER = Object.freeze({
    skyline_spire_beacon: 'skyline-spire-intact',
    skyline_crown_beacon: 'skyline-crown-intact',
    skyline_arcology_beacon: 'skyline-arcology-intact',
});

test('every Skyline Siege beacon lies inside the map and reaches the top of its tower', async () => {
    const map = MAP_PRESET_CATALOG.skyline_siege;
    assert.equal(map.scaleAuthoredAnchors, true);
    const scale = MAP_SCALE;
    const half = map.size.map((n) => (n * scale) / 2);
    const lights = normalizeMapLightSources(map.lights);
    assert.equal(lights.length, Object.keys(BEACON_TOWER).length);
    for (const light of lights) {
        const towerId = BEACON_TOWER[light.id];
        assert.ok(towerId, `${light.id} is mapped to a tower`);
        const world = new THREE.Vector3(light.x, light.y, light.z).multiplyScalar(scale);
        assert.ok(
            Math.abs(world.x) <= half[0] && Math.abs(world.z) <= half[2] && world.y >= 0 && world.y <= map.size[1] * scale,
            `${light.id} at (${world.toArray().map((n) => n.toFixed(0)).join(',')}) is outside the map`,
        );
        const tower = await placeMapGlbModel(map, towerId);
        const bounds = worldMeshBounds(tower.scene);
        const top = new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, bounds.max.y, (bounds.min.z + bounds.max.z) / 2);
        const reach = light.distance * scale;
        assert.ok(
            world.distanceTo(top) <= reach,
            `${light.id} is ${world.distanceTo(top).toFixed(0)} from the top of ${towerId} but reaches only ${reach.toFixed(0)}`,
        );
    }
});
