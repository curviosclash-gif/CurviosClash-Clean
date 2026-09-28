import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { installAtmosphericFog, uninstallAtmosphericFog } from '../src/core/renderer/AtmosphericFogShaderPatch.js';
import { Trail } from '../src/entities/Trail.js';
import { createPlayerHealthAura } from '../src/entities/player/PlayerHealthAura.js';
import { RocketTrailSystem } from '../src/entities/systems/projectile/RocketTrailSystem.js';
import { MGTracerFx } from '../src/hunt/mg/MGTracerFx.js';
import { GRAPHICS_STYLES } from '../src/shared/contracts/GraphicsStyleContract.js';

// An additive glow is added on top of whatever lies behind it. Fogged the usual way it is first
// pulled towards the fog colour and then *added*, so inside a dense sandstorm an enemy trail far
// beyond the view range still lights up as an orange streak. Glows that reveal a player therefore
// fade to nothing with the fog instead.

function isAdditiveFogFaded(material) {
    return material?.blending === THREE.AdditiveBlending && material.defines?.ATMOSPHERIC_FOG_ADDITIVE === 1;
}

test('the fog shader fades opted-in additive glows to black instead of to the fog colour', () => {
    installAtmosphericFog();
    try {
        const source = THREE.ShaderChunk.fog_fragment;
        assert.ok(source.includes('#ifdef ATMOSPHERIC_FOG_ADDITIVE'), 'additive fading is a material opt-in');
        assert.ok(source.includes('gl_FragColor.rgb *= 1.0 - clampedFogFactor;'),
            'a glow contributes nothing once the fog has closed');
    } finally {
        uninstallAtmosphericFog();
    }
});

test('every glow that can reveal a player fades out in fog', () => {
    const renderer = {
        getGraphicsStyle: () => GRAPHICS_STYLES.MODERN,
        addToScene() {},
        removeFromScene() {},
    };
    const trail = new Trail(renderer, 0x33aaff, 0, {
        entityRuntimeConfig: {
            TRAIL: { WIDTH: 0.6, MAX_SEGMENTS: 4, UPDATE_INTERVAL: 0.07, GAP_CHANCE: 0, GAP_DURATION: 0.5 },
            HUNT: { TRAIL_SEGMENT_HP: 3 },
        },
    });
    const aura = createPlayerHealthAura(1);
    const rockets = new RocketTrailSystem({ renderer });
    const tracers = new MGTracerFx({ renderer });
    const tracer = tracers._createTracerEntry();
    try {
        assert.ok(isAdditiveFogFaded(trail.glowMaterial), 'player trail glow');
        const auraMaterials = [];
        aura.root.traverse((node) => { if (node.material) auraMaterials.push(node.material); });
        assert.ok(auraMaterials.length > 0);
        for (const material of auraMaterials) assert.ok(isAdditiveFogFaded(material), 'health aura shell');
        assert.ok(isAdditiveFogFaded(rockets.glowMaterial), 'rocket trail glow');
        const tracerMaterials = new Set();
        tracer.mesh.traverse((node) => { if (node.material?.blending === THREE.AdditiveBlending) tracerMaterials.add(node.material); });
        assert.ok(tracerMaterials.size > 0);
        for (const material of tracerMaterials) assert.ok(isAdditiveFogFaded(material), 'machine gun flash');
    } finally {
        trail.dispose();
        rockets.dispose?.();
    }
});
