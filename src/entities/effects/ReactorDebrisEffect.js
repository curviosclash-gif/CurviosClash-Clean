import * as THREE from 'three';
import { FOG_FACTOR_GLSL } from './ReactorFireballEffect.js';

// Glowing chunks thrown out of the breached reactor. Every chunk flies an analytic ballistic arc
// from fixed launch values, so the GPU computes its pose from the breach clock alone: seeking,
// replicas and split screen agree, and no per-frame upload can lag a frame behind. Visual only:
// nothing here collides or deals damage. Units are the cloud model's own metres.

export const DEBRIS_CHUNKS = 48;
export const DEBRIS_TRAIL_PUFFS = 12;
export const DEBRIS_GRAVITY = 9.81;
const TRAIL_LIFE_SECONDS = 7;
const IMPACT_SECONDS = 4;
export const DEBRIS_NAME = 'reactor-debris_nocol_noshadow';
export const DEBRIS_PUFFS_NAME = 'reactor-debris-puffs_nocol_noshadow';

/** Small deterministic generator, so every client throws the same chunks. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Launch values of every chunk for one cloud variant.
 * @returns {{ azimuth: number, elevation: number, speed: number, start: number, x: number, y: number, z: number,
 *   size: number, spin: number, cooling: number }[]}
 */
export function createDebrisLaunches(seed) {
    const random = mulberry32(Math.max(1, Math.floor(Number(seed) || 1)) * 7919 + 11);
    return Array.from({ length: DEBRIS_CHUNKS }, () => {
        const azimuth = random() * Math.PI * 2;
        const spread = 4 + random() * 10;
        return {
            azimuth,
            // 30-65 degrees at 26-46 m/s: airborne about 3 to 9 seconds, landing 50-250 m out.
            elevation: (30 + random() * 35) * Math.PI / 180,
            speed: 26 + random() * 20,
            start: 0.04 + random() * 0.3,
            x: Math.cos(azimuth) * spread, y: 8 + random() * 10, z: Math.sin(azimuth) * spread,
            // Concrete blocks of 2.5-7 m: smaller ones vanish at the distance pilots watch from.
            size: 2.5 + random() ** 2 * 4.5,
            spin: 1 + random() * 5,
            cooling: 5 + random() * 12,
        };
    });
}

/**
 * Where a chunk is `seconds` after the breach; the same formula as the vertex shader.
 * @returns {{ x: number, y: number, z: number, landed: boolean, landAt: number, flying: boolean }}
 */
export function debrisPosition(launch, seconds) {
    const t = seconds - launch.start;
    const horizontal = launch.speed * Math.cos(launch.elevation);
    const vertical = launch.speed * Math.sin(launch.elevation);
    const rest = launch.size * 0.5;
    const landAt = (vertical + Math.sqrt(vertical * vertical + 2 * DEBRIS_GRAVITY * (launch.y - rest))) / DEBRIS_GRAVITY;
    const flight = Math.min(Math.max(t, 0), landAt);
    return {
        x: launch.x + Math.cos(launch.azimuth) * horizontal * flight,
        y: t >= landAt ? rest : launch.y + vertical * flight - 0.5 * DEBRIS_GRAVITY * flight * flight,
        z: launch.z + Math.sin(launch.azimuth) * horizontal * flight,
        landed: t >= landAt,
        landAt: launch.start + landAt,
        flying: t >= 0 && t < landAt,
    };
}

const TRAJECTORY_GLSL = /* glsl */`
uniform float debrisTime;
attribute vec4 launchArc;    // azimuth, elevation, speed, start
attribute vec4 launchOrigin; // x, y, z, size
// Position of a chunk t seconds after the breach, and its flight time until landing.
vec3 debrisPosition(float t, out float flight, out float landAt) {
    float azimuth = launchArc.x, elevation = launchArc.y, speed = launchArc.z;
    float horizontal = speed * cos(elevation), vertical = speed * sin(elevation);
    float rest = launchOrigin.w * 0.5;
    landAt = (vertical + sqrt(vertical * vertical + 2.0 * ${DEBRIS_GRAVITY.toFixed(2)} * (launchOrigin.y - rest))) / ${DEBRIS_GRAVITY.toFixed(2)};
    float local = t - launchArc.w;
    flight = clamp(local, 0.0, landAt);
    vec3 position = launchOrigin.xyz + vec3(cos(azimuth) * horizontal * flight,
        vertical * flight - 0.5 * ${DEBRIS_GRAVITY.toFixed(2)} * flight * flight, sin(azimuth) * horizontal * flight);
    if (local >= landAt) position.y = rest;
    return position;
}
`;

