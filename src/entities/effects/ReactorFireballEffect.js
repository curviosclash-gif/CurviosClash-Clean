import * as THREE from 'three';

// Fog factor for shaders that blend it themselves: partial fog on smoke, fading an
// additive glow to black instead of to the fog colour. Needs <fog_pars_fragment>.
export const FOG_FACTOR_GLSL = /* glsl */`
float reactorFogFactor() {
#ifdef USE_FOG
  #ifdef FOG_EXP2
    return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    return smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#else
    return 0.0;
#endif
}
`;

// Linear emission per second of the breach: a fireball cools from white through yellow and
// orange to a dull red. Every channel stays below 2, above which the sky's tone mapping tears.
const TEMPERATURE_KEYS = [
    [0.00, 1.90, 1.86, 1.72],
    [0.25, 1.90, 1.62, 1.10],
    [0.80, 1.85, 1.08, 0.36],
    [1.60, 1.60, 0.56, 0.12],
    [2.80, 1.00, 0.26, 0.05],
    [4.40, 0.45, 0.08, 0.02],
];

function smoothRange(a, b, value) {
    const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return x * x * (3 - 2 * x);
}

export function fireballTemperatureColor(seconds, out = new THREE.Color()) {
    const t = Math.max(0, Number(seconds) || 0);
    let index = 1;
    while (index < TEMPERATURE_KEYS.length - 1 && TEMPERATURE_KEYS[index][0] < t) index += 1;
    const [t0, r0, g0, b0] = TEMPERATURE_KEYS[index - 1];
    const [t1, r1, g1, b1] = TEMPERATURE_KEYS[index];
    const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    return out.setRGB(r0 + (r1 - r0) * u, g0 + (g1 - g0) * u, b0 + (b1 - b0) * u);
}

/** Strength of the light the fireball throws on ground and smoke, 0..1. */
export function fireballGlow(seconds) {
    const t = Math.max(0, Number(seconds) || 0);
    return smoothRange(0, 0.06, t) * (1 - smoothRange(1.6, 4.8, t));
}

/** World centre and radius of the drawn fireball; `out` is a Vector4 (xyz, radius). */
export function sampleFireLight(fire, out) {
    if (!fire) return out.set(0, 0, 0, 0);
    const position = fire.getWorldPosition(SCRATCH_POSITION);
    return out.set(position.x, position.y, position.z, fire.getWorldScale(SCRATCH_SCALE).x);
}

const SCRATCH_POSITION = new THREE.Vector3();
const SCRATCH_SCALE = new THREE.Vector3();
const GLOW_REACH = 3.2; // ground glow radius as a multiple of the fireball radius
const GLOW_COLOR = new THREE.Color(0.5, 0.17, 0.045);

const NOISE_GLSL = /* glsl */`
uniform float fireTime;
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1); p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float valueNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Boiling cells in object space that drift upward over the surface as time runs.
float boil(vec3 object) {
    vec3 p = object * 3.0 + vec3(0.0, -fireTime * 1.3, fireTime * 0.4);
    return valueNoise(p) * 0.6 + valueNoise(p * 2.3 + 7.1) * 0.3 + valueNoise(p * 5.1) * 0.1;
}
`;

const FIREBALL_VERTEX = /* glsl */`
varying vec3 vObject;
varying vec3 vViewNormal;
varying vec3 vViewDirection;
${NOISE_GLSL}
#include <fog_pars_vertex>
void main() {
    vObject = position;
    // A lumpy, boiling outline instead of the faceted edge of a smooth sphere.
    vec3 displaced = position * (1.0 + 0.09 * (boil(position * 0.7) - 0.5));
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`;

