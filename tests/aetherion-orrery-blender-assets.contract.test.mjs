import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve('assets/maps/aetherion_orrery');
const TOTAL_GLB_BUDGET = 5 * 1024 * 1024;
const TOTAL_TRIANGLE_BUDGET = 75_000;

const ASSETS = Object.freeze({
    '01_stellar_foundry': { animated: false, landmarks: ['foundry_furnace_nocol', 'foundry_drive_tooth_0_nocol'] },
    '02_meridian_gallery': { animated: false, landmarks: ['gallery_vertical_orbit_a_nocol', 'gallery_meridian_needle_nocol'] },
    '03_eclipse_crown': { animated: false, landmarks: ['crown_eclipse_disc_nocol', 'crown_spire_0_nocol'] },
    '04_outer_arcades': { animated: false, landmarks: ['arcade_safe_ribbon_0_nocol', 'arcade_direction_0_nocol'] },
    '05_meridian_bridges': { clip: 'MeridianBridgeLoop', duration: 24, landmark: 'meridian_bridge_collision' },
    '06_astrolabe_gate': { clip: 'AstrolabeGateLoop', duration: 36, landmark: 'astrolabe_bar_0' },
    '07_eclipse_iris': { clip: 'EclipseIrisLoop', duration: 12, landmark: 'eclipse_blade_0' },
    '08_comet_pendulum': { clip: 'CometPendulumLoop', duration: 24, landmark: 'comet_stem_0' },
    '09_zodiac_louvre': { clip: 'ZodiacLouvreLoop', duration: 12, landmark: 'zodiac_slat_0' },
    '10_celestial_core': { clip: 'CelestialCoreLoop', duration: 36, visualOnly: true, landmark: 'celestial_star_nocol' },
});

function readGlb(filePath) {
    const bytes = readFileSync(filePath);
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    const binaryHeader = 20 + jsonLength;
    const binaryLength = bytes.readUInt32LE(binaryHeader);
    assert.equal(bytes.readUInt32LE(binaryHeader + 4), 0x004e4942);
    Object.defineProperty(document, '_binary', {
        value: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength),
    });
    return document;
}

const COMPONENTS_BY_TYPE = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 });

function floatAccessor(document, accessorIndex) {
    const accessor = document.accessors[accessorIndex];
    assert.equal(accessor.componentType, 5126, 'animation accessor uses float components');
    const view = document.bufferViews[accessor.bufferView];
    const components = COMPONENTS_BY_TYPE[accessor.type];
    const stride = view.byteStride || components * 4;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    return Array.from({ length: accessor.count }, (_, index) => (
        Array.from({ length: components }, (_, component) => (
            document._binary.readFloatLE(start + index * stride + component * 4)
        ))
    ));
}

function animationValues(document, nodeName, pathName) {
    const nodeIndex = document.nodes.findIndex((node) => node.name === nodeName);
    assert.ok(nodeIndex >= 0, `${nodeName} exists`);
    const animation = document.animations[0];
    const channel = animation.channels.find((entry) => (
        entry.target.node === nodeIndex && entry.target.path === pathName
    ));
    assert.ok(channel, `${nodeName} animates ${pathName}`);
    return floatAccessor(document, animation.samplers[channel.sampler].output);
}

function triangles(document) {
    let count = 0;
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const accessor = primitive.indices ?? primitive.attributes?.POSITION;
            count += (Number(document.accessors?.[accessor]?.count) || 0) / 3;
        }
    }
    return count;
}

function geometrySignature(document) {
    const bounds = [];
    for (const mesh of document.meshes || []) {
        for (const primitive of mesh.primitives || []) {
            const position = document.accessors?.[primitive.attributes?.POSITION];
            bounds.push([position?.min, position?.max]);
        }
    }
    return JSON.stringify({
        meshes: document.meshes?.length || 0,
        nodes: (document.nodes || []).filter((node) => node.mesh !== undefined).length,
        triangles: triangles(document),
        bounds,
    });
}