const CHUNK_VERTEX = /* glsl */`
attribute vec4 chunkLook;    // spin speed, cooling seconds, spin axis seed, unused
varying float vHeat;
varying vec3 vChunkNormal;
${TRAJECTORY_GLSL}
#include <fog_pars_vertex>
void main() {
    float flight, landAt;
    vec3 centre = debrisPosition(debrisTime, flight, landAt);
    float local = debrisTime - launchArc.w;
    vec3 axis = normalize(vec3(sin(chunkLook.z * 3.1), 0.6, cos(chunkLook.z * 1.7)));
    float angle = chunkLook.x * flight;
    // Rodrigues rotation: the chunk tumbles while it flies and lies still once it has landed.
    vec3 p = position * launchOrigin.w;
    vec3 turned = p * cos(angle) + cross(axis, p) * sin(angle) + axis * dot(axis, p) * (1.0 - cos(angle));
    vChunkNormal = normalize(normalMatrix * (normal * cos(angle) + cross(axis, normal) * sin(angle)
        + axis * dot(axis, normal) * (1.0 - cos(angle))));
    vHeat = local < 0.0 ? 0.0 : exp(-local / chunkLook.y);
    vec4 mvPosition = modelViewMatrix * vec4(centre + turned, 1.0);
    // Before its launch a chunk collapses to a point and draws nothing.
    gl_Position = local < 0.0 ? vec4(0.0) : projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`;

const CHUNK_FRAGMENT = /* glsl */`
varying float vHeat;
varying vec3 vChunkNormal;
#include <fog_pars_fragment>
${FOG_FACTOR_GLSL}
void main() {
    float light = 0.35 + 0.65 * max(dot(normalize(vChunkNormal), normalize(vec3(0.3, 0.9, 0.3))), 0.0);
    vec3 rock = vec3(0.2, 0.19, 0.18) * light;
    vec3 hot = mix(vec3(0.9, 0.18, 0.03), vec3(1.8, 0.75, 0.22), vHeat * vHeat);
    gl_FragColor = vec4(mix(rock, hot, smoothstep(0.02, 0.6, vHeat)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, reactorFogFactor() * .5);
}
`;

const PUFF_VERTEX = /* glsl */`
attribute float puffIndex;   // 1..N trail puffs along the flight, 0 is the impact dust
varying vec2 vPuffUv;
varying float vPuffAlpha;
varying float vPuffWarmth;
${TRAJECTORY_GLSL}
#include <fog_pars_vertex>
void main() {
    float flight, landAt;
    vec3 centre;
    float size, alpha;
    vec3 now = debrisPosition(debrisTime, flight, landAt);
    float local = debrisTime - launchArc.w;
    if (puffIndex < 0.5) {
        // Dust thrown up where the chunk lands, growing and settling for a few seconds.
        float age = local - landAt;
        centre = now + vec3(0.0, launchOrigin.w * 1.5, 0.0);
        size = launchOrigin.w * (3.0 + 7.0 * clamp(age / ${IMPACT_SECONDS.toFixed(1)}, 0.0, 1.0));
        alpha = age < 0.0 ? 0.0 : 0.7 * (1.0 - clamp(age / ${IMPACT_SECONDS.toFixed(1)}, 0.0, 1.0));
        vPuffWarmth = 0.0;
    } else {
        // A trail puff is shed at a fixed point of the flight and stays there: it rises a
        // little, widens and thins out, so the arc hangs in the sky after the chunk has landed.
        float shedAt = puffIndex / ${(DEBRIS_TRAIL_PUFFS + 1).toFixed(1)} * landAt;
        float age = local - shedAt;
        float shedFlight, ignored;
        centre = debrisPosition(launchArc.w + shedAt, shedFlight, ignored) + vec3(0.0, 0.8 * max(age, 0.0), 0.0);
        size = launchOrigin.w * (1.6 + 1.2 * clamp(age, 0.0, ${TRAIL_LIFE_SECONDS.toFixed(1)}));
        alpha = age > 0.0 ? 0.62 * (1.0 - smoothstep(1.5, ${TRAIL_LIFE_SECONDS.toFixed(1)}, age)) : 0.0;
        vPuffWarmth = 1.0 - smoothstep(0.0, 0.8, age);
    }
    vPuffUv = uv;
    vPuffAlpha = alpha;
    vec4 mvPosition = viewMatrix * modelMatrix * vec4(centre, 1.0);
    mvPosition.xy += position.xy * size * length(modelMatrix[0].xyz);
    gl_Position = alpha <= 0.001 ? vec4(0.0) : projectionMatrix * mvPosition;
    #include <fog_vertex>
}
`;

