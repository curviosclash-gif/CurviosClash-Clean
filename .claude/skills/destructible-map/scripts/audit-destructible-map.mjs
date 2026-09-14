#!/usr/bin/env node
// Audits one map preset with a `destructibles` block against the assets and registries it
// depends on. Everything the Eiffel siege preset test asserts by hand is derived here from the
// catalog and the GLB files themselves, so a new map gets the same checks without a copy of that
// test - and long before the desktop proof, which is the expensive place to find a wrong clip name.
//
//   node .claude/skills/destructible-map/scripts/audit-destructible-map.mjs <mapKey> [--json]
//
// Exit code 1 when anything is reported as FAIL. Warnings do not fail the audit; they name
// decisions the preset has to take deliberately (a missing seal, a collection, a spare scene).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const load = (relative) => import(new URL(relative, `file://${root.replace(/\\/g, '/')}`).href);

const { MAP_PRESET_CATALOG } = await load('src/core/config/maps/MapPresetCatalog.js');
const { MAP_PRESETS } = await load('src/core/config/MapPresets.js');
const { resolveMapPickerCollection } = await load('src/ui/menu/MenuMapCollectionCatalog.js');
const { BLENDER_ASSET_GENERATORS } = await load('scripts/map-asset-jobs.mjs');
const {
    MAP_DESTRUCTIBLE_KINDS,
    normalizeMapDestructibles,
    resolveMapDestructibleBreakScene,
    resolveMapDestructibleKindRule,
} = await load('src/shared/contracts/MapDestructibleContract.js');

const WRECK_MARGIN = 20;          // authored units the field keeps beyond the furthest wreck
const CLIP_LIMIT_SECONDS = 60;    // the Blender asset test's upper bound for one collapse
const HEADING_TOLERANCE = 0.05;   // radians between the stated and the measured baked heading

const args = process.argv.slice(2);
const json = args.includes('--json');
const mapKey = args.find((entry) => !entry.startsWith('--'));
if (!mapKey) {
    console.error('Usage: audit-destructible-map.mjs <mapKey> [--json]');
    process.exit(2);
}

const findings = [];
const report = (level, area, message) => findings.push({ level, area, message });
const fail = (area, message) => report('FAIL', area, message);
const warn = (area, message) => report('WARN', area, message);
const ok = (area, message) => report('ok', area, message);

// --- GLB reading -----------------------------------------------------------------------------------

