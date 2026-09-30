import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ConventionalExplosionEffect, EXPLOSION_BUDGET } from '../src/entities/effects/ConventionalExplosionEffect.js';
import { copyExplosionContact, selectConventionalExplosionProfile } from '../src/entities/effects/ConventionalExplosionProfiles.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { handleRocketIntercept } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import atlas from '../assets/vfx/conventional-runtime/profiles.json' with { type: 'json' };
import { CONVENTIONAL_EXPLOSION_PROFILES } from '../src/entities/effects/ConventionalExplosionProfiles.js';

const at = new THREE.Vector3(30, 14, -20);
const renderer = () => ({ addToScene() {}, removeFromScene() {} });
const textures = () => new THREE.DataTexture(new Uint8Array([255, 130, 60, 255]), 1, 1);

test('every runtime profile has finite fire and smoke poses and the secondary burst keeps its three authored delays', () => {
    assert.deepEqual({ events: EXPLOSION_BUDGET.events, fireCards: EXPLOSION_BUDGET.fireCards,
        smokeCards: EXPLOSION_BUDGET.smokeCards, sharedParticles: EXPLOSION_BUDGET.sharedParticles },
    { events: 24, fireCards: 96, smokeCards: 192, sharedParticles: 1000 });
    assert.deepEqual(Object.keys(atlas.profiles).sort(), Object.keys(CONVENTIONAL_EXPLOSION_PROFILES).sort());
    assert.equal(atlas.frames.length, 8);
    for (const source of Object.values(atlas.profiles)) {
        assert.ok(source.referenceRadius > 0);
        assert.ok(source.cards.some((card) => card.layer === 'fire'));
        assert.ok(source.cards.some((card) => card.layer === 'smoke'));
        for (const card of source.cards) {
            assert.equal(card.poses.length, atlas.frames.length);
            assert.ok(card.poses.every((pose) => pose.length === 6 && pose.every(Number.isFinite)
                && pose.slice(3).every((extent) => extent >= 0)));
        }
    }
    assert.deepEqual([...new Set(atlas.profiles['air-secondary'].cards.map((card) => card.delay))].sort((a,b) => a-b), [0, 7, 14]);
});

test('actual contact selects ground and wall profiles, while missing contact stays airborne at any height', () => {
    const pick = (event) => selectConventionalExplosionProfile(event).id;
    assert.equal(pick({ position: { y: -40 }, projectileType: 'ROCKET_MEDIUM' }), 'air-compact');
    assert.equal(pick({ contact: { hit: true, normal: { y: 1 } } }), 'ground-rocket');
    assert.equal(pick({ contact: { hit: true, normal: { y: 0, x: 1 } } }), 'ground-breach');
    assert.equal(pick({ contact: { hit: true, normal: { y: 1 } }, projectileType: 'ROCKET_WEAK' }), 'ground-grenade');
    assert.equal(pick({ kind: 'intercept', interceptor: 'rocket', direction: { x: 1 } }), 'air-elongated');
    assert.equal(pick({ kind: 'intercept', interceptor: 'gun' }), 'air-fragment');
    assert.equal(pick({ kind: 'death', projectileType: 'ROCKET_MEGA' }), 'air-secondary');
});

test('arena contact is owned before the reused collision object changes', () => {
    const collision = { hit: true, normal: new THREE.Vector3(1, 0, 0), kind: 'hard' };
    const out = { normal: new THREE.Vector3() };
    copyExplosionContact(out, collision);
    collision.normal.set(0, 1, 0); collision.hit = false;
    assert.equal(out.hit, true);
    assert.deepEqual(out.normal.toArray(), [1, 0, 0]);
    assert.equal(out.dust, false);
});

test('effect owns its position and orientation and stays bounded under simultaneous bursts', async () => {
    const fx = new ConventionalExplosionEffect(renderer(), { loadTexture: async () => textures() });
    assert.equal(await fx.loading, true);
    const position = at.clone();
    const normal = new THREE.Vector3(1, 0, 0);
    fx.spawn(position, { profile: 'ground-rocket', contact: { hit: true, normal } });
    position.set(0, 0, 0); normal.set(0, 1, 0);
    assert.deepEqual(fx.events[0].position.toArray(), at.toArray());
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(fx.events[0].orientation).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6);
    for (let i = 0; i < 80; i++) fx.spawn(at, { profile: 'air-compact' });
    assert.equal(fx.count, EXPLOSION_BUDGET.events);
    fx.update(.45);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(30, 14, 4); camera.lookAt(at); camera.updateMatrixWorld();
    for (const layer of fx.layers) {
        fx.prepareLayer(layer, camera, new THREE.Scene());
        assert.ok(layer.active > 0 && layer.active <= layer.capacity);
        assert.equal(layer.mesh.material.depthTest, true);
        assert.ok(layer.data.every(Number.isFinite));
    }
    fx.update(4);
    assert.equal(fx.count, 0);
    assert.ok(fx.layers.every((layer) => layer.mesh.geometry.instanceCount === 0));
    fx.dispose(); fx.dispose();
});

