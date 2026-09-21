import * as THREE from 'three';
import { createVortexCards, resolveVortexProfile, smoothRange, updateVortexCard } from './ReactorVortexFlow.js';
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
    const roll = root.getObjectByName('roll');
    const stem = root.getObjectByName('stem');
    const profile = resolveVortexProfile(Number(roll?.userData?.vortexProfile));
    const cards = [];
    for (const lobe of lobes) {
        for (let detail = 0; detail < 2 && cards.length < MAX_SMOKE_CARDS; detail++) {
            cards.push({ lobe, detail, index: cards.length, center: new THREE.Vector3(),
                width: 0, height: 0, depth: 0, opacity: 0, angle: 0, glow: 0, tint: 1 });
        }
    }
    cards.push(...createVortexCards(lobes.find(({ column }) => !column) || lobes[0], cards.length).slice(0, MAX_SMOKE_CARDS - cards.length));
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
    const rollPosition = new THREE.Vector3(), rollScale = new THREE.Vector3(), stemScale = new THREE.Vector3();
    const shape = { x: 0, z: 0, base: 0, height: 0, radius: 0, tubeRadius: 0, tubeHeight: 0, stemRadius: 0 };
    const scratch = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
    const compareDepth = (a, b) => a.depth - b.depth;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
        const time = Math.max(0, action.time);
        const settle = Math.min(1, Math.max(0, (time - .18) / 1.4));
        material.uniforms.heat.value = 1.5 * Math.exp(-time * .65 * profile.cooling);
        top.set(0, topMetres, 0).applyMatrix4(root.matrixWorld);
        base.set(0, 0, 0).applyMatrix4(root.matrixWorld);
        material.uniforms.cloudTop.value = top.y;
        material.uniforms.cloudBase.value = base.y;
        const view = camera.matrixWorldInverse.elements;
        roll.getWorldPosition(rollPosition); roll.getWorldScale(rollScale); stem.getWorldScale(stemScale);
        const tube = Number(roll.userData.vortexTubeRatio) || .26;
        shape.x = rollPosition.x; shape.z = rollPosition.z; shape.base = base.y;
        shape.height = rollPosition.y; shape.radius = .9 * rollScale.x;
        shape.tubeRadius = tube * rollScale.x; shape.tubeHeight = tube * rollScale.y;
        shape.stemRadius = stemScale.x;
        const distance = camera.position.distanceTo(rollPosition);
        const detailVisibility = 1 - smoothRange(8,18,distance / Math.max(20,shape.radius));
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
            const cycle = time*.25 + index*1.7;
            const stretch = 1 + (detail ? .22 : .12) * Math.sin(cycle) * (1 + profile.turbulence);
            card.width /= Math.sqrt(stretch); card.height *= stretch;
            card.angle = lobe.column ? 0 : Math.sin(index*1.7)*.5 + time*.04*(detail ? 1 : -1);
            card.opacity = detail ? .36 : (/cap|bloom/.test(lobe.node.name) ? .72 : .84);
            card.glow = .35 + .65 * (Math.sin(index*2.1)*.5+.5);
            card.tint = 1;
            if (detail) {
                // Fine surface wisps drift upwards on the column; the independent
                // stream cards provide the continuous column-to-ring path.
                card.center.y += Math.sin(cycle) * card.height * .16;
                card.center.x += profile.turbulence * Math.sin(cycle*.7) * card.width * .15;
            }
            if (card.flow) {
                updateVortexCard(card, time, profile, shape, scratch);
                if (card.flow === 'stream') {
                    const vx = view[0]*scratch.tx+view[4]*scratch.ty+view[8]*scratch.tz;
                    const vy = view[1]*scratch.tx+view[5]*scratch.ty+view[9]*scratch.tz;
                    card.angle = Math.atan2(vy,vx)-Math.PI/2;
                }
            }
            card.opacity *= settle * (detail ? detailVisibility : 1);
            // Fit the soft lobe below the authored ceiling before shading, avoiding
            // a flat clipping plane at the top of the final mushroom cloud.
            const reach = .48 * Math.hypot(card.width, card.height);
            const fit = Math.min(1, Math.max(0, top.y - card.center.y) / Math.max(.001, reach));
            card.width *= fit; card.height *= fit;
            card.depth = view[2]*card.center.x+view[6]*card.center.y+view[10]*card.center.z+view[14];
        }
        cards.sort(compareDepth); // back to front, independently for each split-screen camera
        data.fill(0);
        let written = 0;
        for (const card of cards) {
            const { lobe, index, center, width, height } = card;
            if (card.opacity < .003 || width < .005 || height < .005) continue;
            const offset = written++ * 16;
            data[offset] = center.x; data[offset+1] = center.y; data[offset+2] = center.z;

            data[offset+4] = width; data[offset+5] = height;
            data[offset+6] = card.angle;
            data[offset+7] = index%4+Math.min(.98,card.opacity);
            data[offset+11] = card.glow;
            const tint = (.80 + .20 * Math.exp(-time*.09)) * card.tint;
            data[offset+8] = (lobe.color.r*.65+.24)*tint;
            data[offset+9] = (lobe.color.g*.65+.24)*tint;
            data[offset+10] = (lobe.color.b*.65+.24)*tint;
        }
        // Uniform textures upload after onBeforeRender; ordinary attributes already
        // uploaded during scene projection would lag a seek or the second camera.
        geometry.instanceCount = written;
        smokeData.needsUpdate = true;
    };
    return mesh;
}
