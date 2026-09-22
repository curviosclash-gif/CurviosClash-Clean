import * as THREE from 'three';
import { getVolumeNoiseTexture } from './ReactorVolumeNoise.js';

// The mushroom cloud as ray-marched smoke. Two proxy cylinders, one round the head and one round
// the stem, are drawn from their front faces (back faces while the camera is inside one); each
// covered pixel sends a ray from the camera through the cylinder and sums smoke density on the
// way. Front faces keep the depth test honest: a sky dome or far wall behind the cloud would
// hide its back faces. The head is
// one vortex ring with a dome over it, the stem a column; a tileable noise wrapped round the
// ring in ring coordinates rolls with the circulation, so the whole ring turns as one body.
export const VOLUME_HEAD_NAME = 'reactor-volume-head_nocol_noshadow';
export const VOLUME_STEM_NAME = 'reactor-volume-stem_nocol_noshadow';
const HEAD_STEPS = 64;
const STEM_STEPS = 48;

// The proxy is a unit cylinder placed in world space here, from the same uniforms the rays use.
// Its object stays unit-sized, so it adds nothing to the cloud's measured bounds.
const VOLUME_VERTEX = /* glsl */`
uniform vec4 bounds;
uniform vec2 proxyAxis;
varying vec3 vWorld;
void main() {
    vWorld = vec3(proxyAxis.x + position.x * bounds.x, mix(bounds.y, bounds.z, position.y), proxyAxis.y + position.z * bounds.x);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const VOLUME_FRAGMENT = /* glsl */`
precision highp sampler3D;
uniform sampler3D volumeNoise;
uniform vec3 ringCenter;      // head axis x/z and ring-centre height
uniform vec4 ringShape;       // ring radius, rim half-width, rim half-height, dome height
uniform vec4 stemShape;       // base height, top height, radius at the foot, radius at the top
uniform vec4 bounds;          // cylinder radius, bottom, top, part (0 head, 1 stem)
uniform vec4 wind;            // x/z drift at the cloud top, cloud base height, cloud top height
uniform vec2 proxyAxis;       // x/z of the proxy cylinder's axis
uniform float insideProxy;    // 1 while the camera is inside the proxy (back faces drawn)
uniform float flowTurns;      // poloidal turns the ring has rolled
uniform float riseTravel;     // how far the stem's gas has risen, in stem radii
uniform float smokeDensity;   // overall density share (dissolve)
uniform float marchSteps;     // most steps a ray may take
uniform float stepTarget;     // step length that resolves the smoke's billows
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 smokeAlbedo;
uniform float heat;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec3 vWorld;

const float TAU = 6.28318530718;

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Shape coverage (1 deep inside, 0 outside) carved by billow noise: where coverage is thin only
// the noise's highest cells survive, so edges break into round billows instead of fading out.
float carve(float shape, float billow, float erosion) {
    float coverage = smoothstep(0.45, -0.55, shape);
    float cells = billow * 0.8 + 0.2;
    float density = clamp((cells - (1.0 - coverage)) / max(coverage, 0.05), 0.0, 1.0);
    return clamp(density - (1.0 - erosion) * 0.4 * (1.0 - coverage), 0.0, 1.0);
}

// Smoke density at a world point from the head's shape distance, in shape units.
float headDensity(vec3 p) {
    vec3 q = p - ringCenter;
    float r = length(q.xz);
    float R = ringShape.x, a = ringShape.y, b = ringShape.z, dome = ringShape.w;
    vec2 tube = vec2((r - R) / a, q.y / b);
    float ring = length(tube) - 1.0;
    // The dome closes the ring's hole from above; its underside stops at the ring's middle.
    // Narrower than the ring, so the rolled rim bulges out below it as the widest part.
    float domeBase = 0.1 * b;
    float lid = length(vec2(r / (R * 0.82), (q.y - domeBase) / max(1.0, dome - domeBase))) - 1.0;
    // Its underside is a soft bowl that rises towards the axis, where the stem is drawn in; a
    // flat cut showed from below as a bright disc.
    float floorY = domeBase - 0.3 * b + 0.7 * b * (1.0 - clamp(r / (R * 0.8), 0.0, 1.0));
    lid = max(lid, (floorY - q.y) / (1.5 * b));
    float shape = smin(ring, lid, 0.3);
    if (shape > 0.6) return 0.0;
    // Ring coordinates: round the axis, round the tube (rolling), and depth in the tube.
    float around = atan(q.z, q.x) / TAU;
    float roll = atan(q.y, r - R) / TAU + flowTurns;
    vec3 uvw = vec3(around * 8.0, roll * 2.0, length(tube) * 0.35);
    vec4 n = texture(volumeNoise, uvw);
    vec4 fine = texture(volumeNoise, p * 0.006 + vec3(0.0, flowTurns * 0.3, 0.0));
    vec4 micro = texture(volumeNoise, p * 0.021 + vec3(flowTurns * 0.5, 0.0, 0.0));
    float billow = n.r * 0.65 + fine.r * 0.35;
    float erosion = n.g * 0.3 + micro.g * 0.4 + micro.b * 0.3;
    return carve(shape, billow, erosion);
}

