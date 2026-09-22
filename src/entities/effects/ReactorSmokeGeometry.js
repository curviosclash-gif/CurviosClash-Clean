import * as THREE from 'three';
import { FOG_FACTOR_GLSL } from './ReactorFireballEffect.js';

// Atlas rows, counted from the bottom (see scripts/bake_reactor_smoke.py).
export const SMOKE_TILE_FAMILY = Object.freeze({ billow: 0, column: 1, wisp: 2, holed: 3 });

/** Atlas tile 0-15 for a card: the family follows its role, the variant its index. */
export function resolveSmokeTile(card) {
    // The head skin is closed billowing smoke; the other flows are thin wisps.
    const family = card.flow === 'head' ? SMOKE_TILE_FAMILY.billow
        : card.flow ? SMOKE_TILE_FAMILY.wisp
        : card.lobe?.column ? SMOKE_TILE_FAMILY.column
            : card.detail ? SMOKE_TILE_FAMILY.holed
                : SMOKE_TILE_FAMILY.billow;
    return family * 4 + (card.index % 4);
}

const DEFAULT_SUN = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
const DEFAULT_SUN_COLOR = new THREE.Color(1, 0.97, 0.92);
const SUN_REFERENCE_INTENSITY = 1.35;
const sunPosition = new THREE.Vector3();
const sunTarget = new THREE.Vector3();

/**
 * Direction towards the brightest directional light of the scene and its colour, so smoke
 * takes the map's own sun without the effect reaching into the renderer. Returns false and
 * a fixed high sun when the scene has none. A `cache` object keeps the found light, so the
 * scene is searched again only when that light leaves it, or every 300 calls.
 */
export function resolveSmokeSun(scene, direction, color, cache = null) {
    let sun = cache && cache.scene === scene && cache.light?.parent && cache.age++ < 300 ? cache.light : null;
    if (!sun) {
        scene?.traverseVisible?.((node) => {
            if (node.isDirectionalLight && node.intensity > (sun?.intensity ?? 0)) sun = node;
        });
        if (cache) { cache.scene = scene; cache.light = sun; cache.age = 0; }
    }
    if (!sun) {
        direction.copy(DEFAULT_SUN); color.copy(DEFAULT_SUN_COLOR);
        return false;
    }
    sun.getWorldPosition(sunPosition);
    sun.target.getWorldPosition(sunTarget);
    direction.subVectors(sunPosition, sunTarget);
    if (direction.lengthSq() < 1e-12) direction.copy(DEFAULT_SUN); else direction.normalize();
    color.copy(sun.color).multiplyScalar(Math.min(1.5, Math.max(0.3, sun.intensity / SUN_REFERENCE_INTENSITY)));
    return true;
}

// Connected lobes are recovered once from the exported mesh, so smoke follows the
// authored torus pivots rather than duplicating their animation in another clock.
export function collectSmokeLobes(root) {
    const lobes = [];
    root.traverse((node) => {
        if (!node.isMesh || !/^Cloud(?:Dark)?$/.test(node.material?.name || '')) return;
        const geometry = node.geometry;
        const positions = geometry.attributes.position;
        const parents = new Int32Array(positions.count);
        for (let i = 0; i < parents.length; i++) parents[i] = i;
        const find = (i) => {
            while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
            return i;
        };
        const indices = geometry.index;
        for (let i = 0; i < (indices?.count || positions.count); i += 3) {
            const a = indices ? indices.getX(i) : i;
            const b = indices ? indices.getX(i + 1) : i + 1;
            const c = indices ? indices.getX(i + 2) : i + 2;
            parents[find(b)] = find(a); parents[find(c)] = find(a);
        }
        const groups = new Map();
        const point = new THREE.Vector3();
        for (let i = 0; i < positions.count; i++) {
            const id = find(i);
            if (!groups.has(id)) groups.set(id, new THREE.Box3());
            groups.get(id).expandByPoint(point.fromBufferAttribute(positions, i));
        }
        for (const bounds of groups.values()) {
            lobes.push({ node, center: bounds.getCenter(new THREE.Vector3()),
                size: bounds.getSize(new THREE.Vector3()), color: node.material.color.clone(),
                column: /stem|plume/.test(node.name) });
        }
    });
    return lobes;
}

