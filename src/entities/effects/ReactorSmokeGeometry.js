import * as THREE from 'three';

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
uniform float cloudTop;
uniform float cloudBase;
void main() {
    vec4 smokeCenter = texture2D(smokeData,vec2(.125,smokeRow));
    vec4 smokeShape = texture2D(smokeData,vec2(.375,smokeRow));
    vec3 smokeColor = texture2D(smokeData,vec2(.625,smokeRow)).rgb;
    float c = cos(smokeShape.z), s = sin(smokeShape.z);
    vSmokeUv = uv;
    vSmokeColor = smokeColor;
    vSmokeAlpha = smokeShape.w;
    vec2 p = position.xy * smokeShape.xy;
    vec2 rotated = vec2(p.x*c-p.y*s,p.x*s+p.y*c);
    vec4 center = viewMatrix * vec4(smokeCenter.xyz, 1.0);
    vec4 viewPosition = center + vec4(rotated, 0.0, 0.0);
    vWorldHeight = smokeCenter.y + rotated.x * viewMatrix[1][0] + rotated.y * viewMatrix[1][1];
    gl_Position = projectionMatrix * viewPosition;
}
`;

export const SMOKE_FRAGMENT = /* glsl */`
uniform sampler2D smokeAtlas;
uniform float cloudTop;
uniform float cloudBase;
uniform float heat;
varying vec2 vSmokeUv;
varying vec3 vSmokeColor;
varying float vSmokeAlpha;
varying float vWorldHeight;
void main() {
    // Tile selection is encoded in the integer part of alpha; fractional alpha
    // remains independent, and padded tiles cannot bleed into neighbouring lobes.
    float tile = floor(vSmokeAlpha);
    vec2 tileOffset = vec2(mod(tile,2.0),floor(tile/2.0));
    vec4 smoke = texture2D(smokeAtlas,(tileOffset + clamp(vSmokeUv,.004,.996))*.5);
    float alpha = smoke.a * fract(vSmokeAlpha);
    alpha *= smoothstep(cloudBase,cloudBase+5.0,vWorldHeight);
    alpha *= 1.0-smoothstep(cloudTop-7.0,cloudTop,vWorldHeight);
    if (alpha < .003) discard;
    vec3 color = smoke.rgb * vSmokeColor * 1.65;
    color += vec3(1.0,.20,.018) * heat * smoke.a * .45;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;