const FIREBALL_FRAGMENT = /* glsl */`
uniform vec3 fireColor;
uniform float fireCrust;
varying vec3 vObject;
varying vec3 vViewNormal;
varying vec3 vViewDirection;
${NOISE_GLSL}
#include <fog_pars_fragment>
void main() {
    float n = boil(vObject);
    float facing = clamp(dot(normalize(vViewNormal), normalize(vViewDirection)), 0.0, 1.0);
    float limb = mix(0.4, 1.0, pow(facing, 0.6));
    // Hot cells against cooler lanes, then a soot crust that spreads as the fireball cools.
    float crust = smoothstep(fireCrust - 0.15, fireCrust + 0.15, 1.0 - n);
    vec3 color = fireColor * limb * mix(0.35, 1.25, smoothstep(0.3, 0.75, n));
    color = mix(color, vec3(0.05, 0.03, 0.02), crust * 0.85);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
}
`;

const GLOW_VERTEX = /* glsl */`
uniform float glowRadius;
varying vec2 vGlowUv;
#include <fog_pars_vertex>
void main() {
    vGlowUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position * glowRadius, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`;

const GLOW_FRAGMENT = /* glsl */`
uniform vec3 glowColor;
uniform float glow;
varying vec2 vGlowUv;
#include <fog_pars_fragment>
${FOG_FACTOR_GLSL}
void main() {
    float r = length(vGlowUv - 0.5) * 2.0;
    float light = glow * pow(max(0.0, 1.0 - r), 2.2);
    // Additive light fades to black in fog, never to the fog colour.
    gl_FragColor = vec4(glowColor * light * (1.0 - reactorFogFactor()), 1.0);
    #include <colorspace_fragment>
}
`;

function createFireballMaterial() {
    return new THREE.ShaderMaterial({
        name: 'Fireball',
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            fireColor: { value: new THREE.Color() }, fireTime: { value: 0 }, fireCrust: { value: 1.2 },
        }]),
        vertexShader: FIREBALL_VERTEX, fragmentShader: FIREBALL_FRAGMENT, fog: true,
    });
}

function createGroundGlow() {
    // A unit disc widened in the vertex shader: bounds measured off the geometry or the
    // object scale never see the glow, so it cannot widen the model's measured extents.
    const geometry = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            glowColor: { value: GLOW_COLOR.clone() }, glow: { value: 0 }, glowRadius: { value: 0 },
        }]),
        vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, fog: true,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'reactor-fire-glow_nocol_noshadow';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
}

/**
 * Upgrades the breach's flat fireball to a cooling, boiling body and lays its light on the
 * ground. Deliberately no real light: adding one when the hidden cloud appears would recompile
 * every lit shader of the map at the moment of the explosion.
 */
export function attachReactorFireball(root, action) {
    const fire = root.getObjectByName('fire');
    const fireMesh = fire?.children.find((node) => node.isMesh);
    if (!action || !fireMesh) return null;
    fireMesh.material.dispose();
    fireMesh.material = createFireballMaterial();
    const uniforms = fireMesh.material.uniforms;
    fireMesh.onBeforeRender = () => {
        const time = Math.max(0, action.time);
        fireballTemperatureColor(time, uniforms.fireColor.value);
        uniforms.fireTime.value = time;
        uniforms.fireCrust.value = 1.0 - 0.55 * smoothRange(1.2, 4.4, time);
    };

    const glow = createGroundGlow();
    root.add(glow);
    const light = new THREE.Vector4();
    const rootScale = new THREE.Vector3();
    glow.onBeforeRender = () => {
        const strength = fireballGlow(action.time);
        glow.material.uniforms.glow.value = strength;
        sampleFireLight(fire, light);
        root.getWorldScale(rootScale);
        SCRATCH_POSITION.set(light.x, 0, light.z);
        root.worldToLocal(SCRATCH_POSITION);
        // Just above the apron the root stands on, under the fireball wherever it has risen.
        glow.position.set(SCRATCH_POSITION.x, 0.4, SCRATCH_POSITION.z);
        // Dark, it collapses to a point instead of filling pixels with added black.
        glow.material.uniforms.glowRadius.value = strength > 0
            ? GLOW_REACH * light.w / Math.max(0.001, rootScale.x) : 0;
        // three.js derives the model-view matrix after this hook, so the new pose draws now.
        glow.updateMatrixWorld();
    };
    return { fire, fireMesh, glow };
}