export const SMOKE_VERTEX = /* glsl */`
attribute float smokeRow;
uniform sampler2D smokeData;
varying vec2 vSmokeUv;
varying vec3 vSmokeColor;
varying float vSmokeAlpha;
varying float vWorldHeight;
varying float vSmokeHeat;
varying float vSmokeDepth;
varying float vSmokeLight;
varying float vFireLit;
varying vec3 vSunLocal;
uniform float cloudTop;
uniform float cloudBase;
uniform vec4 fireLight;
uniform float fireGlow;
uniform vec3 sunDirection;
#include <fog_pars_vertex>
void main() {
    vec4 smokeCenter = texture2D(smokeData,vec2(.125,smokeRow));
    vec4 smokeShape = texture2D(smokeData,vec2(.375,smokeRow));
    vec3 smokeColor = texture2D(smokeData,vec2(.625,smokeRow)).rgb;
    float c = cos(smokeShape.z), s = sin(smokeShape.z);
    vSmokeUv = uv;
    vSmokeColor = smokeColor;
    vSmokeHeat = texture2D(smokeData,vec2(.625,smokeRow)).a;
    vSmokeLight = texture2D(smokeData,vec2(.875,smokeRow)).r;
    vSmokeAlpha = smokeShape.w;
    vec2 p = position.xy * smokeShape.xy;
    vec2 rotated = vec2(p.x*c-p.y*s,p.x*s+p.y*c);
    vec4 center = viewMatrix * vec4(smokeCenter.xyz, 1.0);
    vec4 viewPosition = center + vec4(rotated, 0.0, 0.0);
    vWorldHeight = smokeCenter.y + rotated.x * viewMatrix[1][0] + rotated.y * viewMatrix[1][1];
    vSmokeDepth = -viewPosition.z;
    // The camera's right and up axes turn the billboard offset back into world space.
    vec3 worldPosition = smokeCenter.xyz
        + rotated.x * vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0])
        + rotated.y * vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 toFire = worldPosition - fireLight.xyz;
    float reach = 2.5 * fireLight.w * fireLight.w;
    vFireLit = fireGlow * reach / (reach + dot(toFire, toFire));
    // The sun in the card's own turned frame: x along its right edge, y along its up edge,
    // z towards the camera. The six baked lights are mixed by these three components.
    vec3 sunView = (viewMatrix * vec4(sunDirection, 0.0)).xyz;
    vSunLocal = vec3(dot(sunView.xy, vec2(c, s)), dot(sunView.xy, vec2(-s, c)), sunView.z);
    vec4 mvPosition = viewPosition;
    gl_Position = projectionMatrix * viewPosition;
    #include <fog_vertex>
}
`;

export const SMOKE_FRAGMENT = /* glsl */`
uniform sampler2D smokeLightA;
uniform sampler2D smokeLightB;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform float cloudTop;
uniform float cloudBase;
uniform float heat;
uniform float smokeTime;
varying vec2 vSmokeUv;
varying vec3 vSmokeColor;
varying float vSmokeAlpha;
varying float vWorldHeight;
varying float vSmokeHeat;
varying float vSmokeDepth;
varying float vSmokeLight;
varying float vFireLit;
varying vec3 vSunLocal;
#include <fog_pars_fragment>
${FOG_FACTOR_GLSL}
void main() {
    // Tile selection is encoded in the integer part of alpha; fractional alpha
    // remains independent, and padded tiles cannot bleed into neighbouring lobes.
    if (fract(vSmokeAlpha) < .003) discard;
    float tile = floor(vSmokeAlpha);
    vec2 tileOffset = vec2(mod(tile, 4.0), floor(tile / 4.0));
    vec2 fold = vec2(sin(vSmokeUv.y*19.0+smokeTime*.35+tile),sin(vSmokeUv.x*16.0-smokeTime*.23));
    vec2 smokeUv = vSmokeUv + fold*.035*sin(vSmokeUv.x*3.14159)*sin(vSmokeUv.y*3.14159);
    vec2 atlasUv = (tileOffset + clamp(smokeUv,.004,.996))*.25;
    // A: lit from right, top, back. B: lit from left, bottom, front. Alpha is the same in both.
    vec4 lightA = texture2D(smokeLightA, atlasUv);
    vec4 lightB = texture2D(smokeLightB, atlasUv);
    float alpha = lightA.a * fract(vSmokeAlpha) * smoothstep(2.0,14.0,vSmokeDepth);
    alpha *= smoothstep(cloudBase,cloudBase+18.0,vWorldHeight);
    alpha *= 1.0-smoothstep(cloudTop-7.0,cloudTop,vWorldHeight);
    if (alpha < .003) discard;
    // Six-way light: squared components weigh the baked light of each side, so a unit sun
    // direction always sums to one and the lit face follows the sun however the card turns.
    vec3 sun = normalize(vSunLocal);
    vec3 weight = sun * sun;
    float direct = weight.x * (sun.x > 0.0 ? lightA.r : lightB.r)
        + weight.y * (sun.y > 0.0 ? lightA.g : lightB.g)
        + weight.z * (sun.z > 0.0 ? lightB.b : lightA.b);
    // The mean of all six stands in for the open sky: thick cores stay darker than thin edges.
    float ambient = (lightA.r + lightA.g + lightA.b + lightB.r + lightB.g + lightB.b) / 6.0;
    vec3 albedo = vSmokeColor * 1.7;
    vec3 color = albedo * (sunColor * direct * 2.1 + skyColor * ambient * .4) * mix(1.0, vSmokeLight, .35);
    // The fireball lights the smoke nearest to it, above all the underside of the cap.
    color += albedo * ambient * vec3(1.0,.45,.12) * vFireLit * 1.6;
    // Glow sits in the dense core of a parcel, where the smoke is thickest. A wide ramp: a
    // narrow one cut each core out as a sharp-edged orange patch.
    float ember = smoothstep(.25,1.0,lightA.a) * lightA.a;
    color += vec3(1.0,.23,.025) * heat * vSmokeHeat * ember * .8;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Aerial perspective, but only partly: map fog is set for gameplay distances and would
    // swallow a cloud that real haze leaves standing on the horizon.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, reactorFogFactor() * .4);
}
`;
