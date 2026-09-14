import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    DEFAULT_MAP_LIGHTING,
    normalizeMapLighting,
    resolveMapLighting,
} from '../src/shared/contracts/MapLightingContract.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';
import { ArenaBuilder } from '../src/entities/arena/ArenaBuilder.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';

test('Falkenwacht spreads its high-altitude closure across at least 80 world units', () => {
    for (const key of ['burg_falkenwacht', 'burg_falkenwacht_arena']) {
        const fog = MAP_PRESET_CATALOG[key].lighting.fog;
        const closureWidth = fog.far * (1 - fog.clipClosureStart);
        assert.ok(closureWidth >= 80, key);
        // Even without natural mist, a one-unit step must not add over 2% opacity.
        assert.ok(1.5 / closureWidth < 0.02, key);
        assert.ok(fog.heightFalloff <= 0.06, key);
    }
});

test('default map lighting matches the existing modern renderer look', () => {
    assert.deepEqual(DEFAULT_MAP_LIGHTING.key.direction, [30, 50, 30]);
    assert.equal(DEFAULT_MAP_LIGHTING.key.color, 0xfff4e8);
    assert.equal(DEFAULT_MAP_LIGHTING.hemisphere.skyColor, 0x9bc8ff);
    assert.deepEqual(DEFAULT_MAP_LIGHTING.fog, {
        color: 0x0b1020,
        near: 55,
        far: 190,
        height: 18,
        heightFalloff: 0.014,
        turbulence: 0.12,
        skyBlend: 1,
        colorHigh: 0x0b1020,
        colorLow: 0x0b1020,
        clipClosureStart: 0.8,
    });
    assert.equal(DEFAULT_MAP_LIGHTING.starsVisible, true);
    assert.equal(DEFAULT_MAP_LIGHTING.exposureOffset, 0);
    assert.ok(Object.isFrozen(DEFAULT_MAP_LIGHTING));
    assert.ok(Object.isFrozen(DEFAULT_MAP_LIGHTING.key.direction));
});

test('map lighting normalization rejects invalid values and hard-clamps hostile numbers', () => {
    const normalized = normalizeMapLighting({
        key: { direction: [Number.POSITIVE_INFINITY, -1e9, 4], color: 1e9, intensity: 1e9 },
        fill: { direction: [0, 0, 0], color: '#00ffaa', intensity: -25 },
        rim: { direction: 'below', color: 'not-a-color', intensity: Number.NaN },
        hemisphere: { skyColor: -1, groundColor: 0x123456 },
        fog: {
            color: '#abcdef', near: -100, far: 1e9,
            height: -50, heightFalloff: 9, turbulence: 7, skyBlend: 4,
            colorHigh: 'not-a-colour', colorLow: '#102030', clipClosureStart: 12,
        },
        skyDome: { zenithColor: null, horizonColor: 0x334455, nadirColor: 12.8 },
        starsVisible: 'yes',
        exposureOffset: 50,
    });

    assert.deepEqual(normalized.key.direction, [30, -100, 4]);
    assert.equal(normalized.key.color, 0xffffff);
    assert.equal(normalized.key.intensity, 4);
    assert.deepEqual(normalized.fill.direction, DEFAULT_MAP_LIGHTING.fill.direction);
    assert.equal(normalized.fill.color, 0x00ffaa);
    assert.equal(normalized.fill.intensity, 0);
    assert.deepEqual(normalized.rim, DEFAULT_MAP_LIGHTING.rim);
    assert.equal(normalized.hemisphere.skyColor, 0);
    assert.equal(normalized.hemisphere.groundColor, 0x123456);
    // A hostile height falloff would make the fog vanish one metre above the base, and a turbulence
    // above 1 would drive the density negative and brighten surfaces instead of dimming them.
    assert.deepEqual(normalized.fog, {
        color: 0xabcdef,
        near: 0,
        far: 600,
        height: 0,
        heightFalloff: 0.5,
        turbulence: 1,
        skyBlend: 1,
        colorHigh: DEFAULT_MAP_LIGHTING.fog.colorHigh,
        colorLow: 0x102030,
        clipClosureStart: 0.95,
    });
    assert.equal(normalized.skyDome.zenithColor, DEFAULT_MAP_LIGHTING.skyDome.zenithColor);
    assert.equal(normalized.skyDome.horizonColor, 0x334455);
    assert.equal(normalized.skyDome.nadirColor, 13);
    assert.equal(normalized.starsVisible, true);
    assert.equal(normalized.exposureOffset, 0.5);
});

