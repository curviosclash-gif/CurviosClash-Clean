import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { MAP_SCALE, placeMapGlbModel, worldMeshBounds } from './helpers/placed-glb-model.mjs';

// A segment's anchor is where bots aim at the building, where its break feedback plays and where
// the collapse blast lands. It has to sit inside the tower it stands for, measured in the world
// the loader actually builds (anchor times the map's anchor scale, tower through its placement).
test('every Skyline Siege anchor lies inside its intact tower', async () => {
    const map = MAP_PRESET_CATALOG.skyline_siege;
    const definition = normalizeMapDestructibles(map.destructibles);
    const anchorScale = map.scaleAuthoredAnchors === true ? MAP_SCALE : 1;
    for (const segment of definition.segments) {
        const scene = definition.breakScenes.find((entry) => entry.trigger.segmentId === segment.id);
        assert.ok(scene, `${segment.id} has a break scene`);
        const [intactId] = scene.hideModelIds;
        const tower = await placeMapGlbModel(map, intactId);
        const bounds = worldMeshBounds(tower.scene);
        const anchor = new THREE.Vector3(...segment.anchor).multiplyScalar(anchorScale);
        const box = [bounds.min, bounds.max].map((v) => v.toArray().map((n) => n.toFixed(1)).join(',')).join(' .. ');
        assert.ok(
            bounds.containsPoint(anchor),
            `${segment.id} anchor (${anchor.toArray().map((n) => n.toFixed(1)).join(',')}) outside ${intactId} ${box}`,
        );
    }
});