function readGlb(url) {
    const bytes = readFileSync(path.resolve(root, url));
    if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${url} has no GLB header`);
    const jsonLength = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
    return { document, binary: bytes.subarray(20 + jsonLength + 8) };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessorElement({ document, binary }, accessorIndex, element) {
    const accessor = document.accessors[accessorIndex];
    const view = document.bufferViews[accessor.bufferView];
    const size = COMPONENTS[accessor.type];
    const stride = view.byteStride || size * 4;
    const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + element * stride;
    return Array.from({ length: size }, (_value, index) => binary.readFloatLE(offset + index * 4));
}

const nodeName = (node) => String(node?.name || '');
const rootNodeNames = (document) => (document.scenes?.[document.scene || 0]?.nodes || [])
    .map((index) => nodeName(document.nodes[index]));
const meshNodes = (document) => (document.nodes || []).filter((node) => node.mesh !== undefined);
const collidableNames = (document) => meshNodes(document)
    .map(nodeName)
    .filter((name) => !name.toLowerCase().includes('_nocol'));

/** Names of every mesh a keyframed transform moves - the runtime derives a live collider from these. */
function animatedMeshNames(document) {
    const names = new Set();
    const collect = (index) => {
        const node = document.nodes?.[index];
        if (!node) return;
        if (node.mesh !== undefined) names.add(nodeName(node));
        for (const child of node.children || []) collect(child);
    };
    for (const animation of document.animations || []) {
        for (const channel of animation.channels || []) {
            if (['translation', 'rotation', 'scale'].includes(channel.target?.path)) collect(channel.target.node);
        }
    }
    return names;
}

function clipDurationSeconds(document, animation) {
    return Math.max(0, ...animation.samplers.map((sampler) => Number(document.accessors?.[sampler.input]?.max?.[0]) || 0));
}

/** Horizontal travel of a top-level rig between its rest pose and its last translation keyframe. */
function rigTravel(glb, rigName) {
    const { document } = glb;
    const nodeIndex = document.nodes.findIndex((node) => nodeName(node) === rigName);
    if (nodeIndex < 0) return null;
    const animation = document.animations?.[0];
    const channel = animation?.channels.find((entry) => entry.target.node === nodeIndex && entry.target.path === 'translation');
    if (!channel) return null;
    const sampler = animation.samplers[channel.sampler];
    const frames = document.accessors[sampler.output].count;
    const rest = document.nodes[nodeIndex].translation || [0, 0, 0];
    const last = readAccessorElement(glb, sampler.output, frames - 1);
    const dx = last[0] - rest[0];
    const dz = last[2] - rest[2];
    return { dx, dz, distance: Math.hypot(dx, dz), heading: Math.atan2(dx, dz) };
}

const foldHeading = (value) => ((value % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const headingGap = (a, b) => {
    const gap = Math.abs(foldHeading(a) - foldHeading(b));
    return Math.min(gap, Math.PI * 2 - gap);
};
const modelScale = (model) => (Array.isArray(model?.scale) ? Math.max(...model.scale) : Number(model?.scale) || 1);

// --- 1. Registration ---------------------------------------------------------------------------------

const map = MAP_PRESET_CATALOG[mapKey];
if (!map) {
    fail('registry', `"${mapKey}" is not in MAP_PRESET_CATALOG (src/core/config/maps/MapPresetCatalog.js)`);
} else {
    ok('registry', `"${mapKey}" is in MAP_PRESET_CATALOG as "${map.name}"`);
    if (MAP_PRESETS[mapKey]) ok('registry', 'the map reaches the runtime through BASE_MAP_KEYS (MapPresetsBase.js)');
    else fail('registry', 'the map is missing from BASE_MAP_KEYS in src/core/config/maps/MapPresetsBase.js - the picker never offers it');
    const collection = resolveMapPickerCollection(mapKey);
    if (collection.id === 'other') warn('registry', 'no picker collection lists the map (src/ui/menu/MenuMapCollectionCatalog.js); it lands under "Weitere Karten"');
    else ok('registry', `picker collection "${collection.label}"`);

    const dispatcher = readFileSync(path.resolve(root, 'scripts/generate_map_assets.py'), 'utf8');
    const packs = new Set();
    for (const model of map.glbModels || []) {
        const match = /^assets\/maps\/([a-z0-9_]+)\/glb\//.exec(model.url || '');
        if (match) packs.add(match[1]);
    }
    for (const pack of packs) {
        if (!BLENDER_ASSET_GENERATORS[pack]) fail('registry', `pack "${pack}" has no generator in scripts/map-asset-jobs.mjs`);
        else if (!dispatcher.includes(`'${pack}': '`)) fail('registry', `pack "${pack}" is missing from GENERATORS in scripts/generate_map_assets.py`);
        else ok('registry', `pack "${pack}" is registered on both generator sides (${BLENDER_ASSET_GENERATORS[pack]})`);
    }

    const dashed = mapKey.replace(/_/g, '-');
    const tests = readdirSync(path.resolve(root, 'tests'));
    const contractTests = tests.filter((name) => name.includes(dashed) && name.endsWith('.contract.test.mjs'));
    const desktopSpecs = tests.filter((name) => name.includes(dashed) && name.endsWith('.desktop.spec.js'));
    if (contractTests.length) ok('tests', `contract tests: ${contractTests.join(', ')}`);
    else warn('tests', `no tests/*${dashed}*.contract.test.mjs yet`);
    const clusters = readFileSync(path.resolve(root, 'scripts/playwright-test-clusters.mjs'), 'utf8');
    if (!desktopSpecs.length) warn('tests', `no tests/*${dashed}*.desktop.spec.js yet - the desktop proof is still open`);
    for (const spec of desktopSpecs) {
        if (clusters.includes(`tests/${spec}`)) ok('tests', `${spec} is in a Playwright cluster`);
        else fail('tests', `${spec} is not listed in scripts/playwright-test-clusters.mjs (cluster desktop-flows)`);
    }
}

// --- 2. The destructible block -------------------------------------------------------------------

const authored = map?.destructibles;
const definition = map ? normalizeMapDestructibles(authored) : null;
if (map && !authored) fail('destructibles', 'the preset has no `destructibles` block');
if (map && authored && !definition) fail('destructibles', 'the block normalizes to nothing - no segment has a known kind and a mesh prefix');