test('map lighting resolver fills partial profiles from the supplied renderer base', () => {
    const classicBase = {
        ...DEFAULT_MAP_LIGHTING,
        key: { ...DEFAULT_MAP_LIGHTING.key, color: 0xffffff, intensity: 0.8 },
        fog: { color: 0x080812, near: 50, far: 200 },
        starsVisible: false,
    };
    const resolved = resolveMapLighting({
        key: { color: 0xff0000 },
        fog: { near: 300, far: 20 },
        starsVisible: true,
        exposureOffset: -5,
    }, classicBase);

    assert.equal(resolved.key.color, 0xff0000);
    assert.equal(resolved.key.intensity, 0.8);
    assert.deepEqual(resolved.key.direction, DEFAULT_MAP_LIGHTING.key.direction);
    // The classic base states no height or structure, so those fall through to the defaults.
    assert.deepEqual(resolved.fog, {
        color: 0x080812,
        near: 20,
        far: 20,
        height: DEFAULT_MAP_LIGHTING.fog.height,
        heightFalloff: DEFAULT_MAP_LIGHTING.fog.heightFalloff,
        turbulence: DEFAULT_MAP_LIGHTING.fog.turbulence,
        skyBlend: DEFAULT_MAP_LIGHTING.fog.skyBlend,
        colorHigh: DEFAULT_MAP_LIGHTING.fog.colorHigh,
        colorLow: DEFAULT_MAP_LIGHTING.fog.colorLow,
        clipClosureStart: DEFAULT_MAP_LIGHTING.fog.clipClosureStart,
    });
    assert.equal(resolved.starsVisible, true);
    assert.equal(resolved.exposureOffset, -0.5);
    assert.deepEqual(resolveMapLighting(null), normalizeMapLighting(undefined));
    assert.deepEqual(normalizeMapLighting({}, 'invalid-fallback'), DEFAULT_MAP_LIGHTING);
});

test('only the selected presets define lighting and all others resolve to default', () => {
    const litMapKeys = Object.entries(MAP_PRESET_CATALOG)
        .filter(([, map]) => map?.lighting)
        .map(([mapKey]) => mapKey)
        .sort();
    assert.deepEqual(litMapKeys, [
        'burg_falkenwacht',
        'burg_falkenwacht_arena',
        'complex',
        'eiffel_tower',
        'eiffel_tower_arena',
        'eiffel_tower_siege',
        'frozen_helix',
        'magma_maze',
        'maze',
        'neon_abyss',
        'notre_dame',
        'notre_dame_arena',
        'notre_dame_fire',
        'notre_dame_fire_arena',
        'pyramid',
        'reactor_site',
        'standard',
        'trench',
        'vertical_maze',
        'wind_cathedral',
    ]);
    assert.deepEqual(resolveMapLighting(MAP_PRESET_CATALOG.empty?.lighting), DEFAULT_MAP_LIGHTING);
    for (const mapKey of litMapKeys) {
        assert.deepEqual(normalizeMapLighting(MAP_PRESET_CATALOG[mapKey].lighting), MAP_PRESET_CATALOG[mapKey].lighting);
    }
});