test('the first draw, opposing split camera and smoke distance LOD write their own active data', async () => {
    const fx = new ConventionalExplosionEffect(renderer(), { loadTexture: async () => textures() });
    await fx.loading;
    fx.spawn(at, { profile: 'air-compact' }); fx.update(.5);
    const camera = new THREE.PerspectiveCamera(); const scene = new THREE.Scene();
    const smoke = fx.layers[1];
    camera.position.set(30, 14, -3); camera.lookAt(at); camera.updateMatrixWorld();
    smoke.mesh.onBeforeRender(null, scene, camera);
    const nearby = smoke.active;
    assert.ok(nearby > 3);
    assert.equal(smoke.data[12], 1);
    camera.position.set(30, 14, -230); camera.lookAt(at); camera.updateMatrixWorld();
    smoke.mesh.onBeforeRender(null, scene, camera);
    assert.equal(smoke.data[12], 0);
    assert.ok(smoke.active < nearby);
    assert.ok(smoke.data.subarray(smoke.active*16).every((value) => value === 0));
    camera.position.set(30, 14, -3); camera.updateMatrixWorld();
    smoke.mesh.onBeforeRender(null, scene, camera);
    assert.equal(smoke.active, nearby);
    fx.clear();
    assert.ok(fx.layers.every((layer) => layer.data.every((value) => value === 0)));
    fx.dispose();
});

test('ground cards lift along their actual contact normal, including an elevated platform', async () => {
    const fx = new ConventionalExplosionEffect(renderer(), { loadTexture: async () => textures() });
    await fx.loading;
    const platform = new THREE.Vector3(5, 70, -3);
    fx.spawn(platform, { profile: 'ground-tnt', contact: { hit: true, normal: new THREE.Vector3(0, 1, 0) } });
    fx.update(.32);
    const camera = new THREE.PerspectiveCamera(); camera.position.copy(platform).add(new THREE.Vector3(5, 5, 12));
    camera.lookAt(platform); camera.updateMatrixWorld();
    for (const layer of fx.layers) {
        fx.prepareLayer(layer, camera, new THREE.Scene());
        assert.ok(layer.active > 0);
        for (let i = 0; i < layer.active; i++) {
            const center = layer.data[i*16+1], height = layer.data[i*16+5];
            assert.ok(center-height/2 >= platform.y-.5, 'a lobe must not be buried below the contacted platform');
        }
    }
    fx.dispose();
});

test('failed and late texture loads release resources and retain a working fallback', async () => {
    const texture = textures(); let disposed = 0; texture.addEventListener('dispose', () => disposed++);
    let calls = 0;
    const fx = new ConventionalExplosionEffect(renderer(), { loadTexture: async () => {
        if (++calls === 2) throw new Error('missing texture'); return texture;
    } });
    assert.equal(await fx.loading, false);
    assert.equal(disposed, 1);
    assert.equal(fx.spawn(at, { profile: 'air-compact' }), false);
    fx.dispose();
    const lateTexture = textures(); let lateDisposals = 0;
    lateTexture.addEventListener('dispose', () => lateDisposals++);
    const late = new ConventionalExplosionEffect(renderer(), { loadTexture: async () => lateTexture });
    late.dispose(); await late.loading;
    assert.equal(late.ready, false);
    assert.equal(lateDisposals, 1);
});