if (definition) {
    const authoredSegmentIds = (authored.segments || []).map((segment) => String(segment?.id ?? ''));
    const keptIds = new Set(definition.segments.map((segment) => segment.id));
    for (const [index, id] of authoredSegmentIds.entries()) {
        if (keptIds.has(id)) continue;
        const kind = authored.segments[index]?.kind;
        const reason = resolveMapDestructibleKindRule(kind)
            ? 'no usable mesh prefix, or a duplicate id'
            : `unknown kind "${kind}" (known: ${Object.keys(MAP_DESTRUCTIBLE_KINDS).join(', ')})`;
        fail('destructibles', `segment "${id || `#${index}`}" is dropped by the normalizer: ${reason}`);
    }
    const authoredSceneIds = (authored.breakScenes || []).map((scene) => String(scene?.id ?? ''));
    const keptSceneIds = new Set(definition.breakScenes.map((scene) => scene.id));
    for (const id of authoredSceneIds) {
        if (!keptSceneIds.has(id)) fail('destructibles', `break scene "${id}" is dropped: it needs exactly one of trigger.kind / trigger.segmentId and a modelId`);
    }
    if ((authored.pieces || []).length !== definition.pieces.length) fail('destructibles', 'a piece id was dropped (blank, duplicate or over the cap)');

    ok('destructibles', `${definition.segments.length} segments, ${definition.pieces.length} pieces, ${definition.breakScenes.length} scenes, modes ${definition.gameModes.length ? definition.gameModes.join('/') : 'all'}`);
    const kinds = [...new Set(definition.segments.map((segment) => segment.kind))];
    ok('destructibles', `kinds in use: ${kinds.join(', ')}`);
    if (!kinds.some((kind) => MAP_DESTRUCTIBLE_KINDS[kind]?.sealsTower)) {
        warn('destructibles', 'no sealing kind (leg_lower) - the structure can keep breaking until every segment is gone; say so in the plan if intended');
    }
    for (const segment of definition.segments) {
        if (segment.label === segment.id) warn('destructibles', `segment "${segment.id}" has no readable label; the HUD prints the id`);
        if (!definition.pieces.includes(segment.piece)) fail('destructibles', `segment "${segment.id}" belongs to piece "${segment.piece}", which the map does not list`);
        const event = { segmentId: segment.id, kind: segment.kind };
        if (!resolveMapDestructibleBreakScene(definition, event)) fail('destructibles', `no break scene answers a break of "${segment.id}" (kind ${segment.kind})`);
    }
    // Segments that share every prefix are told apart by anchor alone.
    for (let a = 0; a < definition.segments.length; a += 1) {
        for (let b = a + 1; b < definition.segments.length; b += 1) {
            const left = definition.segments[a];
            const right = definition.segments[b];
            const samePrefixes = left.meshPrefixes.length === right.meshPrefixes.length
                && left.meshPrefixes.every((prefix) => right.meshPrefixes.includes(prefix));
            const sameAnchor = left.anchor.every((value, axis) => value === right.anchor[axis]);
            if (samePrefixes && sameAnchor) fail('destructibles', `"${left.id}" and "${right.id}" share prefixes and anchor - a hit can never tell them apart`);
        }
    }
    const anchored = definition.segments.some((segment) => segment.anchor.some((value) => value !== 0));
    if (anchored && map.scaleAuthoredAnchors !== true) {
        warn('destructibles', 'anchors are set but scaleAuthoredAnchors is not true; on a map built at MAP_SCALE != 1 hits are measured against unscaled anchors');
    }
}

// --- 3. Models and scenes -------------------------------------------------------------------------

if (map) {
    for (const model of map.glbModels || []) {
        if (!existsSync(path.resolve(root, model.url || ''))) fail('models', `${model.id} references ${model.url}, which is not on disk`);
    }
}

if (definition) {
    const modelById = new Map((map.glbModels || []).map((model) => [model.id, model]));
    const sceneModelIds = new Set(definition.breakScenes.map((scene) => scene.modelId));
    const staticModels = (map.glbModels || []).filter((model) => !sceneModelIds.has(model.id) && model.hiddenUntilTriggered !== true);
    for (const model of map.glbModels || []) {
        if (model.hiddenUntilTriggered === true && !sceneModelIds.has(model.id)) warn('models', `${model.id} is hiddenUntilTriggered but no scene plays it - it never appears`);
    }

    const halfX = (map.size?.[0] || 0) / 2;
    const halfZ = (map.size?.[2] || 0) / 2;
    for (const scene of definition.breakScenes) {
        const model = modelById.get(scene.modelId);
        if (!model) { fail('scenes', `${scene.id}: model "${scene.modelId}" is not placed by the map`); continue; }
        if (model.hiddenUntilTriggered !== true) fail('scenes', `${scene.id}: ${model.id} must be hiddenUntilTriggered, or the collapse is visible from the start`);
        if (model.animationClock?.mode !== 'once') fail('scenes', `${scene.id}: ${model.id} needs animationClock.mode 'once' - a looping collapse re-erects the structure`);
        if (model.animationClock?.phaseOffsetBeats !== undefined) warn('scenes', `${scene.id}: a beat offset on a one-shot clip delays the fall`);
        if ((model.rotation || [0, 0, 0]).some((value) => value !== 0)) warn('scenes', `${scene.id}: the slot carries an authored rotation; the event yaw is added on top of it`);
        for (const hidden of scene.hideModelIds) {
            if (!modelById.has(hidden)) fail('scenes', `${scene.id} hides "${hidden}", which the map does not place`);
        }
        const sharesHeight = scene.hideModelIds.some((hidden) => modelById.get(hidden)?.position?.[1] === model.position?.[1]);
        if (!sharesHeight) warn('scenes', `${scene.id}: no hidden model shares the slot height ${model.position?.[1]} - the loader drops a model onto its bounding box, so the scene may jump when it appears`);

        if (!existsSync(path.resolve(root, model.url || ''))) continue;
        const glb = readGlb(model.url);
        const { document } = glb;
        const animations = document.animations || [];
        if (animations.length !== 1) fail('scenes', `${scene.id}: ${model.url} holds ${animations.length} clips, a scene needs exactly one`);
        const clip = animations[0];
        if (clip && clip.name !== model.animationClock?.clipName) fail('scenes', `${scene.id}: preset addresses clip "${model.animationClock?.clipName}", the file holds "${clip.name}"`);
        if (clip) {
            const seconds = clipDurationSeconds(document, clip);
            if (seconds > CLIP_LIMIT_SECONDS) warn('scenes', `${scene.id}: clip lasts ${seconds.toFixed(1)} s, over the ${CLIP_LIMIT_SECONDS} s the asset test allows`);
            else ok('scenes', `${scene.id}: clip "${clip.name}" lasts ${seconds.toFixed(1)} s`);
        }

        const rigs = rootNodeNames(document).filter((name) => name.startsWith('piece_')).map((name) => name.slice('piece_'.length)).sort();
        const listed = [...scene.pieces].sort();
        if (rigs.join(',') !== listed.join(',')) fail('scenes', `${scene.id} lists pieces [${listed}] but the GLB carries rigs [${rigs}]`);
        // Only a mesh that can carry a collider needs a rig: `_nocol` decor - a cloud, a dust
        // sheet - never collides, so it may stand still without leaving anything in the air.
        const moved = animatedMeshNames(document);
        const stale = collidableNames(document).filter((name) => !moved.has(name));
        if (stale.length) fail('scenes', `${scene.id}: ${stale.length} collidable mesh(es) are not under a keyframed rig and would keep a stale collider (${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ', ...' : ''})`);
        if (collidableNames(document).length === 0) ok('scenes', `${scene.id}: every mesh is _nocol, the scene adds no collision (an effect, not wreckage)`);

        // A scene that does not turn with the event - a cloud, a blast, anything symmetric - has
        // no fall heading to measure and no wreck to fit into the field.
        if (scene.yawFromEvent === false) {
            ok('scenes', `${scene.id}: yawFromEvent false, bakedHeading and wreck reach do not apply`);
            continue;
        }

        let furthest = null;
        for (const piece of scene.pieces) {
            const travel = rigTravel(glb, `piece_${piece}`);
            if (travel && (!furthest || travel.distance > furthest.distance)) furthest = { piece, ...travel };
        }
        if (!furthest || furthest.distance < 1) {
            warn('scenes', `${scene.id}: no rig travels horizontally, the baked heading cannot be measured`);
        } else {
            const gap = headingGap(furthest.heading, scene.bakedHeading);
            if (gap > HEADING_TOLERANCE) fail('scenes', `${scene.id}: bakedHeading ${scene.bakedHeading.toFixed(3)} rad, but piece_${furthest.piece} falls towards ${foldHeading(furthest.heading).toFixed(3)} rad`);
            else ok('scenes', `${scene.id}: bakedHeading matches the clip (piece_${furthest.piece}, ${foldHeading(furthest.heading).toFixed(3)} rad)`);
            // The rig origin is a lower bound for the wreck; the piece's own length reaches further.
            // Where the wreck lands depends on how the slot is turned: a scene whose trigger falls
            // onto its own anchor is only ever turned onto those headings, so its footprint is
            // measured along the map axes; one that follows the shot may land at any angle, so the
            // radius has to fit.
            const distance = furthest.distance * modelScale(model);
            const triggered = scene.trigger.segmentId
                ? definition.segments.filter((segment) => segment.id === scene.trigger.segmentId)
                : definition.segments.filter((segment) => segment.kind === scene.trigger.kind);
            const rule = resolveMapDestructibleKindRule(triggered[0]?.kind) || MAP_DESTRUCTIBLE_KINDS.shaft;
            let overflow = null;
            if (rule.yawFrom === 'segment') {
                for (const segment of triggered) {
                    const heading = Math.atan2(segment.anchor[0], segment.anchor[2]);
                    const turned = furthest.heading + (heading - scene.bakedHeading);
                    const x = Math.abs(distance * Math.sin(turned));
                    const z = Math.abs(distance * Math.cos(turned));
                    if (x > halfX - WRECK_MARGIN || z > halfZ - WRECK_MARGIN) overflow = `${x.toFixed(1)} x ${z.toFixed(1)} units when turned onto "${segment.id}"`;
                }
            } else if (distance > Math.min(halfX, halfZ) - WRECK_MARGIN) {
                overflow = `${distance.toFixed(1)} units of radius`;
            }
            if (overflow) fail('field', `${scene.id}: the rig of piece_${furthest.piece} alone lands ${overflow}; the field is ${map.size?.[0]} x ${map.size?.[2]} with a ${WRECK_MARGIN} unit margin`);
            else ok('field', `${scene.id}: rig of piece_${furthest.piece} travels ${distance.toFixed(1)} units and stays inside the ${map.size?.[0]} x ${map.size?.[2]} field; the piece's own length is the asset test's job`);
        }
    }

    // --- 4. Segment prefixes against the intact geometry --------------------------------------------
    const claims = new Map();
    for (const model of staticModels) {
        if (!existsSync(path.resolve(root, model.url || ''))) continue;
        const names = collidableNames(readGlb(model.url).document);
        for (const segment of definition.segments) {
            const hits = names.filter((name) => segment.meshPrefixes.some((prefix) => name.toLowerCase().startsWith(prefix)));
            if (hits.length) claims.set(segment.id, [...(claims.get(segment.id) || []), ...hits.map((name) => `${model.id}:${name}`)]);
        }
    }
    for (const segment of definition.segments) {
        const claimed = claims.get(segment.id) || [];
        if (!claimed.length) { fail('segments', `"${segment.id}" (${segment.meshPrefixes.join(', ')}) matches no collidable mesh in any placed static model - it can never be hit`); continue; }
        const files = new Set(claimed.map((entry) => entry.split(':')[0]));
        ok('segments', `"${segment.id}" claims ${claimed.length} mesh(es) in ${[...files].join(', ')}`);
    }
    const ground = (map.obstacles || []).find((obstacle) => obstacle?.compileWithGlb === true);
    if (!ground) warn('field', 'no obstacle is compileWithGlb; without a fallback ground a ship that clips the floor while the GLB streams falls out of the world');
    else if ((ground.size?.[0] || 0) < map.size?.[0] || (ground.size?.[2] || 0) < map.size?.[2]) fail('field', `the fallback ground spans ${ground.size?.[0]} x ${ground.size?.[2]} under a ${map.size?.[0]} x ${map.size?.[2]} field`);
    if ((map.portals || []).length) warn('field', `${map.portals.length} portal(s) - check that none ends inside geometry a collapse takes away`);
}

// --- Report ----------------------------------------------------------------------------------------

const failures = findings.filter((entry) => entry.level === 'FAIL').length;
const warnings = findings.filter((entry) => entry.level === 'WARN').length;
if (json) {
    console.log(JSON.stringify({ mapKey, failures, warnings, findings }, null, 2));
} else {
    for (const entry of findings) console.log(`${entry.level.padEnd(4)}  [${entry.area}] ${entry.message}`);
    console.log(`\n${mapKey}: ${failures} FAIL, ${warnings} WARN, ${findings.length - failures - warnings} ok`);
}
process.exitCode = failures ? 1 : 0;