const float STEM_FAN = 0.9;

float stemDensity(vec3 p) {
    float h = clamp((p.y - stemShape.x) / max(1.0, stemShape.y - stemShape.x), 0.0, 1.0);
    float radius = mix(stemShape.z, stemShape.w, smoothstep(0.15, 0.85, h));
    // The column sways: its axis wanders slowly with height and time.
    vec2 sway = texture(volumeNoise, vec3(0.13, p.y * 0.0008 - riseTravel * 0.01, 0.61)).gb - 0.5;
    vec2 axis = p.xz - ringCenter.xz - sway * radius * 0.7;
    float r = length(axis);
    // It fans out into the head's underside, where the ring draws it in, and hands over to the
    // head's own smoke before its proxy ends.
    radius *= 1.0 + STEM_FAN * smoothstep(0.7, 0.95, h);
    // Soft top: a flat end at the proxy's lid showed as a bright disc under the head.
    float shape = r / radius - 1.0 + smoothstep(0.82, 1.0, h) * 1.6;
    if (shape > 0.6) return 0.0;
    float around = atan(axis.y, axis.x) / TAU;
    vec3 uvw = vec3(around * 4.0, (p.y - stemShape.x) / (radius * 3.0) - riseTravel * 0.3, r / radius * 0.4);
    vec4 n = texture(volumeNoise, uvw);
    vec4 fine = texture(volumeNoise, p * 0.01 - vec3(0.0, riseTravel * 0.1, 0.0));
    vec4 micro = texture(volumeNoise, p * 0.024 - vec3(0.0, riseTravel * 0.2, 0.0));
    float billow = n.r * 0.65 + fine.r * 0.35;
    return carve(shape, billow, fine.g * 0.3 + micro.g * 0.4 + micro.b * 0.3);
}

float densityAt(vec3 p) {
    // Upper winds shear the cloud: undo the drift at this height, then read the still shape.
    float h = clamp((p.y - wind.z) / max(1.0, wind.w - wind.z), 0.0, 1.0);
    p.xz -= wind.xy * pow(h, 1.5);
    return bounds.w < 0.5 ? headDensity(p) : stemDensity(p);
}

// Entry and exit distances of a ray through the vertical proxy cylinder.
vec2 cylinderSpan(vec3 ro, vec3 rd) {
    vec2 o = ro.xz - proxyAxis;
    float A = dot(rd.xz, rd.xz), B = dot(o, rd.xz), C = dot(o, o) - bounds.x * bounds.x;
    vec2 side = vec2(-1e9, 1e9);
    if (A > 1e-6) {
        float disc = max(0.0, B * B - A * C);
        side = vec2(-B - sqrt(disc), -B + sqrt(disc)) / A;
    }
    vec2 slab = vec2(-1e9, 1e9);
    if (abs(rd.y) > 1e-5) {
        float a = (bounds.y - ro.y) / rd.y, b = (bounds.z - ro.y) / rd.y;
        slab = vec2(min(a, b), max(a, b));
    }
    return vec2(max(0.0, max(side.x, slab.x)), min(side.y, slab.y));
}

