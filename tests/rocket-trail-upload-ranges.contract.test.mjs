import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';

import { RocketTrailSystem } from '../src/entities/systems/projectile/RocketTrailSystem.js';

function createAttributeHarness(isWebGL2) {
    const calls = [];
    const gl = {
        ARRAY_BUFFER: 0x8892,
        FLOAT: 0x1406,
        createBuffer: () => ({}),
        bindBuffer() {},
        bufferData(target, source) {
            calls.push({ method: 'bufferData', byteLength: source.byteLength, destinationByteOffset: 0 });
        },
        bufferSubData(target, destinationByteOffset, source, sourceOffset, sourceCount) {
            const hasSourceRange = arguments.length === 5;
            const elementCount = hasSourceRange ? sourceCount : source.length;
            calls.push({
                method: 'bufferSubData',
                byteLength: elementCount * source.BYTES_PER_ELEMENT,
                destinationByteOffset,
            });
        },
        deleteBuffer() {},
    };
    const attributes = WebGLAttributes(gl, { isWebGL2 });
    return {
        calls,
        upload(attribute) {
            attributes.update(attribute, gl.ARRAY_BUFFER);
        },
    };
}

function appendSegment(system, handle, index) {
    return system.appendSegment(
        handle,
        new THREE.Vector3(index * 2, 0, 0),
        new THREE.Vector3(index * 2 + 1, 0, 0)
    );
}

function uploadColors(harness, system) {
    const start = harness.calls.length;
    harness.upload(system.mesh.instanceColor);
    harness.upload(system.glowMesh.instanceColor);
    return harness.calls.slice(start);
}

function totalBytes(calls) {
    return calls.reduce((sum, call) => sum + call.byteLength, 0);
}

for (const isWebGL2 of [false, true]) {
    const api = isWebGL2 ? 'WebGL2' : 'WebGL1';

    test(`rocket trail color uploads stay bounded in ${api}`, () => {
        const system = new RocketTrailSystem();
        const handle = system.createTrailHandle({ index: 0 });
        const harness = createAttributeHarness(isWebGL2);

        const initialCalls = uploadColors(harness, system);
        assert.equal(totalBytes(initialCalls), 240_000);
        assert.deepEqual(system.mesh.instanceColor.updateRanges, []);
        assert.deepEqual(system.glowMesh.instanceColor.updateRanges, []);

        appendSegment(system, handle, 0);
        assert.deepEqual(system.mesh.instanceColor.updateRanges, [{ start: 0, count: 3 }]);
        const singleSlotCalls = uploadColors(harness, system);
        assert.equal(totalBytes(singleSlotCalls), 24);
        assert.deepEqual(singleSlotCalls.map((call) => call.destinationByteOffset), [0, 0]);

        appendSegment(system, handle, 1);
        appendSegment(system, handle, 2);
        assert.deepEqual(system.mesh.instanceColor.updateRanges, [{ start: 3, count: 6 }]);
        const contiguousCalls = uploadColors(harness, system);
        assert.equal(totalBytes(contiguousCalls), 48);
        assert.deepEqual(contiguousCalls.map((call) => call.destinationByteOffset), [12, 12]);

        appendSegment(system, handle, 3);
        system.clear();
        assert.deepEqual(system.mesh.instanceColor.updateRanges, []);
        assert.deepEqual(system.glowMesh.instanceColor.updateRanges, []);
        system.dispose();
    });
}