test('scene lighting rig applies map profile before brightness and explicit view distance', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 1, 2);
    const renderer = { toneMappingExposure: 0 };
    const config = {
        COLORS: { BACKGROUND: 0x080812, AMBIENT_LIGHT: 0x334466 },
        CAMERA: { FAR: 200 },
        RENDER: { SHADOW_MAP_SIZE: 256 },
    };
    const rig = new SceneLightingRig({ scene, renderer, config });
    const lighting = rig.apply({
        graphicsStyle: 'modern',
        mapLighting: {
            key: { direction: [1, 2, 3], color: 0xff0000, intensity: 2 },
            fog: { color: 0x123456, near: 20, far: 100 },
            starsVisible: false,
            exposureOffset: 0.2,
        },
        brightnessFactors: { exposure: 0.5, ambient: 0.25, fog: 0.5 },
        viewDistance: 0,
    });

    // The profile owns the direction the key light comes from. Its distance belongs to the shadow
    // coverage instead, so the position is that direction pushed out far enough to see the map.
    const keyDirection = rig.keyLight.position.clone()
        .sub(new THREE.Vector3(...rig.getShadowCoverage().center))
        .normalize();
    assert.ok(keyDirection.distanceTo(new THREE.Vector3(1, 2, 3).normalize()) < 0.0001);
    assert.equal(rig.keyLight.color.getHex(), 0xff0000);
    assert.equal(rig.keyLight.intensity, 2);
    assert.equal(renderer.toneMappingExposure, 0.625);
    assert.equal(rig.ambientLight.intensity, 0.145);
    // The profile states no sky, so the default horizon stands - and with the default skyBlend of 1
    // that horizon, not the authored 0x123456, is what the distance fades into.
    assert.equal(scene.fog.color.getHex(), DEFAULT_MAP_LIGHTING.skyDome.horizonColor);
    assert.equal(scene.fog.near, 10);
    assert.equal(scene.fog.far, 50);
    assert.equal(rig.starField.visible, false);
    assert.equal(lighting.exposureOffset, 0.2);

    rig.apply({
        graphicsStyle: 'modern',
        mapLighting: { fog: { near: 20, far: 100 } },
        brightnessFactors: { exposure: 1, ambient: 1, fog: 0.5 },
        viewDistance: 80,
    });
    assert.equal(scene.fog.near, 16);
    assert.equal(scene.fog.far, 80);

    rig.apply({
        graphicsStyle: 'classic',
        mapLighting: undefined,
        brightnessFactors: { exposure: 1, ambient: 1, fog: 1 },
        viewDistance: 0,
    });
    assert.equal(rig.keyLight.color.getHex(), 0xffffff);
    assert.equal(rig.keyLight.intensity, 0.8);
    assert.equal(rig.fillLight.intensity, 0.3);
    assert.equal(rig.ambientLight.intensity, 0.8);
    // Same rule in the classic style: the horizon of its own sky is the distant colour, not the
    // background hex the fog used to carry.
    assert.equal(scene.fog.color.getHex(), 0x17355a);
    assert.equal(scene.fog.near, 50);
    assert.equal(scene.fog.far, 200);
    assert.equal(scene.background, null);
    assert.equal(rig.rimLight.visible, false);
    // Classic keeps a visible dome so its authored gradient can meet the fog without a cleared
    // background seam - see atmosphere-horizon-seam.contract.test.mjs.
    assert.equal(rig.skyDome.visible, true);
    assert.equal(rig.starField.visible, false);
    rig.dispose();
    assert.equal(scene.children.length, 0);
});

test('scene lighting atmosphere follows every active camera without frustum culling', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, 1, 2);
    const rig = new SceneLightingRig({
        scene,
        renderer: { toneMappingExposure: 0 },
        config: {
            COLORS: { BACKGROUND: 0x080812, AMBIENT_LIGHT: 0x334466 },
            CAMERA: { FAR: 200 },
            RENDER: { SHADOW_MAP_SIZE: 256 },
        },
    });
    const cameras = [
        new THREE.PerspectiveCamera(60, 1, 0.1, 200),
        new THREE.PerspectiveCamera(60, 1, 0.1, 200),
    ];
    cameras[0].position.set(-420, 24, 180);
    cameras[1].position.set(610, 48, -360);

    for (const camera of cameras) {
        camera.updateMatrixWorld();
        rig.skyDome.onBeforeRender(null, scene, camera);
        rig.starField.onBeforeRender(null, scene, camera);
        assert.deepEqual(rig.skyDome.position.toArray(), camera.position.toArray());
        assert.deepEqual(rig.starField.position.toArray(), camera.position.toArray());
    }
    assert.equal(rig.skyDome.frustumCulled, false);
    assert.equal(rig.starField.frustumCulled, false);
    rig.dispose();
});

test('ArenaBuilder resets map lighting when switching to a map without a profile', () => {
    const lighting = { key: { intensity: 2 } };
    const calls = [];
    const maps = {
        standard: { name: 'Standard', size: [80, 30, 80], obstacles: [] },
        lit: { name: 'Lit', size: [80, 30, 80], obstacles: [], lighting },
        plain: { name: 'Plain', size: [80, 30, 80], obstacles: [] },
    };
    const arena = {
        entityRuntimeConfig: { ...DEFAULT_ENTITY_RUNTIME_CONFIG, MAPS: maps },
        renderer: {
            getGraphicsStyle: () => 'modern',
            getMaxAnisotropy: () => 1,
            setMapLighting: (profile) => calls.push(profile),
        },
        portalsEnabled: true,
    };
    const builder = new ArenaBuilder(arena);
    builder.geometryPipeline.beginBuildStage = () => {};
    builder.geometryPipeline.compileWallStage = () => {};
    builder._applyArenaBounds = () => {};
    builder._resolveMaterialBundle = () => ({});
    builder._assignArenaMaterials = () => {};
    builder._compileFloorStage = () => {};

    builder.build('lit');
    builder.build('plain');

    assert.equal(calls[0], lighting);
    assert.equal(calls[1], undefined);
});
