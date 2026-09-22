#!/usr/bin/env node
// Audits exported GLBs against what the CurviosClash runtime actually reads: the three.js r186
// loader without Draco/Meshopt/KTX2 decoders, the mesh-name markers of GLBMapLoader, COLOR_0 that
// must only darken, emissive colour times strength, and project budgets. Reads the files directly,
// so it needs no Blender and no browser.
//
//   node .claude/skills/blender-assets/scripts/audit-glb.mjs <file.glb|dir> [...]
//        [--max-triangles N] [--max-primitives N] [--max-kib N] [--json]
//
// Exit code 1 when anything is reported as FAIL. Warnings name decisions to take deliberately.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const UNDECODABLE = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression',
    'KHR_meshopt_compression', 'KHR_texture_basisu']);
const MARKERS = ['_nocol', '_colonly', '_dyn', '_foam', '_noshadow'];
const DARKEST_LEGITIMATE_COLOR = 0.18;   // tests/map-vertex-colors.contract.test.mjs
const EMISSION_WARN = 2;                 // above this the tone mapping turns glow white
const SMALL_COLLIDER_EXTENT = 0.25;      // solid meshes smaller than this are usually trim

const argv = process.argv.slice(2);
const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? Number(argv[index + 1]) : undefined;
};
const limits = { triangles: option('--max-triangles'), primitives: option('--max-primitives'),
    kib: option('--max-kib') };
const json = argv.includes('--json');
const inputs = argv.filter((entry, index) => !entry.startsWith('--')
    && !['--max-triangles', '--max-primitives', '--max-kib'].includes(argv[index - 1]));
if (!inputs.length) {
    console.error('Usage: audit-glb.mjs <file.glb|dir> [...] [--max-triangles N] [--max-primitives N] [--max-kib N] [--json]');
    process.exit(2);
}

function collectFiles(entry) {
    if (statSync(entry).isDirectory()) {
        return readdirSync(entry).sort().flatMap((name) => collectFiles(path.join(entry, name)));
    }
    return entry.toLowerCase().endsWith('.glb') ? [entry] : [];
}

function readGlb(file) {
    const bytes = readFileSync(file);
    if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('no GLB header');
    if (bytes.readUInt32LE(4) !== 2) throw new Error('not glTF 2');
    if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('declared length differs from file size');
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    const binStart = 20 + jsonLength;
    const binary = binStart + 8 <= bytes.length ? bytes.subarray(binStart + 8) : Buffer.alloc(0);
    return { document, binary, bytes: bytes.length };
}

// Smallest RGB channel of a COLOR_0 accessor; wrapped normalised values show up near zero.
function minColorChannel({ document, binary }, accessorIndex) {
    const accessor = document.accessors[accessorIndex];
    const view = document.bufferViews?.[accessor.bufferView];
    if (!view || !binary.length) return null;
    const components = accessor.type === 'VEC4' ? 4 : 3;
    const width = accessor.componentType === 5126 ? 4 : accessor.componentType === 5123 ? 2 : 1;
    const scale = accessor.componentType === 5126 ? 1 : accessor.componentType === 5123 ? 65535 : 255;
    const stride = view.byteStride || components * width;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    let min = Infinity;
    for (let index = 0; index < accessor.count; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
            const offset = start + index * stride + channel * width;
            const raw = width === 4 ? binary.readFloatLE(offset)
                : width === 2 ? binary.readUInt16LE(offset) : binary.readUInt8(offset);
            min = Math.min(min, raw / scale);
        }
    }
    return min;
}

// Same rule as three.js PropertyBinding.sanitizeNodeName.
const sanitize = (name) => name.replace(/\s/g, '_').replace(/[^\w-]/g, '');

