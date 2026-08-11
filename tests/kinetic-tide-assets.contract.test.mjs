import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isBeatAlignedClipDuration } from '../src/shared/contracts/MapAnimationClockContract.js';

const ASSET_ROOT = path.resolve('assets/maps/kinetic_tide');
const BEAT_SECONDS = 4;

// Loop length in beats and the clip name the map clock addresses. Everything is a whole
// multiple of the beat, which is what lets a player read one rhythm across the whole map.
const EXPECTED_SETPIECES = Object.freeze({
    '01_breath_gate': { beats: 1, clipName: 'BreathGateLoop' },
    '02_piston_tunnel': { beats: 1, clipName: 'PistonTunnelLoop' },
    '03_iris_shutter': { beats: 2, clipName: 'IrisShutterLoop' },
    '04_carousel_ring': { beats: 2, clipName: 'CarouselRingLoop' },
    '05_pendulum_field': { beats: 1, clipName: 'PendulumFieldLoop' },
    '06_lift_rings': { beats: 4, clipName: 'LiftRingsLoop' },
    '07_tide_wall': { beats: 4, clipName: 'TideWallLoop' },
    '08_reactor_heart': { beats: 2, clipName: 'ReactorHeartLoop' },
});

// A moving mesh rebuilds nothing per frame, but every collision query walks its triangles.
// Coarse collision bodies are the whole reason the decorative parts carry _nocol.
const MAX_TRIANGLES_PER_COLLIDING_MESH = 600;

function readGlbJson(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${filePath} has a GLB header`);
    assert.equal(bytes.readUInt32LE(4), 2, `${filePath} uses glTF 2`);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filePath} starts with a JSON chunk`);
    return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
}

function animationDurationSeconds(document, animation) {
    return Math.max(...animation.samplers.map((sampler) => (
        Number(document.accessors?.[sampler.input]?.max?.[0]) || 0
    )));
}

// Mirrors the runtime rule: a keyframed transform moves every mesh in its subtree, so a
// rig empty makes the meshes parented below it collidable.
function collidingMeshNodes(document) {
    const nodes = document.nodes || [];
    const collected = [];
    const collectSubtree = (index) => {
        const node = nodes[index];
        if (!node) return;
        if (node.mesh !== undefined && !/_nocol/i.test(String(node.name || ''))) {
            collected.push(node);
        }
        for (const child of node.children || []) collectSubtree(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (!['translation', 'rotation', 'scale'].includes(channel.target?.path)) continue;
            collectSubtree(channel.target.node);
        }
    }
    return collected;
}

function triangleCount(document, meshIndex) {
    const mesh = document.meshes?.[meshIndex];
    let triangles = 0;
    for (const primitive of mesh?.primitives || []) {
        const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
        const count = Number(document.accessors?.[accessorIndex]?.count) || 0;
        triangles += Math.floor(count / 3);
    }
    return triangles;
}

test('every Kinetic Tide setpiece keeps an editable source and a non-empty export', () => {
    for (const name of Object.keys(EXPECTED_SETPIECES)) {
        assert.ok(
            statSync(path.join(ASSET_ROOT, 'blender', `${name}.blend`)).size > 100_000,
            `${name} keeps an editable Blender source`,
        );
        assert.ok(
            statSync(path.join(ASSET_ROOT, 'glb', `${name}.glb`)).size > 10_000,
            `${name} exports a non-empty GLB`,
        );
    }
});

test('every setpiece loops on a whole multiple of the map beat under its authored name', () => {
    for (const [name, expected] of Object.entries(EXPECTED_SETPIECES)) {
        const document = readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`));

        assert.equal(document.animations?.length, 1, `${name} exports exactly one clip`);
        const animation = document.animations[0];
        assert.equal(animation.name, expected.clipName, `${name} keeps the clip name the map addresses`);
        assert.ok(animation.channels.length > 0, `${name} clip animates scene nodes`);

        const duration = animationDurationSeconds(document, animation);
        assert.ok(
            isBeatAlignedClipDuration(duration, { beatSeconds: BEAT_SECONDS }),
            `${name} loops on the beat (measured ${duration}s)`,
        );
        assert.equal(
            Math.round(duration / BEAT_SECONDS),
            expected.beats,
            `${name} keeps its authored loop length`,
        );
    }
});

test('moving parts stay coarse enough to collide against every frame', () => {
    for (const name of Object.keys(EXPECTED_SETPIECES)) {
        const document = readGlbJson(path.join(ASSET_ROOT, 'glb', `${name}.glb`));
        const colliding = collidingMeshNodes(document);

        assert.ok(colliding.length > 0, `${name} moves at least one mesh that can carry a collider`);
        for (const node of colliding) {
            const triangles = triangleCount(document, node.mesh);
            assert.ok(
                triangles <= MAX_TRIANGLES_PER_COLLIDING_MESH,
                `${name}: ${node.name} has ${triangles} triangles in the collision path`,
            );
        }
        // Skinned geometry deforms, so the runtime refuses it a collider entirely. A
        // setpiece that relied on one would silently stop blocking anything.
        assert.equal(document.skins ?? undefined, undefined, `${name} avoids skinned meshes`);
    }
});
