import * as THREE from 'three';
import { collectSmokeLobes, SMOKE_VERTEX, SMOKE_FRAGMENT } from './ReactorSmokeGeometry.js';

const ATLAS_URL = new URL('../../../assets/vfx/torus-explosions/smoke/smoke-atlas.png', import.meta.url).href;
export const MAX_SMOKE_CARDS = 512;

export async function attachReactorSmoke(root, action, { loadTexture = () => new THREE.TextureLoader().loadAsync(ATLAS_URL) } = {}) {
    if (!action || !root.getObjectByName('torus_flow_00')) return null;
    const texture = await loadTexture();
    texture.colorSpace = THREE.SRGBColorSpace;
    return createReactorSmoke(root, action, texture);
}

export function createReactorSmoke(root, action, texture) {
    const lobes = collectSmokeLobes(root);
    if (!lobes.length) { texture.dispose(); return null; }
    const previousTime = action.time;
    action.time = Math.max(0, action.getClip().duration - .001);
    action.getMixer().update(0); root.updateWorldMatrix(true, true);
    const inverseRoot = root.matrixWorld.clone().invert();
    const vertex = new THREE.Vector3();
    let topMetres = 0;
    const nodes = new Set(lobes.map(({ node }) => node));
    for (const node of nodes) {
        const positions = node.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).applyMatrix4(inverseRoot);
            topMetres = Math.max(topMetres, vertex.y);
        }
    }
    action.time = previousTime; action.getMixer().update(0); root.updateWorldMatrix(true, true);
    const cards = [];
    for (const lobe of lobes) {
        for (let detail = 0; detail < 2 && cards.length < MAX_SMOKE_CARDS; detail++) {
            cards.push({ lobe, detail, index: cards.length, center: new THREE.Vector3(),
                width: 0, height: 0, depth: 0 });
        }
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index; geometry.attributes.position = quad.attributes.position;
    geometry.attributes.uv = quad.attributes.uv;
    const data = new Float32Array(cards.length * 16);
    const rows = new Float32Array(cards.length);
    for (let i = 0; i < cards.length; i++) rows[i] = (i + .5) / cards.length;
    geometry.setAttribute('smokeRow', new THREE.InstancedBufferAttribute(rows, 1));
    const smokeData = new THREE.DataTexture(data, 4, cards.length, THREE.RGBAFormat, THREE.FloatType);
    smokeData.needsUpdate = true;
    geometry.instanceCount = cards.length;
    // Vertices are expanded in world space by the shader; the carrier quad is
    // neither a physical surface nor an addition to the authored map bounds.
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
    const material = new THREE.ShaderMaterial({
        uniforms: { smokeData: { value: smokeData }, smokeAtlas: { value: texture }, heat: { value: 0 }, cloudTop: { value: 0 }, cloudBase: { value: 0 } },
        vertexShader: SMOKE_VERTEX, fragmentShader: SMOKE_FRAGMENT,
        transparent: true, depthWrite: false, depthTest: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'reactor-soft-smoke_nocol_noshadow'; mesh.frustumCulled = false;
    mesh.userData.smokeCardCount = cards.length;
    // The GLB remains the animation/collision source and the fallback if texture
    // loading fails. Suppress only its smoke surfaces after a successful bake load.
    for (const { node } of lobes) node.material.visible = false;
    root.add(mesh);
    const top = new THREE.Vector3();
    const base = new THREE.Vector3();
    const size = new THREE.Vector3();
    const compareDepth = (a, b) => a.depth - b.depth;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
        const time = Math.max(0, action.time);
        const settle = Math.min(1, Math.max(0, (time - .18) / 1.4));
        material.uniforms.heat.value = 1.5 * Math.exp(-time * .65);
        top.set(0, topMetres, 0).applyMatrix4(root.matrixWorld);
        base.set(0, 0, 0).applyMatrix4(root.matrixWorld);
        material.uniforms.cloudTop.value = top.y;
        material.uniforms.cloudBase.value = base.y;
        const view = camera.matrixWorldInverse.elements;
        for (const card of cards) {
            const { lobe, index, detail } = card;
            const m = lobe.node.matrixWorld.elements;
            card.center.copy(lobe.center).applyMatrix4(lobe.node.matrixWorld);
            // World extents follow rotation as well as non-uniform rig scale.
            size.set(Math.abs(m[0])*lobe.size.x+Math.abs(m[4])*lobe.size.y+Math.abs(m[8])*lobe.size.z,
                Math.abs(m[1])*lobe.size.x+Math.abs(m[5])*lobe.size.y+Math.abs(m[9])*lobe.size.z,
                Math.abs(m[2])*lobe.size.x+Math.abs(m[6])*lobe.size.y+Math.abs(m[10])*lobe.size.z);
            const scale = detail ? .85 : 1.65;
            card.width = Math.max(size.x,size.z) * scale;
            card.height = Math.max(size.y, Math.min(size.x,size.z)*.7) * scale;
            if (detail) {
                card.center.x += Math.sin(index * 2.4 + time * .16) * card.width * .16;
                card.center.y += Math.sin(index + time * .27) * card.height * .18;
            }
            // Fit the soft lobe below the authored ceiling before shading, avoiding
            // a flat clipping plane at the top of the final mushroom cloud.
            const reach = .48 * Math.hypot(card.width, card.height);
            const fit = Math.min(1, Math.max(0, top.y - card.center.y) / Math.max(.001, reach));
            card.width *= fit; card.height *= fit;
            card.depth = view[2]*card.center.x+view[6]*card.center.y+view[10]*card.center.z+view[14];
        }
        cards.sort(compareDepth); // back to front, independently for each split-screen camera
        for (let i = 0; i < cards.length; i++) {
            const { lobe, detail, index, center, width, height } = cards[i];
            const offset = i * 16;
            data[offset] = center.x; data[offset+1] = center.y; data[offset+2] = center.z;
            const opacity = (detail ? .38 : .88) * settle;
            data[offset+4] = width; data[offset+5] = height;
            data[offset+6] = lobe.column ? 0 : Math.sin(index*1.7)*.7+time*.025*(detail ? 1 : -1);
            data[offset+7] = index%4+opacity;
            const tint = .80 + .20 * Math.exp(-time*.09);
            data[offset+8] = (lobe.color.r*.65+.24)*tint;
            data[offset+9] = (lobe.color.g*.65+.24)*tint;
            data[offset+10] = (lobe.color.b*.65+.24)*tint;
        }
        // Uniform textures upload after onBeforeRender; ordinary attributes already
        // uploaded during scene projection would lag a seek or the second camera.
        smokeData.needsUpdate = true;
    };
    return mesh;
}
