import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';
import { getAtmosphericFogSettings } from '../src/core/renderer/AtmosphericFogShaderPatch.js';
import { TOYBOX_TITAN_MAP } from '../src/core/config/maps/presets/toybox_titan.js';
import {
    applyEditorGameLighting,
    createEditorGameViewConfig,
    resolveEditorArenaShadowBounds,
    resolveEditorGameFogRange,
} from '../editor/js/EditorGameView.js';

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);

function createRig(cameraFar = 10000) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x020617, 3000, 6000);
    const renderer = { toneMappingExposure: 1 };
    const rig = new SceneLightingRig({ scene, renderer, config: createEditorGameViewConfig(cameraFar) });
    return { scene, renderer, rig };
}

test('the game view fogs at the match distance, converted into editor units', () => {
    const { scene, rig } = createRig();
    const lighting = TOYBOX_TITAN_MAP.toybox_titan.lighting;
    const unitsPerWorldUnit = 35 / CONFIG_SECTIONS.ARENA.MAP_SCALE;

    applyEditorGameLighting(rig, scene, { mapLighting: lighting, unitsPerWorldUnit });

    near(scene.fog.near, lighting.fog.near * unitsPerWorldUnit, 'fog near');
    near(scene.fog.far, lighting.fog.far * unitsPerWorldUnit, 'fog far');
    // The height layer is authored in map units like the spawns: map unit times the export scale.
    near(getAtmosphericFogSettings().height, lighting.fog.height * CONFIG_SECTIONS.ARENA.MAP_SCALE * unitsPerWorldUnit, 'fog height');
    assert.equal(scene.fog.color.getHex(), new THREE.Color(lighting.fog.color).lerp(new THREE.Color(lighting.skyDome.horizonColor), lighting.fog.skyBlend).getHex());
});

test('fog beyond the lighting contract cap still reaches the editor, because the cap applies in match units', () => {
    const { scene, rig } = createRig();
    applyEditorGameLighting(rig, scene, { mapLighting: undefined, unitsPerWorldUnit: 12 });
    assert.ok(scene.fog.far > 1000, `fog far ${scene.fog.far} was capped in editor units`);
});

test('in flight the pilot sees the match distance, the overview camera sees the whole arena', () => {
    const gameFog = { near: 600, far: 2200 };
    assert.deepEqual(
        resolveEditorGameFogRange({ gameFog, flying: true, cameraDistance: 2800, arenaRadius: 1900 }),
        gameFog
    );
    const overview = resolveEditorGameFogRange({ gameFog, flying: false, cameraDistance: 2800, arenaRadius: 1900 });
    assert.equal(overview.far, 4700);
    near(overview.near / overview.far, 600 / 2200, 'fog keeps its shape');
    // Close to the arena the match distance already reaches past it and stays.
    assert.deepEqual(
        resolveEditorGameFogRange({ gameFog, flying: false, cameraDistance: 100, arenaRadius: 1000 }),
        gameFog
    );
});

test('the sky dome stays inside the editor camera and the shadow box covers the arena', () => {
    const { rig } = createRig(8000);
    assert.ok(rig.skyDome.geometry.parameters.radius < 8000);

    const bounds = resolveEditorArenaShadowBounds({ width: 2800, height: 950, depth: 2400 });
    assert.deepEqual(bounds, { minX: -1400, maxX: 1400, minY: 0, maxY: 950, minZ: -1200, maxZ: 1200 });
    assert.equal(rig.setShadowCoverage(bounds), true);
});
