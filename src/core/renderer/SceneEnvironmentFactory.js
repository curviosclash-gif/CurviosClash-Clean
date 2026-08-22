import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The environment is only ever sampled as a reflection, so it needs no detail - a coarse dome
// keeps the PMREM prefilter cheap enough to rebuild on every map change.
const ENVIRONMENT_RADIUS = 10;
const ENVIRONMENT_SEGMENTS = 16;
const ENVIRONMENT_RINGS = 12;

const SAMPLE_COLOR = new THREE.Color();
const ZENITH_COLOR = new THREE.Color();
const HORIZON_COLOR = new THREE.Color();
const NADIR_COLOR = new THREE.Color();

// Shared with the sky dome in SceneLightingRig so the reflection and the visible sky cannot drift
// apart: both read the same three colours through the same curve.
export function applySkyGradientColors(geometry, colors, radius) {
    const positions = geometry.getAttribute('position');
    let target = geometry.getAttribute('color');
    if (!target || target.count !== positions.count) {
        target = new THREE.BufferAttribute(new Float32Array(positions.count * 3), 3);
        geometry.setAttribute('color', target);
    }
    ZENITH_COLOR.setHex(colors.zenithColor);
    HORIZON_COLOR.setHex(colors.horizonColor);
    NADIR_COLOR.setHex(colors.nadirColor);
    for (let i = 0; i < positions.count; i += 1) {
        const y = THREE.MathUtils.clamp(positions.getY(i) / radius, -1, 1);
        if (y >= 0) {
            SAMPLE_COLOR.copy(HORIZON_COLOR).lerp(ZENITH_COLOR, Math.pow(y, 0.62));
        } else {
            SAMPLE_COLOR.copy(HORIZON_COLOR).lerp(NADIR_COLOR, Math.pow(-y, 0.7));
        }
        target.setXYZ(i, SAMPLE_COLOR.r, SAMPLE_COLOR.g, SAMPLE_COLOR.b);
    }
    target.needsUpdate = true;
    return target;
}

// A gradient dome alone reflects as flat colour. Metal needs something bright and bounded to
// mirror, which is the job RoomEnvironment's lamps do in the neutral studio - these three take
// the key light's colour instead, so the highlight matches the map's own lighting.
function addEnvironmentLights(scene, lighting) {
    const keyColor = new THREE.Color(lighting.key.color);
    const intensity = Math.max(0.25, Math.min(4, lighting.key.intensity));
    const lamps = [
        { size: [7, 0.4, 7], position: [0, ENVIRONMENT_RADIUS * 0.82, 0], scale: 1 },
        { size: [4, 3, 0.4], position: [4.5, 1.5, -6], scale: 0.7 },
        { size: [0.4, 2.5, 5], position: [-6, 2.2, 3], scale: 0.45 },
    ];
    for (const lamp of lamps) {
        const material = new THREE.MeshBasicMaterial({
            color: keyColor.clone().multiplyScalar(intensity * lamp.scale),
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...lamp.size), material);
        mesh.position.set(...lamp.position);
        scene.add(mesh);
    }
}

function createSkyEnvironmentScene(lighting) {
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(
        ENVIRONMENT_RADIUS,
        ENVIRONMENT_SEGMENTS,
        ENVIRONMENT_RINGS
    );
    applySkyGradientColors(geometry, lighting.skyDome, ENVIRONMENT_RADIUS);
    const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        side: THREE.BackSide,
        vertexColors: true,
        toneMapped: false,
    }));
    scene.add(dome);
    addEnvironmentLights(scene, lighting);
    return scene;
}

function disposeEnvironmentScene(scene) {
    scene.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry.dispose();
        child.material.dispose();
    });
}

// Only the values the reflection can actually show. Brightness steps and view distance change the
// scene every time a slider moves but leave the reflection identical, so they stay out of the key -
// otherwise every slider drag would trigger a PMREM prefilter.
export function resolveEnvironmentKey(graphicsStyle, lighting) {
    if (graphicsStyle !== 'modern') return 'room';
    return [
        'sky',
        lighting.skyDome.zenithColor,
        lighting.skyDome.horizonColor,
        lighting.skyDome.nadirColor,
        lighting.key.color,
        Math.round(lighting.key.intensity * 100),
    ].join('|');
}

export class SceneEnvironmentController {
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        this.renderTarget = null;
        this.activeKey = null;
    }

    // Returns the key that is now live so callers can assert which environment a scene ended up
    // with without inspecting the texture itself.
    apply(graphicsStyle, lighting) {
        const key = resolveEnvironmentKey(graphicsStyle, lighting);
        if (key === this.activeKey && this.renderTarget) return key;

        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        const source = key === 'room' ? new RoomEnvironment() : createSkyEnvironmentScene(lighting);
        try {
            const nextTarget = pmremGenerator.fromScene(source, key === 'room' ? 0.04 : 0.08);
            this.renderTarget?.dispose?.();
            this.renderTarget = nextTarget;
            this.scene.environment = nextTarget.texture;
            this.activeKey = key;
        } finally {
            if (key === 'room') source.dispose();
            else disposeEnvironmentScene(source);
            pmremGenerator.dispose();
        }
        return this.activeKey;
    }

    getActiveKey() {
        return this.activeKey;
    }

    dispose() {
        this.scene.environment = null;
        this.renderTarget?.dispose?.();
        this.renderTarget = null;
        this.activeKey = null;
    }
}
