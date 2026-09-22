import * as THREE from 'three';

export const REACTOR_FLASH_NAME = 'reactor-flash-overlay_nocol_noshadow';
const FULL_WHITE_SECONDS = 0.06;
const WHITE_FADE_SECONDS = 0.18;
const GLOW_PEAK_SECONDS = 0.1;
const GLOW_FADE_SECONDS = 0.6;
const ACTIVE_SECONDS = 2.5;
const PROXIMITY_FULL = 300;     // world units within which the whiteout is at full strength
const PROXIMITY_RANGE = 1600;   // ...and by which it has weakened to its distant floor
const REDUCED_FACTOR = 0.3;

function smoothRange(a, b, value) {
    const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return x * x * (3 - 2 * x);
}

/**
 * How hard the breach blinds one camera `seconds` after it went off.
 * `facing` is the cosine between the view direction and the direction to the fireball.
 * @returns {{ white: number, glow: number }} screen whiteout and after-image, 0..1
 */
export function reactorFlashStrength(seconds, { distance = 0, facing = 1, reduced = true } = {}) {
    const t = Number(seconds) || 0;
    if (t <= 0 || t >= ACTIVE_SECONDS) return { white: 0, glow: 0 };
    const envelope = t < FULL_WHITE_SECONDS ? 1 : Math.exp(-(t - FULL_WHITE_SECONDS) / WHITE_FADE_SECONDS);
    // The whole sky lights up, so even a pilot looking away is dazzled, only less.
    const look = 0.3 + 0.7 * smoothRange(-0.3, 0.8, facing);
    const proximity = 0.35 + 0.65 * (1 - smoothRange(PROXIMITY_FULL, PROXIMITY_RANGE, distance));
    const calm = reduced ? REDUCED_FACTOR : 1;
    const afterimage = t < GLOW_PEAK_SECONDS ? t / GLOW_PEAK_SECONDS : Math.exp(-(t - GLOW_PEAK_SECONDS) / GLOW_FADE_SECONDS);
    return {
        white: Math.min(1, envelope * look * proximity) * calm,
        glow: afterimage * smoothRange(0.2, 0.9, facing) * (reduced ? 0.4 : 0.8),
    };
}

const FLASH_VERTEX = /* glsl */`
uniform float flashActive;
varying vec2 vScreen;
void main() {
    // One triangle over the whole screen; idle, it collapses to a point and draws nothing.
    // The corners are stored a thousandth of their size so no bounds measurement sees them.
    vScreen = position.xy * 1000.0;
    gl_Position = flashActive > 0.5 ? vec4(vScreen, 0.0, 1.0) : vec4(0.0);
}
`;

const FLASH_FRAGMENT = /* glsl */`
uniform float flashWhite;
uniform float flashGlow;
uniform vec2 flashSpot;
uniform float flashAspect;
varying vec2 vScreen;
void main() {
    vec2 offset = (vScreen - flashSpot) * vec2(flashAspect, 1.0);
    float spot = flashGlow * exp(-dot(offset, offset) * 9.0);
    float alpha = 1.0 - (1.0 - flashWhite) * (1.0 - spot);
    if (alpha < 0.002) discard;
    vec3 warm = vec3(1.0, 0.72, 0.42) * 1.4;
    vec3 color = mix(warm, vec3(2.0), flashWhite / max(alpha, 0.0001));
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
}
`;

/**
 * A screen whiteout and after-image for every camera that renders the breach. It lives in the
 * scene rather than in post-processing, because split screen renders without the composer.
 * `userData.reduceMotion` starts true and is set from the player's setting when a breach fires.
 */
export function attachReactorFlash(root, action) {
    const fire = root.getObjectByName('fire');
    if (!action || !fire) return null;
    const geometry = new THREE.BufferGeometry();
    // Corners of one screen-covering triangle in clip space, shrunk by the vertex shader's factor.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0].map((v) => v / 1000), 3));
    const material = new THREE.ShaderMaterial({
        uniforms: {
            flashActive: { value: 0 }, flashWhite: { value: 0 }, flashGlow: { value: 0 },
            flashSpot: { value: new THREE.Vector2() }, flashAspect: { value: 1 },
        },
        vertexShader: FLASH_VERTEX, fragmentShader: FLASH_FRAGMENT,
        transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    const overlay = new THREE.Mesh(geometry, material);
    overlay.name = REACTOR_FLASH_NAME;
    overlay.frustumCulled = false;
    overlay.renderOrder = 1e9;
    overlay.userData.reduceMotion = true;
    const firePosition = new THREE.Vector3();
    const view = new THREE.Vector3();
    const toFire = new THREE.Vector3();
    overlay.onBeforeRender = (_renderer, _scene, camera) => {
        const uniforms = material.uniforms;
        fire.getWorldPosition(firePosition);
        camera.getWorldDirection(view);
        toFire.copy(firePosition).sub(camera.position);
        const distance = toFire.length();
        const facing = distance > 0 ? view.dot(toFire.divideScalar(distance)) : 1;
        const { white, glow } = reactorFlashStrength(action.time, {
            distance, facing, reduced: overlay.userData.reduceMotion !== false,
        });
        uniforms.flashActive.value = white > 0.001 || glow > 0.001 ? 1 : 0;
        uniforms.flashWhite.value = white;
        uniforms.flashGlow.value = glow;
        firePosition.project(camera);
        uniforms.flashSpot.value.set(firePosition.x, firePosition.y);
        uniforms.flashAspect.value = Number(camera.aspect) || 1;
    };
    root.add(overlay);
    return overlay;
}