function audit(file) {
    const findings = [];
    const fail = (message) => findings.push({ level: 'FAIL', message });
    const warn = (message) => findings.push({ level: 'WARN', message });
    let glb;
    try {
        glb = readGlb(file);
    } catch (error) {
        fail(`unreadable: ${error.message}`);
        return { file, findings };
    }
    const { document } = glb;
    const nodes = document.nodes || [];
    const meshes = document.meshes || [];
    const accessors = document.accessors || [];

    const used = document.extensionsUsed || [];
    const required = document.extensionsRequired || [];
    for (const extension of used) {
        if (UNDECODABLE.has(extension)) fail(`${extension} needs a decoder the game does not register`);
    }
    for (const extension of required) {
        if (!used.includes(extension)) fail(`${extension} is required but not listed as used`);
    }
    if (!meshes.length) fail('no meshes');

    let triangles = 0;
    let primitives = 0;
    const smallSolid = [];
    const markerCounts = Object.fromEntries(MARKERS.map((marker) => [marker, 0]));
    const renamed = [];
    const seenNames = new Map();
    for (const node of nodes) {
        const name = String(node.name || '');
        if (name && sanitize(name) !== name) renamed.push(name);
        if (name) seenNames.set(sanitize(name), (seenNames.get(sanitize(name)) || 0) + 1);
        if (node.mesh === undefined) continue;
        const lower = name.toLowerCase();
        for (const marker of MARKERS) if (lower.includes(marker)) markerCounts[marker] += 1;
        const mesh = meshes[node.mesh];
        for (const primitive of mesh?.primitives || []) {
            primitives += 1;
            const mode = primitive.mode ?? 4;
            const count = accessors[primitive.indices ?? primitive.attributes?.POSITION]?.count || 0;
            triangles += mode === 4 ? count / 3 : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
            const position = accessors[primitive.attributes?.POSITION];
            if (position?.min && position?.max && !lower.includes('_nocol') && !lower.includes('_colonly')) {
                const extent = Math.max(...position.max.map((value, axis) => value - position.min[axis]));
                if (extent < SMALL_COLLIDER_EXTENT) smallSolid.push(name);
            }
            const color = primitive.attributes?.COLOR_0;
            if (color !== undefined) {
                const min = minColorChannel(glb, color);
                if (min !== null && min < DARKEST_LEGITIMATE_COLOR * 0.5) {
                    fail(`${name}: COLOR_0 channel ${min.toFixed(3)} looks wrapped (value above 1.0 in Blender)`);
                }
            }
        }
    }
    if (renamed.length) {
        // Clips bind to the sanitised names consistently; only runtime code that looks a part up
        // by its Blender name (getObjectByName, prefix claims) misses it.
        warn(`three.js renames ${renamed.length} node(s), e.g. ${renamed.slice(0, 3).map((n) => `"${n}"`).join(', ')} - fatal only if code looks them up by name`);
    }
    const collisions = [...seenNames].filter(([, count]) => count > 1).map(([name]) => name);
    if (collisions.length) warn(`duplicate node names after sanitising: ${collisions.slice(0, 5).join(', ')}`);
    if (smallSolid.length) {
        warn(`${smallSolid.length} solid mesh(es) under ${SMALL_COLLIDER_EXTENT} units - trim usually wants _noshadow_nocol: ${smallSolid.slice(0, 3).join(', ')}`);
    }

    const materials = (document.materials || []).map((material) => {
        const strength = material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
        const emissive = (material.emissiveFactor || [0, 0, 0]).map((value) => value * strength);
        const peak = Math.max(...emissive);
        if (peak > EMISSION_WARN) warn(`${material.name}: effective emission ${peak.toFixed(2)} > ${EMISSION_WARN}, bright maps tone-map it towards white - check in game`);
        const base = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
        if (peak > 0.3 && Math.min(...base.slice(0, 3)) > 0.5) {
            warn(`${material.name}: glowing material with a bright base colour - lit scenes wash it out`);
        }
        if (material.alphaMode === 'BLEND') warn(`${material.name}: alphaMode BLEND needs sorting and casts no shadow`);
        return { name: material.name, alphaMode: material.alphaMode || 'OPAQUE', emission: Number(peak.toFixed(3)) };
    });

    const animations = (document.animations || []).map((animation) => {
        const duration = Math.max(0, ...animation.samplers.map((sampler) => Number(accessors[sampler.input]?.max?.[0]) || 0));
        const movedMeshes = new Set();
        const visit = (index) => {
            const node = nodes[index];
            if (!node) return;
            if (node.mesh !== undefined) movedMeshes.add(node.name);
            for (const child of node.children || []) visit(child);
        };
        for (const channel of animation.channels || []) {
            if (['translation', 'rotation', 'scale'].includes(channel.target?.path)) visit(channel.target.node);
        }
        return { name: animation.name, seconds: Number(duration.toFixed(3)), channels: animation.channels.length,
            movedMeshes: movedMeshes.size };
    });
    if (animations.length > 1) warn(`${animations.length} clips - a setpiece is expected to carry exactly one`);

    triangles = Math.round(triangles);
    const kib = Number((glb.bytes / 1024).toFixed(1));
    if (limits.triangles !== undefined && triangles > limits.triangles) fail(`${triangles} triangles > ${limits.triangles}`);
    if (limits.primitives !== undefined && primitives > limits.primitives) fail(`${primitives} primitives > ${limits.primitives}`);
    if (limits.kib !== undefined && kib > limits.kib) fail(`${kib} KiB > ${limits.kib}`);

    return { file, kib, triangles, primitives, meshNodes: nodes.filter((node) => node.mesh !== undefined).length,
        markers: markerCounts, extensions: used, materials, animations, findings };
}

const reports = inputs.flatMap(collectFiles).map(audit);
if (!reports.length) {
    console.error('No .glb files found.');
    process.exit(2);
}
if (json) {
    console.log(JSON.stringify(reports, null, 2));
} else {
    for (const report of reports) {
        const failed = report.findings.some((finding) => finding.level === 'FAIL');
        console.log(`${failed ? 'FAIL' : 'ok  '} ${report.file}`);
        if (report.kib !== undefined) {
            const markers = Object.entries(report.markers).filter(([, count]) => count).map(([marker, count]) => `${marker}=${count}`);
            console.log(`     ${report.kib} KiB, ${report.triangles} tris, ${report.primitives} primitives, ${report.meshNodes} mesh nodes`
                + (markers.length ? `, ${markers.join(' ')}` : '')
                + (report.extensions.length ? `, ext: ${report.extensions.join(' ')}` : ''));
            for (const clip of report.animations) {
                console.log(`     clip "${clip.name}" ${clip.seconds}s, ${clip.channels} channels, moves ${clip.movedMeshes} mesh(es)`);
            }
        }
        for (const finding of report.findings) console.log(`     ${finding.level} ${finding.message}`);
    }
    const failures = reports.filter((report) => report.findings.some((finding) => finding.level === 'FAIL')).length;
    console.log(`\n[audit-glb] files=${reports.length} failed=${failures}`);
}
process.exitCode = reports.some((report) => report.findings.some((finding) => finding.level === 'FAIL')) ? 1 : 0;