const PUFF_FRAGMENT = /* glsl */`
varying vec2 vPuffUv;
varying float vPuffAlpha;
varying float vPuffWarmth;
#include <fog_pars_fragment>
${FOG_FACTOR_GLSL}
void main() {
    vec2 offset = vPuffUv - 0.5;
    float r = length(offset) * 2.0;
    float edge = 1.0 - smoothstep(0.35, 1.0, r + 0.12 * sin(atan(offset.y, offset.x) * 5.0 + r * 6.0));
    float alpha = vPuffAlpha * edge;
    if (alpha < 0.004) discard;
    // Dark smoke, still warm where the hot chunk has just passed; dark reads against the haze.
    vec3 smoke = mix(vec3(0.17, 0.16, 0.15), vec3(1.0, 0.42, 0.12), vPuffWarmth * 0.7);
    gl_FragColor = vec4(smoke, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, reactorFogFactor() * .35);
}
`;

function launchAttributes(launches, repeat = 1) {
    const arc = new Float32Array(launches.length * repeat * 4);
    const origin = new Float32Array(launches.length * repeat * 4);
    let i = 0;
    for (const launch of launches) {
        for (let copy = 0; copy < repeat; copy += 1, i += 4) {
            arc.set([launch.azimuth, launch.elevation, launch.speed, launch.start], i);
            origin.set([launch.x, launch.y, launch.z, launch.size], i);
        }
    }
    return { arc: new THREE.InstancedBufferAttribute(arc, 4), origin: new THREE.InstancedBufferAttribute(origin, 4) };
}

function debrisMaterial(vertexShader, fragmentShader, extra = {}) {
    return new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { debrisTime: { value: 0 } }]),
        vertexShader, fragmentShader, fog: true, ...extra,
    });
}

/**
 * Adds the thrown chunks and their smoke to a reactor cloud root. `seed` picks the throw, so the
 * four cloud variants scatter differently while every client scatters one variant alike.
 */
export function attachReactorDebris(root, action, seed = 1) {
    if (!action) return null;
    const launches = createDebrisLaunches(seed);
    const rock = new THREE.IcosahedronGeometry(0.5, 0);
    const chunks = new THREE.InstancedBufferGeometry();
    chunks.index = rock.index;
    chunks.setAttribute('position', rock.attributes.position);
    chunks.setAttribute('normal', rock.attributes.normal);
    const chunkAttributes = launchAttributes(launches);
    chunks.setAttribute('launchArc', chunkAttributes.arc);
    chunks.setAttribute('launchOrigin', chunkAttributes.origin);
    chunks.setAttribute('chunkLook', new THREE.InstancedBufferAttribute(new Float32Array(launches.flatMap(
        (launch, index) => [launch.spin, launch.cooling, index * 1.37, 0])), 4));
    chunks.instanceCount = launches.length;
    const chunkMesh = new THREE.Mesh(chunks, debrisMaterial(CHUNK_VERTEX, CHUNK_FRAGMENT));
    chunkMesh.name = DEBRIS_NAME;

    const quad = new THREE.PlaneGeometry(1, 1);
    const puffs = new THREE.InstancedBufferGeometry();
    puffs.index = quad.index;
    puffs.setAttribute('position', quad.attributes.position);
    puffs.setAttribute('uv', quad.attributes.uv);
    const repeat = DEBRIS_TRAIL_PUFFS + 1;
    const puffAttributes = launchAttributes(launches, repeat);
    puffs.setAttribute('launchArc', puffAttributes.arc);
    puffs.setAttribute('launchOrigin', puffAttributes.origin);
    puffs.setAttribute('puffIndex', new THREE.InstancedBufferAttribute(new Float32Array(
        launches.flatMap(() => Array.from({ length: repeat }, (_, index) => index))), 1));
    puffs.instanceCount = launches.length * repeat;
    const puffMesh = new THREE.Mesh(puffs, debrisMaterial(PUFF_VERTEX, PUFF_FRAGMENT,
        { transparent: true, depthWrite: false }));
    puffMesh.name = DEBRIS_PUFFS_NAME;

    for (const mesh of [chunkMesh, puffMesh]) {
        // Posed in the vertex shader: the carrier geometry is no extent of the model.
        mesh.frustumCulled = false;
        mesh.onBeforeRender = () => { mesh.material.uniforms.debrisTime.value = Math.max(0, action.time); };
        root.add(mesh);
    }
    return { chunks: chunkMesh, puffs: puffMesh, launches };
}