test('authoritative presentation events retain their profile, pose and age and replay once across repeated snapshots', () => {
    const host = new ParticleSystem(renderer());
    host.spawnRocketImpact(at, 'ROCKET_HEAVY', 0xff8040, { profile: 'air-compact' });
    host.update(.25);
    const entries = host.conventionalExplosionEffect.serializeNetworkState();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].age, .25);
    const client = new ParticleSystem(renderer());
    const reconciler = new StateReconciler();
    let sounds = 0;
    const manager = { particles: client, _projectileSystem: { authoritativeExplosionEvents: false },
        audio: { play() { sounds++; } }, players: [], applyNetworkSnapshot() {} };
    reconciler.receiveServerState({ state: { players: [], explosionEvents: entries } });
    reconciler.reconcile([], manager); reconciler.reconcile([], manager);
    assert.equal(manager._projectileSystem.authoritativeExplosionEvents, true);
    assert.equal(sounds, 1);
    const event = client.conventionalExplosionEffect.events.find((candidate) => candidate.profile);
    assert.equal(event.profile.id, entries[0].profile);
    assert.deepEqual(event.position.toArray(), entries[0].pos);
    assert.equal(event.age, .25);
    const advanced = entries.map((entry) => ({ ...entry, age: .5 }));
    reconciler.receiveServerState({ state: { players: [], explosionEvents: advanced } });
    reconciler.reconcile([], manager);
    assert.equal(event.age, .5, 'later snapshots correct the presentation phase without replaying the sound');
    assert.equal(sounds, 1);
    const before = client.count;
    client.spawnRocketImpact(at, 'ROCKET_HEAVY');
    assert.equal(client.count, before, 'a disappeared replica rocket cannot add a second presentation');
    client.update(4);
    assert.equal(client.conventionalExplosionEffect.count, 0, 'fallback events also expire');
    host.dispose(); client.dispose();
});

test('a replacement host effect never reuses network ids a client has already replayed', () => {
    const first = new ParticleSystem(renderer()), second = new ParticleSystem(renderer());
    for (const host of [first, second]) host.spawnRocketImpact(at, 'ROCKET_HEAVY', 0xff8040, { profile: 'air-compact' });
    const [a] = first.conventionalExplosionEffect.serializeNetworkState();
    const [b] = second.conventionalExplosionEffect.serializeNetworkState();
    assert.notEqual(a.id, b.id);
    first.dispose(); second.dispose();
});

test('a shared intercept produces one presentation and sound while preserving defender credit', () => {
    const particles = new ParticleSystem(renderer());
    const sounds = [], credits = [];
    handleRocketIntercept({ particles, audio: { play: (name) => sounds.push(name) },
        _huntScoring: { registerIntercept: (index) => credits.push(index) } }, {
        position: at, defender: { index: 2, isBot: true },
        target: { type: 'ROCKET_HEAVY', velocity: new THREE.Vector3(1, 0, 0) },
        interceptor: { type: 'ROCKET_WEAK' },
    });
    assert.equal(particles.conventionalExplosionEffect.count, 1);
    assert.equal(particles.conventionalExplosionEffect.events[0].profile.id, 'air-elongated');
    assert.deepEqual(sounds, ['ROCKET_IMPACT']);
    assert.deepEqual(credits, [2]);
    particles.dispose();
});

test('snapshot authority preserves small item bursts and resets with the particle system', () => {
    const particles = new ParticleSystem(renderer());
    particles.applyNetworkExplosionEvents([]);
    particles.spawnExplosion(at, 0xff8040, { blast: 'ITEM_BURST' });
    assert.ok(particles.count > 0);
    assert.equal(particles.conventionalExplosionEffect.count, 0);
    particles.clear();
    particles.spawnRocketImpact(at, 'ROCKET_MEDIUM');
    assert.equal(particles.conventionalExplosionEffect.count, 1);
    particles.dispose();
});

test('a fatal rocket hit retains impact smoke but only the vehicle death contributes an overlapping fire shell', async () => {
    const fx = new ConventionalExplosionEffect(renderer(), { loadTexture: async () => textures() });
    await fx.loading;
    fx.spawn(at, { kind: 'rocket', projectileType: 'ROCKET_HEAVY' });
    const impact = fx.events[0];
    fx.spawn(at.clone().add(new THREE.Vector3(.5, 0, 0)), { kind: 'death', replicate: false });
    assert.equal(impact.fireSuppressed, true);
    assert.equal(fx.serializeNetworkState()[0].fireSuppressed, true);
    fx.update(.25);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(30, 14, 4); camera.lookAt(at); camera.updateMatrixWorld();
    for (const layer of fx.layers) fx.prepareLayer(layer, camera, new THREE.Scene());
    assert.ok(fx.layers[0].active > 0);
    assert.ok(fx.layers[1].active > fx.layers[0].active);
    const fireCount = fx.layers[0].active;
    impact.profile = null;
    fx.prepareLayer(fx.layers[0], camera, new THREE.Scene());
    assert.equal(fx.layers[0].active, fireCount, 'the impact contributed no second fire shell');
    fx.dispose();
});
