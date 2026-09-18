import assert from 'node:assert/strict';
import test from 'node:test';

import { Arena } from '../src/entities/Arena.js';
import { resolveGLBMapSourceFootprint } from '../src/entities/GLBMapLoader.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

/**
 * Stands in for the renderer: the arena builder only ever hands geometry over, asks for the
 * graphics style and pushes the map lighting. None of that has to draw anything for the build
 * context to come out, so a handful of empty methods is enough to run the real builder in Node.
 */
function createRendererStub() {
    return {
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle() { return 'modern'; },
        setMapLighting() {},
    };
}

/**
 * Runs the real arena builder for one preset. The map is handed over as a runtime map, the same
 * way an authored map reaches the builder, because the bare entity runtime config only carries
 * the base presets - a preset from its own file would silently fall back to 'standard'.
 */
function buildRuntimeContext(mapKey) {
    const arena = new Arena(createRendererStub());
    arena.runtimeMapKey = mapKey;
    arena.runtimeMapDefinition = MAP_PRESET_CATALOG[mapKey];
    const context = arena._builder.build(mapKey);
    assert.equal(context.map, MAP_PRESET_CATALOG[mapKey], `the builder used the ${mapKey} preset`);
    return context;
}

/**
 * Both sides of a GLB map name their collision mode: the menu preview and the loading overlay
 * read it through resolveGLBMapSourceFootprint, the running match carries it in the arena build
 * context. A map that states no mode leaves the name to a default - and a default that differs
 * between the two makes preview and match report different words for the very same collision.
 */
test('a GLB map without an authored collider mode reports the same mode in preview and match', () => {
    const mapKey = 'glb_hangar';
    const mapDefinition = MAP_PRESET_CATALOG[mapKey];

    // The premise of this test: this map states no mode, so only the defaults answer.
    assert.equal(
        mapDefinition.glbColliderMode,
        undefined,
        'glb_hangar must stay a map without an authored collider mode',
    );

    const previewMode = resolveGLBMapSourceFootprint(mapDefinition).colliderMode;
    const runtimeMode = buildRuntimeContext(mapKey).glbColliderMode;

    assert.equal(
        runtimeMode,
        previewMode,
        'the match names the collision mode differently from the menu preview',
    );
});

test('the shared default is the scene collider both sides already present', () => {
    // 'Szenen-Collider' is what the loading overlay prints for every mode that is not
    // fallbackOnly or dynamic, and every preset that spells its mode out for exact GLB
    // collision writes 'scene'. So that is the name the unnamed default has to carry too.
    assert.equal(resolveGLBMapSourceFootprint(MAP_PRESET_CATALOG.glb_hangar).colliderMode, 'scene');
    assert.equal(buildRuntimeContext('glb_hangar').glbColliderMode, 'scene');
});

test('an authored collider mode still wins over the default on both sides', () => {
    // Counter-proof for the two special modes and for the explicit 'mesh' maps: unifying the
    // default must not start overwriting what a map actually states.
    for (const [mapKey, expected] of [
        ['eiffel_tower', 'scene'],
        ['glb_gallery', 'mesh'],
        ['parcours_rift', 'fallbackOnly'],
        ['kinetic_tide', 'dynamic'],
    ]) {
        const mapDefinition = MAP_PRESET_CATALOG[mapKey];
        assert.equal(mapDefinition.glbColliderMode, expected, `${mapKey} authors its collider mode`);
        assert.equal(
            resolveGLBMapSourceFootprint(mapDefinition).colliderMode,
            expected,
            `the preview of ${mapKey} keeps the authored collider mode`,
        );
        assert.equal(
            buildRuntimeContext(mapKey).glbColliderMode,
            expected,
            `the match on ${mapKey} keeps the authored collider mode`,
        );
    }
});