function animatedMeshNames(document) {
    const names = new Set();
    const collect = (nodeIndex) => {
        const node = document.nodes?.[nodeIndex];
        if (!node) return;
        if (node.mesh !== undefined) names.add(String(node.name || ''));
        for (const child of node.children || []) collect(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) collect(channel.target.node);
    }
    return [...names];
}

test('Aetherion keeps ten editable Blender sources and budgeted texture-free GLBs', () => {
    let totalBytes = 0;
    let totalTriangles = 0;

    for (const [name, expected] of Object.entries(ASSETS)) {
        const blendPath = path.join(ROOT, 'blender', `${name}.blend`);
        const glbPath = path.join(ROOT, 'glb', `${name}.glb`);
        const blend = readFileSync(blendPath);
        assert.equal(blend.toString('ascii', 0, 7), 'BLENDER', `${name} is a Blender source`);
        assert.ok(blend.length > 100_000, `${name} keeps an editable source`);

        const size = statSync(glbPath).size;
        assert.ok(size > 10_000, `${name} exports a non-empty GLB`);
        totalBytes += size;

        const document = readGlb(glbPath);
        const triangleCount = triangles(document);
        totalTriangles += triangleCount;
        assert.ok(
            triangleCount <= (expected.animated === false ? 18_000 : 6_000),
            `${name} stays inside its triangle budget`,
        );
        assert.equal(document.images?.length || 0, 0, `${name} embeds no images`);
        assert.equal(document.textures?.length || 0, 0, `${name} embeds no textures`);
        for (const buffer of document.buffers || []) {
            assert.equal(buffer.uri, undefined, `${name} has no external buffer`);
        }
        for (const mesh of document.meshes || []) {
            for (const primitive of mesh.primitives || []) {
                assert.equal(primitive.attributes?.TEXCOORD_0, undefined, `${name} has no unused UVs`);
            }
        }
        for (const landmark of expected.landmarks || []) {
            assert.ok(document.nodes.some((node) => node.name === landmark), `${name} keeps silhouette landmark ${landmark}`);
        }
    }

    assert.ok(totalBytes <= TOTAL_GLB_BUDGET, `GLBs stay below 5 MiB (got ${totalBytes})`);
    assert.ok(totalTriangles <= TOTAL_TRIANGLE_BUDGET, `assets stay below 75000 triangles (got ${totalTriangles})`);
});

test('Aetherion animation clips align to the twelve second map beat', () => {
    for (const [name, expected] of Object.entries(ASSETS)) {
        const document = readGlb(path.join(ROOT, 'glb', `${name}.glb`));
        if (expected.animated === false) {
            assert.equal(document.animations?.length || 0, 0, `${name} is static architecture`);
            continue;
        }
        assert.equal(document.animations?.length, 1, `${name} exports one clip`);
        const animation = document.animations[0];
        assert.equal(animation.name, expected.clip);
        const duration = Math.max(...animation.samplers.map(
            (sampler) => Number(document.accessors[sampler.input]?.max?.[0]) || 0,
        ));
        assert.ok(Math.abs(duration - expected.duration) <= 1 / 30, `${name} lasts ${expected.duration}s`);
        assert.equal(expected.duration % 12, 0, `${name} lasts a whole number of map beats`);
        assert.ok(document.nodes.some((node) => node.name === expected.landmark), `${name} keeps ${expected.landmark}`);

        const animated = animatedMeshNames(document);
        assert.ok(animated.some((nodeName) => /_nocol$/i.test(nodeName)), `${name} animates readable visual detail`);
        if (expected.visualOnly) {
            assert.ok(animated.every((nodeName) => /_nocol$/i.test(nodeName)), `${name} can never create collision`);
        } else {
            assert.ok(animated.some((nodeName) => !/_nocol$/i.test(nodeName)), `${name} carries animated collision`);
            assert.ok(
                document.nodes.some((node) => /_countdown_\d+_nocol$/i.test(node.name || '')),
                `${name} carries collision-free opening telegraphy`,
            );
        }
    }
});

