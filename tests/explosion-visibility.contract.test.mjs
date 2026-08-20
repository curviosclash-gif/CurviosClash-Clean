import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ParticleSystem } from '../src/entities/Particles.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

function createRendererStub({ graphicsStyle = 'modern' } = {}) {
    return {
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle: () => graphicsStyle,
    };
}

function createParticles() {
    return new ParticleSystem(createRendererStub(), { HUNT: HUNT_CONFIG });
}

function createCameraLookingAt(target) {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.position.set(target.x, target.y + 4, target.z - 20);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    return camera;
}

// Mirrors what WebGLRenderer.projectObject decides per frame: an object is drawn
// when culling is off, otherwise the frustum has to accept it.
function rendererWouldDraw(mesh, camera) {
    if (mesh.frustumCulled === false) return true;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    return frustum.intersectsObject(mesh);
}

test('a death explosion in front of the camera is drawn', () => {
    const particles = createParticles();
    const blast = particles.rocketBlastEffect;
    // Away from the origin on purpose: the empty hull left behind by the first frame
    // sits at (0, 0, 0), so a blast next to it would pass by accident.
    const at = new THREE.Vector3(180, 40, -240);
    const camera = createCameraLookingAt(at);

    // The first rendered frame happens before anything explodes. That frame is what
    // used to freeze an empty bounding hull onto the instanced meshes for good.
    rendererWouldDraw(particles.mesh, camera);
    rendererWouldDraw(blast.coreMesh, camera);
    rendererWouldDraw(blast.waveMesh, camera);

    particles.spawnExplosion(at, 0xff4444, { cause: 'PROJECTILE', projectileType: 'ROCKET_MEGA' });
    particles.update(0.016);

    assert.ok(particles.count > 0, 'debris exists');
    assert.equal(blast.coreMesh.count, 1, 'a blast core exists');
    assert.ok(rendererWouldDraw(particles.mesh, camera), 'the debris is drawn');
    assert.ok(rendererWouldDraw(blast.coreMesh, camera), 'the blast core is drawn');
    assert.ok(rendererWouldDraw(blast.waveMesh, camera), 'the shockwave is drawn');
    particles.dispose();
});

test('an explosion far from the first one is still drawn', () => {
    const particles = createParticles();
    const near = new THREE.Vector3(0, 0, 0);
    const far = new THREE.Vector3(300, 60, -420);

    const nearCamera = createCameraLookingAt(near);
    particles.spawnExplosion(near, 0xff4444, { cause: 'WALL' });
    particles.update(0.016);
    rendererWouldDraw(particles.mesh, nearCamera);
    rendererWouldDraw(particles.rocketBlastEffect.coreMesh, nearCamera);

    particles.clear();
    const farCamera = createCameraLookingAt(far);
    particles.spawnExplosion(far, 0xff4444, { cause: 'WALL' });
    particles.update(0.016);

    assert.ok(rendererWouldDraw(particles.mesh, farCamera), 'the second blast is not judged by the first one');
    assert.ok(rendererWouldDraw(particles.rocketBlastEffect.coreMesh, farCamera));
    particles.dispose();
});

test('a trail explosion without an explicit colour uses the configured colour', () => {
    const particles = createParticles();

    particles.spawnTrailExplosion([new THREE.Vector3(1, 2, 3), new THREE.Vector3(2, 2, 3)]);

    const events = particles.getRecentEvents(4).filter((entry) => entry.type === 'trail-explosion');
    assert.ok(events.length > 0, 'the burst was spawned');
    for (const entry of events) {
        assert.equal(entry.color, HUNT_CONFIG.FEEDBACK.TRAIL_EXPLOSION.color);
    }
    particles.dispose();
});

test('a trail explosion keeps an explicit colour', () => {
    const particles = createParticles();

    particles.spawnTrailExplosion([new THREE.Vector3()], 0x00ff00);

    const entry = particles.getRecentEvents(1)[0];
    assert.equal(entry.type, 'trail-explosion');
    assert.equal(entry.color, 0x00ff00);
    particles.dispose();
});