void main() {
    if (gl_FrontFacing != (insideProxy < 0.5)) discard;
    vec3 ro = cameraPosition;
    vec3 toFace = vWorld - ro;
    float tFace = length(toFace);
    vec3 rd = toFace / tFace;
    vec2 span2 = cylinderSpan(ro, rd);
    // The drawn face bounds the ray on its side: the depth test has already cleared it.
    float tEnter = insideProxy > 0.5 ? span2.x : tFace;
    float tExit = insideProxy > 0.5 ? tFace : span2.y;
    if (tEnter >= tExit) discard;
    float span = tExit - tEnter;
    // As many steps as the chord needs at the target length, within the budget.
    float steps = clamp(ceil(span / stepTarget), 4.0, marchSteps);
    float stepLength = span / steps;
    // White-noise jitter per pixel: banding turns into fine grain. Interleaved gradient noise
    // left a visible cross-hatch at these step counts.
    float jitter = 0.2 + 0.6 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float transmittance = 1.0;
    vec3 light = vec3(0.0);
    float firstHit = -1.0;
    // Thick smoke stays opaque at a fraction of its density; the power lets a thin rest look thin.
    float extinction = 0.07 * pow(smokeDensity, 1.35);
    float heightSpan = max(1.0, bounds.z - bounds.y);
    for (int i = 0; i < 64; i++) {
        if (float(i) >= steps || transmittance < 0.02) break;
        float t = tEnter + (float(i) + jitter) * stepLength;
        vec3 p = ro + rd * t;
        float rho = densityAt(p);
        if (rho <= 0.001) continue;
        if (firstHit < 0.0) firstHit = t;
        // Light from the sun through two samples of the smoke towards it.
        float toSun = densityAt(p + sunDirection * 25.0) * 25.0 + densityAt(p + sunDirection * 70.0) * 45.0;
        float sunLight = exp(-toSun * extinction * 2.4);
        // Thin edges scatter forward light, thick cores do not: the "powder" darkening.
        float powder = 1.0 - exp(-rho * 4.0);
        float up = clamp((p.y - bounds.y) / heightSpan, 0.0, 1.0);
        vec3 ambient = skyColor * (0.18 + 0.62 * up);
        vec3 color = smokeAlbedo * (sunColor * sunLight * mix(0.5, 1.0, powder) * 1.5 + ambient * 0.45);
        // While hot the lower, inner smoke glows from the fireball's heat.
        color += vec3(1.0, 0.32, 0.06) * heat * rho * rho * (1.0 - up) * (1.0 - up) * 0.6;
        float absorbed = 1.0 - exp(-rho * extinction * stepLength);
        light += transmittance * absorbed * color;
        transmittance *= 1.0 - absorbed;
    }
    float alpha = 1.0 - transmittance;
    if (alpha < 0.003) discard;
    vec3 color = light / alpha;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #ifdef USE_FOG
    // Aerial perspective at the smoke's first hit, partly: the map fog is set for play distances.
    float fogDepth = firstHit < 0.0 ? tExit : firstHit;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar, fogDepth) * 0.4);
    #endif
}
`;

function createPart(part, steps, noise) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            volumeNoise: { value: noise },
            ringCenter: { value: new THREE.Vector3() }, ringShape: { value: new THREE.Vector4() },
            stemShape: { value: new THREE.Vector4() }, bounds: { value: new THREE.Vector4(1, 0, 1, part) },
            wind: { value: new THREE.Vector4() }, proxyAxis: { value: new THREE.Vector2() }, insideProxy: { value: 0 },
            flowTurns: { value: 0 }, riseTravel: { value: 0 }, smokeDensity: { value: 1 },
            marchSteps: { value: steps }, stepTarget: { value: 10 },
            sunDirection: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 1, 1) },
            skyColor: { value: new THREE.Color(0.62, 0.68, 0.75) }, smokeAlbedo: { value: new THREE.Color(0.4, 0.33, 0.26) },
            heat: { value: 0 },
        },
        vertexShader: VOLUME_VERTEX, fragmentShader: VOLUME_FRAGMENT,
        // Both sides, one discarded per camera: switching `side` would compile a second program
        // the first time a camera flies into the cloud.
        side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: true, fog: true,
    });
    // A unit cylinder standing on its base; the proxy is resized in world space every frame.
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 24, 1, false);
    geometry.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = part === 0 ? VOLUME_HEAD_NAME : VOLUME_STEM_NAME;
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * Adds the two volume proxies to `root`. `update(state)` takes the head and stem shape of the
 * frame in world space: { x, z, ringY, radius, rimWidth, rimHeight, dome (above the ring
 * centre), top, base, stemTop, stemRadiusLow, stemRadiusHigh, windX, windZ (drift at the top),
 * flowTurns, riseTravel, density, heat, albedo, sunDirection, sunColor }.
 */
export function createReactorVolume(root) {
    const noise = getVolumeNoiseTexture();
    const head = createPart(0, HEAD_STEPS, noise);
    const stem = createPart(1, STEM_STEPS, noise);
    root.add(head, stem);
    const place = (mesh, radius, bottom, top, x, z) => {
        mesh.material.uniforms.proxyAxis.value.set(x, z);
        mesh.material.uniforms.bounds.value.set(radius, bottom, Math.max(bottom + 0.01, top), mesh === head ? 0 : 1);
    };
    const update = (state) => {
        // Never hidden: a hidden mesh gets no onBeforeRender, so it could not come back. An empty
        // cloud draws nothing, the shader discards every pixel of its tiny proxies.
        // Proxies follow the wind: the head's to its drift at the ring, the stem's widens over it.
        const span = Math.max(1, state.top - state.base);
        const ringShear = Math.pow(Math.min(1, Math.max(0, (state.ringY - state.base) / span)), 1.5);
        const drift = Math.hypot(state.windX, state.windZ);
        const reach = state.radius + state.rimWidth * 1.5 + drift * (1 - ringShear);
        place(head, reach, state.ringY - state.rimHeight * 1.6, state.top,
            state.x + state.windX * ringShear, state.z + state.windZ * ringShear);
        // Room for the fan under the head (STEM_FAN in the shader), its sway and the noise.
        const stemReach = Math.max(state.stemRadiusLow, state.stemRadiusHigh * 2.2) * 1.5 + drift * ringShear * 0.5;
        // The stem reaches into the head's underside, so the two volumes overlap there.
        place(stem, stemReach, state.base, state.ringY + state.rimHeight * 0.4,
            state.x + state.windX * ringShear * 0.5, state.z + state.windZ * ringShear * 0.5);
        for (const mesh of [head, stem]) {
            const u = mesh.material.uniforms;
            u.ringCenter.value.set(state.x, state.ringY, state.z);
            u.ringShape.value.set(state.radius, state.rimWidth, state.rimHeight, state.dome);
            u.stemShape.value.set(state.base, state.stemTop, state.stemRadiusLow, state.stemRadiusHigh);
            u.wind.value.set(state.windX, state.windZ, state.base, state.top);
            // A fifth of the rim's height in the head, a quarter of the stem's radius in the stem.
            u.stepTarget.value = Math.max(2, mesh === head ? state.rimHeight * 0.2 : state.stemRadiusHigh * 0.25);
            u.flowTurns.value = state.flowTurns;
            u.riseTravel.value = state.riseTravel;
            u.smokeDensity.value = state.density;
            u.heat.value = state.heat;
            u.smokeAlbedo.value.copy(state.albedo);
            u.sunDirection.value.copy(state.sunDirection);
            u.sunColor.value.copy(state.sunColor);
        }
    };
    /** Collapses both proxies, for the quality step that draws the card cloud instead. */
    const silence = () => {
        for (const mesh of [head, stem]) {
            mesh.material.uniforms.bounds.value.set(0, 0, 0, mesh === head ? 0 : 1);
            mesh.material.uniforms.smokeDensity.value = 0;
        }
    };

    /** Per camera: front faces from outside, back faces from inside the proxy. */
    const faceCamera = (mesh, camera) => {
        const b = mesh.material.uniforms.bounds.value;
        const axis = mesh.material.uniforms.proxyAxis.value;
        const p = camera.position;
        // Inside also when the near plane would clip the front faces away.
        const margin = (camera.near || 0.1) * 2;
        const inside = Math.hypot(p.x - axis.x, p.z - axis.y) < b.x + margin && p.y > b.y - margin && p.y < b.z + margin;
        mesh.material.uniforms.insideProxy.value = inside ? 1 : 0;
    };
    return { head, stem, update, faceCamera, silence };
}

