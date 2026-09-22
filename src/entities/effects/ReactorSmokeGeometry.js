import * as THREE from 'three';
import { FOG_FACTOR_GLSL } from './ReactorFireballEffect.js';

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
uniform float cloudTop;
uniform float cloudBase;
uniform vec4 fireLight;
uniform float fireGlow;
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
    vec4 mvPosition = viewPosition;
    gl_Position = projectionMatrix * viewPosition;
    #include <fog_vertex>
}
`;

export const SMOKE_FRAGMENT = /* glsl */`
uniform sampler2D smokeAtlas;
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
#include <fog_pars_fragment>
${FOG_FACTOR_GLSL}
void main() {
    // Tile selection is encoded in the integer part of alpha; fractional alpha
    // remains independent, and padded tiles cannot bleed into neighbouring lobes.
    if (fract(vSmokeAlpha) < .003) discard;
    float tile = floor(vSmokeAlpha);
    vec2 tileOffset = vec2(mod(tile,2.0),floor(tile/2.0));
    vec2 fold = vec2(sin(vSmokeUv.y*19.0+smokeTime*.35+tile),sin(vSmokeUv.x*16.0-smokeTime*.23));
    vec2 smokeUv = vSmokeUv + fold*.035*sin(vSmokeUv.x*3.14159)*sin(vSmokeUv.y*3.14159);
    vec4 smoke = texture2D(smokeAtlas,(tileOffset + clamp(smokeUv,.004,.996))*.5);
    float alpha = smoke.a * fract(vSmokeAlpha) * smoothstep(2.0,14.0,vSmokeDepth);
    alpha *= smoothstep(cloudBase,cloudBase+18.0,vWorldHeight);
    alpha *= 1.0-smoothstep(cloudTop-7.0,cloudTop,vWorldHeight);
    if (alpha < .003) discard;
    vec3 albedo = smoke.rgb * vSmokeColor * 1.7;
    vec3 color = albedo * vSmokeLight;
    // The fireball lights the smoke nearest to it, above all the underside of the cap.
    color += albedo * vec3(1.0,.45,.12) * vFireLit * 1.6;
    // The sRGB atlas decodes to roughly .05-.29 linear brightness.
    float ember = smoothstep(.07,.22,smoke.r) * smoke.a;
    color += vec3(1.0,.23,.025) * heat * vSmokeHeat * ember * .8;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Aerial perspective, but only partly: map fog is set for gameplay distances and would
    // swallow a cloud that real haze leaves standing on the horizon.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, reactorFogFactor() * .4);
}
`;