test('long Aetherion clips use their full macro cycle instead of repeating one pose', () => {
    const bridge = readGlb(path.join(ROOT, 'glb', '05_meridian_bridges.glb'));
    const bridgeTranslations = animationValues(bridge, 'MeridianBridgeRig', 'translation');
    const bridgeX = bridgeTranslations.map((value) => value[0]);
    assert.ok(Math.min(...bridgeX) <= -16.9, 'bridge opens left during one beat');
    assert.ok(Math.max(...bridgeX) >= 16.9, 'bridge opens right during the other beat');

    const astrolabe = readGlb(path.join(ROOT, 'glb', '06_astrolabe_gate.glb'));
    const astrolabeTranslations = animationValues(astrolabe, 'AstrolabeGateRig', 'translation');
    const axes = [0, 1, 2].map((axis) => astrolabeTranslations.map((value) => value[axis]));
    assert.ok(Math.min(...axes[0]) <= -17.9 && Math.max(...axes[0]) >= 17.9, 'astrolabe alternates lateral openings');
    assert.ok(axes.some((values) => Math.max(...values) >= 18.9), 'astrolabe third beat opens vertically');

    const beaconScales = animationValues(astrolabe, 'astrolabe_countdown_2_nocol', 'scale');
    const sizes = beaconScales.map((value) => Math.max(...value));
    assert.ok(Math.min(...sizes) <= 0.2 && Math.max(...sizes) >= 0.99, 'gold countdown visibly pulses before opening');
});

test('Aetherion ships exactly thirty static, collision-free orientation variants', () => {
    const families = {
        'zodiac-steles': 'aetherion-zodiac-stele',
        'orbit-beacons': 'aetherion-orbit-beacon',
        'astronomical-medallions': 'aetherion-astronomical-medallion',
    };
    let variantCount = 0;
    let totalGlbBytes = 0;

    for (const [family, objectId] of Object.entries(families)) {
        const familyRoot = path.join(ROOT, 'props', family);
        const variants = readdirSync(familyRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        assert.deepEqual(
            variants,
            Array.from({ length: 10 }, (_, index) => `${objectId}-v${String(index + 1).padStart(2, '0')}`),
            `${family} keeps stable v01-v10 IDs`,
        );
        variantCount += variants.length;
        const geometry = new Set();

        for (const variant of variants) {
            const variantRoot = path.join(familyRoot, variant);
            const blend = readFileSync(path.join(variantRoot, 'source.blend'));
            assert.equal(blend.toString('ascii', 0, 7), 'BLENDER', `${variant} has an editable source`);
            assert.ok(blend.length > 100_000, `${variant} source is non-empty`);

            const glbPath = path.join(variantRoot, 'runtime.glb');
            totalGlbBytes += statSync(glbPath).size;
            const document = readGlb(glbPath);
            geometry.add(geometrySignature(document));
            assert.equal(document.animations?.length || 0, 0, `${variant} is static`);
            assert.equal(document.cameras?.length || 0, 0, `${variant} has no camera`);
            assert.equal(document.extensionsUsed?.includes('KHR_lights_punctual') || false, false, `${variant} has no lights`);
            assert.equal(document.images?.length || 0, 0, `${variant} embeds no images`);
            assert.equal(document.textures?.length || 0, 0, `${variant} embeds no textures`);
            assert.ok((document.materials?.length || 0) >= 3 && document.materials.length <= 4, `${variant} uses a small flat-PBR palette`);
            assert.ok(triangles(document) > 500 && triangles(document) <= 12_000, `${variant} stays inside its geometry budget`);

            const meshNodes = (document.nodes || []).filter((node) => node.mesh !== undefined);
            assert.ok(meshNodes.length > 0, `${variant} contains runtime meshes`);
            assert.ok(meshNodes.every((node) => /_nocol$/i.test(node.name || '')), `${variant} keeps the no-collision naming contract`);
        }
        assert.equal(geometry.size, 10, `${family} has ten geometric variants rather than material swaps`);
    }

    assert.equal(variantCount, 30);
    assert.ok(totalGlbBytes <= 3 * 1024 * 1024, `orientation GLBs stay below 3 MiB (got ${totalGlbBytes})`);
});
