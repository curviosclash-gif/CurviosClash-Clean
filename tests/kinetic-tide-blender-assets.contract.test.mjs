import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ASSET_ROOT = path.resolve('assets/maps/kinetic_tide');
const TOTAL_GLB_BUDGET_BYTES = 2 * 1024 * 1024;
const TRIANGLE_BUDGET_PER_SETPIECE = 6000;
const SETPIECES = Object.freeze({
    '01_breath_gate': { clip: 'BreathGateLoop', duration: 4, landmark: 'gate_header_signal' },
    '02_piston_tunnel': { clip: 'PistonTunnelLoop', duration: 4, landmark: 'tunnel_pulse_marker_0' },
    '03_iris_shutter': { clip: 'IrisShutterLoop', duration: 8, landmark: 'iris_aperture_signal' },
    '04_carousel_ring': { clip: 'CarouselRingLoop', duration: 8, landmark: 'carousel_gap_beacon_0_nocol' },
    '05_pendulum_field': { clip: 'PendulumFieldLoop', duration: 4, landmark: 'pendulum_phase_lamp_0' },
    '06_lift_rings': { clip: 'LiftRingsLoop', duration: 16, landmark: 'lift_column_step_0' },
    '07_tide_wall': { clip: 'TideWallLoop', duration: 16, landmark: 'tide_arch_meter_0' },
    '08_reactor_heart': { clip: 'ReactorHeartLoop', duration: 8, landmark: 'reactor_crown_pylon_0' },
});

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with JSON`);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDurationSeconds(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

function animatedMeshNames(document) {
    const nodes = document.nodes || [];
    const names = new Set();
    const collect = (index) => {
        const node = nodes[index];
        if (!node) return;
        if (node.mesh !== undefined) names.add(String(node.name || ''));
        for (const child of node.children || []) collect(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (['translation', 'rotation', 'scale'].includes(channel.target?.path)) {
                collect(channel.target.node);
            }
        }
    }
    return [...names];
}

function triangleCount(document) {
    let count = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
            const accessorCount = Number(document.accessors?.[accessorIndex]?.count) || 0;
            count += accessorCount / 3;
        }
    }
    return count;
}

test('Kinetic Tide keeps editable Blender sources and loader-compatible beat loops', () => {
    let totalGlbBytes = 0;

    for (const [name, expected] of Object.entries(SETPIECES)) {
        const blendPath = path.join(ASSET_ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ASSET_ROOT, 'glb', `${name}.glb`);
        assert.ok(statSync(blendPath).size > 100_000, `${name} keeps its editable Blender source`);
        const glbSize = statSync(glbPath).size;
        assert.ok(glbSize > 10_000, `${name} exports a non-empty GLB`);
        totalGlbBytes += glbSize;

        const document = readGlbJson(glbPath);
        assert.equal(document.animations?.length, 1, `${name} exports exactly one animation`);
        assert.equal(document.animations[0].name, expected.clip, `${name} keeps its runtime clip name`);
        assert.ok(
            Math.abs(animationDurationSeconds(document, document.animations[0]) - expected.duration) <= (1 / 30),
            `${name} keeps its ${expected.duration}s beat-aligned duration`,
        );
        assert.ok(
            (document.nodes || []).some((node) => node.name === expected.landmark),
            `${name} contains its readability landmark ${expected.landmark}`,
        );

        const animated = animatedMeshNames(document);
        assert.ok(
            animated.some((nodeName) => !/_nocol$/i.test(nodeName)),
            `${name} retains a coarse animated collision mesh`,
        );
        assert.ok(
            animated.some((nodeName) => /_nocol$/i.test(nodeName)),
            `${name} separates animated visual detail from collision`,
        );
        assert.ok(
            triangleCount(document) <= TRIANGLE_BUDGET_PER_SETPIECE,
            `${name} stays within the ${TRIANGLE_BUDGET_PER_SETPIECE} triangle budget`,
        );
    }

    assert.ok(
        totalGlbBytes <= TOTAL_GLB_BUDGET_BYTES,
        `Kinetic Tide GLBs stay within ${TOTAL_GLB_BUDGET_BYTES} bytes (got ${totalGlbBytes})`,
    );
});
