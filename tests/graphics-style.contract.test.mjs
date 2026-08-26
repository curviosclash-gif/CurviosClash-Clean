import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import {
    GRAPHICS_STYLES,
    normalizeGraphicsStyle,
} from '../src/shared/contracts/GraphicsStyleContract.js';
import { createMenuSettingsDefaults } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/ui/SettingsChangeKeys.js';
import { resolveSyncMethodNamesForChangeKeys } from '../src/ui/UISettingsSyncMap.js';
import { bindGraphicsStyleSelect } from '../src/ui/menu/MenuGraphicsStyleBindings.js';
import { getArenaMaterialBundle } from '../src/entities/arena/ArenaBuildResourceCache.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { Trail } from '../src/entities/Trail.js';

test('graphics style defaults to modern and sanitizes persisted local settings', () => {
    const defaults = createMenuSettingsDefaults();
    assert.equal(defaults.localSettings.graphicsStyle, GRAPHICS_STYLES.MODERN);

    const classic = ensureMenuContractState({ localSettings: { graphicsStyle: 'classic' } });
    const invalid = ensureMenuContractState({ localSettings: { graphicsStyle: 'unknown' } });
    assert.equal(classic.localSettings.graphicsStyle, GRAPHICS_STYLES.CLASSIC);
    assert.equal(invalid.localSettings.graphicsStyle, GRAPHICS_STYLES.MODERN);
    assert.equal(normalizeGraphicsStyle('MODERN', GRAPHICS_STYLES.CLASSIC), GRAPHICS_STYLES.MODERN);
});

test('graphics style menu setting has a precise change key and gameplay UI sync', () => {
    const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(indexHtml, /id="graphics-style-select"/);
    assert.match(indexHtml, /value="classic">Alt \(Klassisch\)/);
    assert.match(indexHtml, /value="modern" selected>Neu/);
    assert.equal(SETTINGS_CHANGE_PATHS['localSettings.graphicsStyle'], SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_STYLE);
    assert.deepEqual(resolveSyncMethodNamesForChangeKeys([SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_STYLE]), ['syncGameplay']);
});

test('graphics style menu binding emits the runtime change key', () => {
    const settings = { localSettings: { graphicsStyle: GRAPHICS_STYLES.MODERN } };
    const ui = { graphicsStyleSelect: { value: GRAPHICS_STYLES.CLASSIC } };
    let onChange = null;
    let changedKeys = null;
    bindGraphicsStyleSelect({
        ui,
        settings,
        bind(_target, type, handler) {
            assert.equal(type, 'change');
            onChange = handler;
        },
        emitSettingsChangedImmediate(keys) { changedKeys = keys; },
        settingsChangeKeys: SETTINGS_CHANGE_KEYS,
    });

    onChange();
    assert.equal(settings.localSettings.graphicsStyle, GRAPHICS_STYLES.CLASSIC);
    assert.deepEqual(changedKeys, [SETTINGS_CHANGE_KEYS.LOCAL_GRAPHICS_STYLE]);
});

test('classic and modern arena materials keep their distinct art direction', () => {
    const shared = {
        checkerLightColor: 0xd9d9d9,
        checkerDarkColor: 0x5a5a5a,
        checkerWorldSize: 18,
        sx: 260,
        sy: 84,
        sz: 180,
    };
    const classic = getArenaMaterialBundle({ ...shared, graphicsStyle: GRAPHICS_STYLES.CLASSIC });
    const modern = getArenaMaterialBundle({ ...shared, graphicsStyle: GRAPHICS_STYLES.MODERN });

    assert.equal(classic.wallMat.opacity, 0.9);
    assert.equal(classic.wallMat.side, THREE.FrontSide);
    assert.equal(classic.floorMat.metalness, 0.05);
    assert.equal(classic.obstacleMat.emissive.getHex(), 0x000000);
    assert.equal(modern.wallMat.opacity, 0.84);
    assert.equal(modern.wallMat.side, THREE.FrontSide);
    assert.equal(modern.floorMat.metalness, 0.18);
    assert.equal(modern.obstacleMat.emissive.getHex(), 0x07182b);
});

test('classic particles and trails restore the original non-glow rendering', () => {
    const added = [];
    const renderer = {
        getGraphicsStyle: () => GRAPHICS_STYLES.CLASSIC,
        addToScene(object) { added.push(object); },
        removeFromScene() {},
    };
    const particles = new ParticleSystem(renderer);
    assert.equal(particles.mesh.geometry.type, 'BoxGeometry');
    assert.equal(particles.mesh.material.blending, THREE.NormalBlending);

    const trail = new Trail(renderer, 0x33aaff, 0, {
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 4, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
    });
    assert.equal(trail.material.emissiveIntensity, 0.48);
    assert.equal(trail.glowMesh, null);
    assert.equal(trail.glowHeadMesh, null);
    assert.equal(added.length, 5);

    trail.dispose();
    particles.dispose();
});
