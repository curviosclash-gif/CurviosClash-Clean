import { readBreakSceneAttachments, readIdList, readVariantIndex, readModelVariants } from './MapDestructibleInputOps.js';
import {
    MAP_DESTRUCTIBLE_BLAST_LIMITS,
    normalizeMapDestructibleBlast,
    normalizeMapDestructibleFireball,
} from './MapDestructibleHazardContract.js';

/**
 * Contract for map geometry a match can shoot apart.
 *
 * A map preset lists destructible segments - for the Eiffel tower the four lower legs, the
 * four mid legs, the shaft and the summit. Every segment owns hit points and the mesh name
 * prefixes its geometry is authored under, so a weapon hit on a mesh can be traced back to
 * exactly one segment without the shooter knowing anything about the map.
 *
 * Destroying a segment records a break event whose `yaw` is a *world fall heading* in the same
 * convention everything else here uses: atan2(x, z), so +Z is 0 and +X is a quarter turn. A leg
 * takes the heading of its own corner - the tower comes down onto the leg that was shot out - and
 * the shaft and the summit take the heading of the shot, which throws them away from the shooter.
 * A lower leg seals the tower: once the whole structure goes down, no further segment may break,
 * otherwise two animations would fight each other.
 *
 * A heading is not yet a rotation. The baked clips fall in whichever direction they were authored
 * in, so every break scene states that direction as `bakedHeading` and the timeline hands the
 * runtime the difference - heading minus baked heading - as the angle to turn the slot by. Keeping
 * the event in world terms is what lets one clip serve four legs, and what keeps the event readable
 * on the wire without knowing which asset will play it.
 *
 * State is a small plain object the host mutates and the replica receives. Serialising it and
 * applying it back is lossless, so a client that joins late lands on exactly the host's tower.
 *
 * Break scenes are the other half: a preset names the pieces the tower is made of and, per
 * trigger, the GLB model that holds the baked fall for them. The timeline resolver turns the
 * recorded events into the scenes to play - purely, so two clients with the same events show
 * the same collapse without any animation traffic between them.
 *
 * Mesh names alone are not always enough to tell segments apart: an intact tower exports one
 * mesh per material per part, so all four lower legs answer to the very same names. Segments
 * that share their prefixes are told apart by their anchor - the hit closest to a leg's foot
 * is the hit on that leg.
 *
 * A map may also say in which game modes its geometry can be shot apart at all. Whether a map can
 * be played in a mode is a separate, deliberately mode-agnostic question; this list only decides
 * whether the destructible parts are installed, so the same map stays flyable as intact fabric in
 * every other mode. An empty list means every mode.
 */

export const MAP_DESTRUCTIBLE_CONTRACT_VERSION = 'map-destructible.v1';

/**
 * @typedef {object} MapDestructibleKindRule
 * @property {string} kind
 * @property {boolean} sealsTower Whether a break of this kind blocks every later break.
 * @property {'segment'|'hit'} yawFrom Where the fall heading is read from.
 * @property {string} piece Tower piece a segment of this kind belongs to.
 */

/**
 * Per-kind rules. Legs fall onto their own corner, the rest along the shot that felled them, and
 * each kind names the piece of the tower it is part of - a segment whose piece an earlier collapse
 * already carried away cannot be shot at any more.
 */
export const MAP_DESTRUCTIBLE_KINDS = Object.freeze({
    leg_lower: Object.freeze({ kind: 'leg_lower', sealsTower: true, yawFrom: 'segment', piece: 'lower' }),
    leg_mid: Object.freeze({ kind: 'leg_mid', sealsTower: false, yawFrom: 'segment', piece: 'mid' }),
    shaft: Object.freeze({ kind: 'shaft', sealsTower: false, yawFrom: 'hit', piece: 'shaft' }),
    summit: Object.freeze({ kind: 'summit', sealsTower: false, yawFrom: 'hit', piece: 'summit' }),
    masonry: Object.freeze({ kind: 'masonry', sealsTower: false, yawFrom: 'hit', piece: 'masonry' }), landmark: Object.freeze({ kind: 'landmark', sealsTower: true, yawFrom: 'hit', piece: 'landmark' }),
});

/**
 * Damage a weapon deals to a segment. Rockets are not listed: they pass their own tier damage
 * in, so a tier rebalance does not need a second number here.
 */
export const MAP_DESTRUCTIBLE_DAMAGE = Object.freeze({ MG: 5 });

/**
 * How long a break stays on the HUD. The announcement is what tells a player the tower just
 * lost a part; after that the HUD goes back to showing the segment under fire.
 */
export const MAP_DESTRUCTIBLE_HUD = Object.freeze({ breakingAnnounceSeconds: 8 });

export const MAP_DESTRUCTIBLE_LIMITS = Object.freeze({
    maxSegments: 16,
    maxMeshPrefixes: 8,
    idMaxLength: 80,
    labelMaxLength: 40,
    hp: Object.freeze({ min: 1, max: 100000, fallback: 300 }),
    anchor: Object.freeze({ min: -4000, max: 4000 }),
    maxPieces: 16,
    maxBreakScenes: 16,
    maxHideModelIds: 16,
    maxGameModes: 8,
    blast: MAP_DESTRUCTIBLE_BLAST_LIMITS,
});

/**
 * @typedef {object} MapDestructibleSegment
 * @property {string} id
 * @property {string} label Short name for the HUD; falls back to the id.
 * @property {string} kind One of MAP_DESTRUCTIBLE_KINDS.
 * @property {number} hp Hit points the segment starts a round with.
 * @property {readonly string[]} meshPrefixes Lower-cased mesh name prefixes of this segment.
 * @property {string} piece Tower piece this segment belongs to; defaults to the one of its kind.
 * @property {readonly number[]} anchor Authored pivot the later fall animation rotates around.
 */

/**
 * @typedef {object} MapDestructibleBreakSceneTrigger
 * @property {string} kind Kind of break this scene answers; empty when it triggers per segment.
 * @property {string} segmentId Segment whose break starts this scene; empty when it is per kind.
 */

/**
 * @typedef {import('./MapDestructibleHazardContract.js').MapDestructibleBlast} MapDestructibleBlast
 */

/**
 * @typedef {object} MapDestructibleBreakScene
 * @property {string} id
 * @property {Readonly<MapDestructibleBreakSceneTrigger>} trigger
 * @property {string} modelId GLB model holding the baked fall; hidden until the scene starts.
 * @property {readonly string[]} [modelVariants] Equivalent scene models selected once by the host.
 * @property {readonly string[]} pieces Tower pieces this scene animates.
 * @property {readonly string[]} hideModelIds Intact models that disappear when it starts.
 * @property {readonly Readonly<{modelId: string, parentNodeName: string}>[]} attachedModels Models that follow a moving node while retaining their own animation.
 * @property {boolean} yawFromEvent Whether the event's heading turns the scene around Y.
 * @property {number} bakedHeading World heading the clip was authored falling towards, in [0, 2pi).
 * @property {Readonly<MapDestructibleBlast> | null} blast Radial damage the break deals; null for none.
 * @property {Readonly<import('./MapDestructibleHazardContract.js').MapDestructibleFireball> | null} fireball
 * A visible fireball that burns while the clip draws it; null for a scene that only draws smoke.
 */

/**
 * @typedef {object} MapDestructibleDefinition
 * @property {readonly Readonly<MapDestructibleSegment>[]} segments
 * @property {readonly string[]} pieces Every tower piece; each exists exactly once in the world.
 * @property {readonly Readonly<MapDestructibleBreakScene>[]} breakScenes
 * @property {readonly string[]} gameModes Modes this map is destructible in; empty means every one.
 */

/**
 * @typedef {object} MapDestructibleSceneTimelineEntry
 * @property {string} sceneId
 * @property {string} modelId
 * @property {number} atSeconds
 * @property {number} yaw Angle to turn the slot by: the event heading minus the baked heading.
 * @property {boolean} yawFromEvent
 * @property {string[]} hideModelIds
 * @property {readonly Readonly<{modelId: string, parentNodeName: string}>[]} attachedModels
 * @property {string[]} hiddenPieceIds Pieces an earlier entry already took away.
 */

/**
 * @typedef {object} MapDestructibleSegmentState
 * @property {string} id
 * @property {number} hp
 * @property {number} maxHp
 * @property {boolean} destroyed
 * @property {boolean} collapsed Whether it went down with another segment's piece rather than by fire.
 * @property {number} destroyedAtSeconds Match time of the break; -1 while the segment stands.
 * @property {number} yaw Fall heading in radians; 0 while the segment stands.
 * @property {number} lastHitAtSeconds Match time of the last hit; -1 while the segment is whole.
 */

/**
 * @typedef {object} MapDestructibleEvent
 * @property {number} [variantIndex] Host-selected visual variant; absent for legacy scenes.
 * @property {string} segmentId
 * @property {string} kind
 * @property {number} atSeconds
 * @property {number} yaw World heading the piece falls towards, as atan2(x, z) in radians.
 */

/**
 * @typedef {object} MapDestructibleState
 * @property {MapDestructibleSegmentState[]} segments
 * @property {MapDestructibleEvent[]} events
 * @property {boolean} sealed
 */

/**
 * @typedef {object} MapDestructibleDamageResult
 * @property {boolean} applied
 * @property {MapDestructibleSegmentState | null} segment
 * @property {boolean} destroyed
 * @property {MapDestructibleEvent | null} event
 */

/**
 * @typedef {object} MapDestructibleHudSegment
 * @property {string} id
 * @property {string} label
 * @property {number} ratio
 */

/**
 * @typedef {object} MapDestructibleHudState
 * @property {boolean} active Whether the HUD has anything to say about the tower right now.
 * @property {boolean} sealed
 * @property {MapDestructibleHudSegment | null} focusSegment Standing segment under fire, or the
 * last segment that broke while its announcement is active.
 * @property {number} breakingSecondsRemaining Rest of the announcement of the last break.
 * @property {MapDestructibleHudSegment[]} segments
 */

const TWO_PI = Math.PI * 2;
const DIRECTION_EPSILON = 1e-9;

/**
 * An angle folded into [0, 2pi). Headings are compared and subtracted, so they have to live in one
 * range - otherwise the same direction reads as two different numbers on the wire.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeHeading(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const wrapped = parsed % TWO_PI;
    if (wrapped < 0) return wrapped + TWO_PI;
    return wrapped || 0;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, min, max, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {number} maxLength
 * @returns {string}
 */
function readText(value, fallback, maxLength) {
    const text = typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
    return text || fallback;
}

/**
 * Only the four authored kinds carry rules, so an unknown kind is not guessed at.
 * @param {unknown} value
 * @returns {Readonly<MapDestructibleKindRule> | null}
 */
export function resolveMapDestructibleKindRule(value) {
    switch (value) {
        case 'masonry': return MAP_DESTRUCTIBLE_KINDS.masonry; case 'leg_lower': return MAP_DESTRUCTIBLE_KINDS.leg_lower;
        case 'leg_mid': return MAP_DESTRUCTIBLE_KINDS.leg_mid;
        case 'shaft': return MAP_DESTRUCTIBLE_KINDS.shaft;
        case 'summit': return MAP_DESTRUCTIBLE_KINDS.summit; case 'landmark': return MAP_DESTRUCTIBLE_KINDS.landmark;
        default: return null;
    }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function readMeshPrefixes(value) {
    const entries = Array.isArray(value) ? value : [];
    /** @type {string[]} */
    const prefixes = [];
    for (const entry of entries) {
        if (prefixes.length >= MAP_DESTRUCTIBLE_LIMITS.maxMeshPrefixes) break;
        if (typeof entry !== 'string') continue;
        const prefix = entry.trim().toLowerCase();
        if (!prefix || prefixes.includes(prefix)) continue;
        prefixes.push(prefix);
    }
    return prefixes;
}

/**
 * @param {unknown} value
 * @returns {number[]}
 */
function readAnchor(value) {
    const entries = Array.isArray(value) ? value : [];
    const anchor = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
        anchor[axis] = clampNumber(
            entries[axis],
            MAP_DESTRUCTIBLE_LIMITS.anchor.min,
            MAP_DESTRUCTIBLE_LIMITS.anchor.max,
            0,
        );
    }
    return anchor;
}

/**
 * A segment without a known kind or without a mesh prefix can never be hit, so it is dropped
 * instead of being kept as an indestructible entry the HUD would still show.
 * @param {unknown} source
 * @param {number} index
 * @returns {Readonly<MapDestructibleSegment> | null}
 */
function readSegment(source, index) {
    if (!isRecord(source)) return null;
    const rule = resolveMapDestructibleKindRule(source.kind);
    if (!rule) return null;
    const meshPrefixes = readMeshPrefixes(source.meshPrefixes);
    if (meshPrefixes.length === 0) return null;

    const id = readText(source.id, `destructible_${index}`, MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
    return Object.freeze({
        id,
        label: readText(
            source.label,
            id.slice(0, MAP_DESTRUCTIBLE_LIMITS.labelMaxLength),
            MAP_DESTRUCTIBLE_LIMITS.labelMaxLength,
        ),
        kind: rule.kind,
        hp: clampNumber(
            source.hp,
            MAP_DESTRUCTIBLE_LIMITS.hp.min,
            MAP_DESTRUCTIBLE_LIMITS.hp.max,
            MAP_DESTRUCTIBLE_LIMITS.hp.fallback,
        ),
        meshPrefixes: Object.freeze(meshPrefixes),
        // Which part of the tower this segment stands in. A preset only states it when its geometry
        // is cut differently from the four standard pieces.
        piece: readText(source.piece, rule.piece, MAP_DESTRUCTIBLE_LIMITS.idMaxLength).toLowerCase(),
        anchor: Object.freeze(readAnchor(source.anchor)),
    });
}

/**
 * Game modes a map states its geometry may be shot apart in. Upper-cased, trimmed and unique, so
 * a preset can write them the way they read and the runtime still compares them exactly.
 * @param {unknown} value
 * @returns {string[]}
 */
function readGameModes(value) {
    /** @type {string[]} */
    const modes = [];
    for (const mode of readIdList(value, MAP_DESTRUCTIBLE_LIMITS.maxGameModes,
        MAP_DESTRUCTIBLE_LIMITS.idMaxLength)) {
        const upper = mode.toUpperCase();
        if (!modes.includes(upper)) modes.push(upper);
    }
    return modes;
}

/**
 * Whether the destructible parts of a map may be installed in the given mode.
 *
 * A map that names no mode is destructible everywhere. One that names modes needs a known mode to
 * match: without an active mode nothing is installed, which keeps a landmark standing rather than
 * making it breakable by accident.
 * @param {{ gameModes?: readonly string[] } | null | undefined} definition
 * @param {unknown} gameMode
 * @returns {boolean}
 */
export function isMapDestructibleModeAllowed(definition, gameMode) {
    const modes = definition?.gameModes;
    if (!Array.isArray(modes) || modes.length === 0) return true;
    const mode = typeof gameMode === 'string' ? gameMode.trim().toUpperCase() : '';
    return mode !== '' && modes.includes(mode);
}

/**
 * A trigger names either the kind of break or one exact segment - never both, because two
 * answers to the same event would make the timeline depend on the reading order.
 * @param {unknown} source
 * @returns {Readonly<MapDestructibleBreakSceneTrigger> | null}
 */
function readBreakSceneTrigger(source) {
    if (!isRecord(source)) return null;
    const segmentId = readText(source.segmentId, '', MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
    const kind = resolveMapDestructibleKindRule(source.kind)?.kind || '';
    if (segmentId && kind) return null;
    if (!segmentId && !kind) return null;
    return Object.freeze({ kind, segmentId });
}

/**
 * A scene without a trigger or without the model that holds its baked clip can never play, so
 * it is dropped instead of being kept as an entry the runtime would have to guard against.
 * @param {unknown} source
 * @param {number} index
 * @param {readonly string[]} pieceIds
 * @returns {Readonly<MapDestructibleBreakScene> | null}
 */
function readBreakScene(source, index, pieceIds) {
    if (!isRecord(source)) return null;
    const trigger = readBreakSceneTrigger(source.trigger);
    const modelId = readText(source.modelId, '', MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
    if (!trigger || !modelId) return null;

    const pieces = readIdList(source.pieces, MAP_DESTRUCTIBLE_LIMITS.maxPieces,
        MAP_DESTRUCTIBLE_LIMITS.idMaxLength)
        .filter((piece) => pieceIds.includes(piece));
    return Object.freeze({
        id: readText(source.id, `break_scene_${index}`, MAP_DESTRUCTIBLE_LIMITS.idMaxLength),
        trigger,
        modelId,
        ...(Array.isArray(source.modelVariants) ? {
            modelVariants: readModelVariants(modelId, source.modelVariants),
        } : {}),
        pieces: Object.freeze(pieces),
        hideModelIds: Object.freeze(readIdList(
            source.hideModelIds,
            MAP_DESTRUCTIBLE_LIMITS.maxHideModelIds,
            MAP_DESTRUCTIBLE_LIMITS.idMaxLength,
        )),
        attachedModels: readBreakSceneAttachments(source.attachedModels, modelId,
            MAP_DESTRUCTIBLE_LIMITS.maxHideModelIds, MAP_DESTRUCTIBLE_LIMITS.idMaxLength),
        yawFromEvent: source.yawFromEvent !== false,
        // Where this clip was baked falling. A scene that states nothing is read as falling towards
        // +Z, which is heading zero and therefore turns by the event heading itself.
        bakedHeading: normalizeHeading(source.bakedHeading),
        blast: normalizeMapDestructibleBlast(source.blast),
        // A blast is one moment with one radius; a fireball is a volume that grows and shrinks
        // while it is visible. Scenes that state neither remain harmless.
        fireball: normalizeMapDestructibleFireball(source.fireball),
    });
}

/**
 * Accepts the `destructibles` block of a map preset and returns a usable definition, or null
 * when the map holds nothing that can be shot apart.
 * @param {unknown} source
 * @returns {Readonly<MapDestructibleDefinition> | null}
 */
export function normalizeMapDestructibles(source) {
    const entries = isRecord(source) && Array.isArray(source.segments) ? source.segments : [];
    /** @type {Readonly<MapDestructibleSegment>[]} */
    const segments = [];
    /** @type {Set<string>} */
    const seenIds = new Set();
    for (let index = 0; index < entries.length; index += 1) {
        if (segments.length >= MAP_DESTRUCTIBLE_LIMITS.maxSegments) break;
        const segment = readSegment(entries[index], index);
        if (!segment || seenIds.has(segment.id)) continue;
        seenIds.add(segment.id);
        segments.push(segment);
    }
    if (segments.length === 0) return null;

    const pieces = readIdList(
        isRecord(source) ? source.pieces : null,
        MAP_DESTRUCTIBLE_LIMITS.maxPieces,
        MAP_DESTRUCTIBLE_LIMITS.idMaxLength,
    );
    const sceneEntries = isRecord(source) && Array.isArray(source.breakScenes) ? source.breakScenes : [];
    /** @type {Readonly<MapDestructibleBreakScene>[]} */
    const breakScenes = [];
    /** @type {Set<string>} */
    const seenSceneIds = new Set();
    for (let index = 0; index < sceneEntries.length; index += 1) {
        if (breakScenes.length >= MAP_DESTRUCTIBLE_LIMITS.maxBreakScenes) break;
        const scene = readBreakScene(sceneEntries[index], index, pieces);
        if (!scene || seenSceneIds.has(scene.id)) continue;
        seenSceneIds.add(scene.id);
        breakScenes.push(scene);
    }

    return Object.freeze({
        segments: Object.freeze(segments),
        pieces: Object.freeze(pieces),
        breakScenes: Object.freeze(breakScenes),
        gameModes: Object.freeze(readGameModes(isRecord(source) ? source.gameModes : null)),
    });
}

/**
 * The scene a break event starts. A scene that names the exact segment wins over one that only
 * names the kind, so a preset can give the summit its own fall and still cover every other
 * break of that kind with one generic scene.
 * @param {{ breakScenes?: readonly Readonly<MapDestructibleBreakScene>[] } | null | undefined} definition
 * @param {unknown} event
 * @returns {Readonly<MapDestructibleBreakScene> | null}
 */
export function resolveMapDestructibleBreakScene(definition, event) {
    const scenes = definition?.breakScenes;
    if (!scenes || scenes.length === 0 || !isRecord(event)) return null;
    const segmentId = readText(event.segmentId, '', MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
    const kind = resolveMapDestructibleKindRule(event.kind)?.kind || '';

    for (const scene of scenes) {
        if (segmentId && scene.trigger.segmentId === segmentId) return scene;
    }
    for (const scene of scenes) {
        if (kind && scene.trigger.kind === kind) return scene;
    }
    return null;
}

/**
 * Turns the break events of a match into the scenes that have to play, in order.
 *
 * Every tower piece exists exactly once in the world. Once a scene has taken a piece away - the
 * summit toppling on its own, say - a later scene that also animates the summit must not show it
 * a second time, so its `hiddenPieceIds` list what the runtime has to switch off before starting
 * it. The function is pure and reads nothing but its arguments: host and replica derive the same
 * timeline from the same events, which is what keeps the two towers identical without sending a
 * single animation command over the wire.
 * @param {{ breakScenes?: readonly Readonly<MapDestructibleBreakScene>[] } | null | undefined} definition
 * @param {unknown} events
 * @returns {MapDestructibleSceneTimelineEntry[]}
 */
export function resolveMapDestructibleSceneTimeline(definition, events) {
    /** @type {MapDestructibleSceneTimelineEntry[]} */
    const timeline = [];
    /** @type {Set<string>} */
    const consumed = new Set();
    for (const event of Array.isArray(events) ? events : []) {
        const scene = resolveMapDestructibleBreakScene(definition, event);
        if (!scene) continue;
        const source = /** @type {Record<string, unknown>} */ (event);
        timeline.push({
            sceneId: scene.id,
            modelId: scene.modelVariants?.[readVariantIndex(source.variantIndex)] || scene.modelId,
            atSeconds: readAtSeconds(source.atSeconds),
            // The event says where the piece falls; the scene says where its clip already falls.
            // What the runtime needs is the difference between the two.
            yaw: normalizeHeading(normalizeHeading(source.yaw) - scene.bakedHeading),
            yawFromEvent: scene.yawFromEvent,
            hideModelIds: [...scene.hideModelIds],
            attachedModels: scene.attachedModels,
            hiddenPieceIds: scene.pieces.filter((piece) => consumed.has(piece)),
        });
        for (const piece of scene.pieces) consumed.add(piece);
    }
    return timeline;
}

/**
 * Every segment whose longest matching prefix is the longest match of all, in declaration
 * order. Usually that is exactly one segment; the four legs of an intact tower share their
 * mesh names and therefore come back together.
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @param {unknown} meshName
 * @returns {Readonly<MapDestructibleSegment>[]}
 */
function collectMapDestructibleSegmentsByMeshName(definition, meshName) {
    const segments = definition?.segments;
    if (!segments || typeof meshName !== 'string') return [];
    const name = meshName.trim().toLowerCase();
    if (!name) return [];

    /** @type {Readonly<MapDestructibleSegment>[]} */
    let matches = [];
    let bestLength = 0;
    for (const segment of segments) {
        let length = 0;
        for (const prefix of segment.meshPrefixes) {
            if (prefix.length > length && name.startsWith(prefix)) length = prefix.length;
        }
        if (length === 0 || length < bestLength) continue;
        if (length > bestLength) {
            bestLength = length;
            matches = [];
        }
        matches.push(segment);
    }
    return matches;
}

/**
 * @param {unknown} source
 * @returns {number[] | null}
 */
function readPoint(source) {
    const axes = Array.isArray(source)
        ? [source[0], source[1], source[2]]
        : (isRecord(source) ? [source.x, source.y, source.z] : null);
    if (!axes) return null;
    const point = [0, 0, 0];
    let known = false;
    for (let axis = 0; axis < 3; axis += 1) {
        const value = Number(axes[axis]);
        if (!Number.isFinite(value)) continue;
        point[axis] = value;
        known = true;
    }
    return known ? point : null;
}

/**
 * Which segment a hit mesh belongs to. Matching is case-insensitive and the longest prefix
 * wins, so `tower_leg_a_lower` can sit under a segment while `tower_leg_a` covers the rest.
 *
 * Several segments may share the very same prefixes; this resolver then returns the first of
 * them. Callers that know where the shot landed use resolveMapDestructibleSegmentByHit instead.
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @param {unknown} meshName
 * @returns {Readonly<MapDestructibleSegment> | null}
 */
export function resolveMapDestructibleSegmentByMeshName(definition, meshName) {
    return collectMapDestructibleSegmentsByMeshName(definition, meshName)[0] || null;
}

/**
 * Which segment a hit belongs to when the mesh name alone cannot tell.
 *
 * The intact tower exports one mesh per material per part, so all four lower legs answer to
 * the same names. Those segments therefore share their prefixes and differ only by `anchor` -
 * the foot of the leg in authored units. The hit closest to an anchor is the hit on that leg,
 * which is why a map that scales its authored anchors passes the same factor in here.
 *
 * A longer prefix still beats a nearer anchor: naming a piece exactly is always the stronger
 * statement. Without a usable hit point the first matching segment is returned, so a caller
 * that has no impact position behaves exactly like the mesh-name resolver.
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @param {unknown} meshName
 * @param {unknown} [hitPoint] World position of the impact, as [x,y,z] or {x,y,z}.
 * @param {number} [anchorScale] Factor the authored anchors are built at.
 * @returns {Readonly<MapDestructibleSegment> | null}
 */
export function resolveMapDestructibleSegmentByHit(definition, meshName, hitPoint, anchorScale = 1) {
    const matches = collectMapDestructibleSegmentsByMeshName(definition, meshName);
    if (matches.length <= 1) return matches[0] || null;

    const point = readPoint(hitPoint);
    if (!point) return matches[0];
    const parsedScale = Number(anchorScale);
    const scale = Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1;

    let best = matches[0];
    let bestDistance = Infinity;
    for (const segment of matches) {
        let distance = 0;
        for (let axis = 0; axis < 3; axis += 1) {
            const delta = segment.anchor[axis] * scale - point[axis];
            distance += delta * delta;
        }
        // Strictly nearer only, so equal distances keep the declaration order.
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = segment;
    }
    return best;
}

/**
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @param {string} segmentId
 * @returns {Readonly<MapDestructibleSegment> | null}
 */
function findDefinitionSegment(definition, segmentId) {
    for (const segment of definition?.segments ?? []) {
        if (segment.id === segmentId) return segment;
    }
    return null;
}

/**
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @returns {MapDestructibleState}
 */
export function createMapDestructibleState(definition) {
    /** @type {MapDestructibleSegmentState[]} */
    const segments = [];
    for (const segment of definition?.segments ?? []) {
        segments.push({
            id: segment.id,
            hp: segment.hp,
            maxHp: segment.hp,
            destroyed: false,
            collapsed: false,
            destroyedAtSeconds: -1,
            yaw: 0,
            lastHitAtSeconds: -1,
        });
    }
    return { segments, events: [], sealed: false };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function readAtSeconds(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Match time of the last hit, or -1 for a segment nobody has shot at yet.
 * @param {unknown} value
 * @returns {number}
 */
function readLastHitAtSeconds(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : -1;
}

/**
 * Heading of a horizontal direction, as atan2(x, z). A vertical or zero direction has no side to
 * fall towards, so it falls back to 0 instead of producing a random-looking angle.
 * @param {unknown} source
 * @returns {number}
 */
function readDirectionHeading(source) {
    let x = 0;
    let z = 0;
    if (Array.isArray(source)) {
        x = Number(source[0]);
        z = Number(source[2]);
    } else if (isRecord(source)) {
        x = Number(source.x);
        z = Number(source.z);
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    if (x * x + z * z <= DIRECTION_EPSILON) return 0;
    return Math.atan2(x, z);
}

/**
 * Every standing segment whose piece this scene carries away goes down with it.
 *
 * A collapse takes whole pieces of the tower, not single segments: once the shaft is falling, the
 * summit on top of it is gone too, and a HUD that still offered it as a target would be pointing
 * at geometry that no longer exists. These segments record no event of their own - they are part of
 * the one collapse that is already playing.
 * @param {MapDestructibleState} state
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @param {Readonly<MapDestructibleBreakScene>} scene
 * @param {number} atSeconds
 * @returns {void}
 */
function collapseScenePieces(state, definition, scene, atSeconds) {
    if (scene.pieces.length === 0) return;
    for (const segment of state.segments) {
        if (segment.destroyed === true) continue;
        const authored = findDefinitionSegment(definition, segment.id);
        if (!authored || !scene.pieces.includes(authored.piece)) continue;
        segment.hp = 0;
        segment.destroyed = true;
        segment.collapsed = true;
        segment.destroyedAtSeconds = atSeconds;
    }
}

/**
 * Applies weapon damage to one segment. Ignored once the tower is sealed, on an unknown or
 * already destroyed segment and for a non-positive damage value.
 *
 * A break records the world heading the piece falls towards: a leg comes down onto its own corner,
 * the shaft and the summit fly along the shot that felled them. Whatever collapse that starts also
 * takes every other segment standing in the pieces it carries away.
 * @param {MapDestructibleState | null | undefined} state
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[], breakScenes?: readonly Readonly<MapDestructibleBreakScene>[] } | null | undefined} definition
 * @param {unknown} segmentId
 * @param {unknown} damage
 * @param {{ atSeconds?: unknown, hitDirection?: unknown, chooseVariant?: (count: number) => number }} [options]
 * @returns {MapDestructibleDamageResult}
 */
export function applyMapDestructibleDamage(state, definition, segmentId, damage, options = {}) {
    /** @type {MapDestructibleDamageResult} */
    const result = { applied: false, segment: null, destroyed: false, event: null };
    if (!state || state.sealed) return result;

    const id = typeof segmentId === 'string' ? segmentId.trim() : '';
    const amount = Number(damage);
    if (!id || !Number.isFinite(amount) || amount <= 0) return result;

    const segment = state.segments.find((entry) => entry.id === id) || null;
    if (!segment || segment.destroyed) return result;

    const atSeconds = readAtSeconds(options?.atSeconds);
    result.segment = segment;
    result.applied = true;
    segment.hp = Math.max(0, segment.hp - amount);
    // The HUD picks the segment under fire; when two are equally hurt the newer hit wins.
    segment.lastHitAtSeconds = atSeconds;
    if (segment.hp > 0) return result;

    const authored = findDefinitionSegment(definition, id);
    const rule = resolveMapDestructibleKindRule(authored?.kind) || MAP_DESTRUCTIBLE_KINDS.shaft;
    // A leg falls onto itself: the heading of its own corner, measured from the tower axis. The
    // shaft and the summit have no corner, so they follow the shot instead.
    const yaw = rule.yawFrom === 'segment'
        ? readDirectionHeading(authored?.anchor)
        : readDirectionHeading(options?.hitDirection);

    segment.destroyed = true;
    segment.destroyedAtSeconds = atSeconds;
    segment.yaw = yaw;
    const identity = { segmentId: id, kind: rule.kind, atSeconds, yaw };
    const variantScene = resolveMapDestructibleBreakScene(definition, identity);
    const count = variantScene?.modelVariants?.length || 1;
    const event = Object.freeze({ ...identity,
        ...(count > 1 ? { variantIndex: Math.min(count - 1,
            readVariantIndex(options.chooseVariant?.(count))) } : {}),
    });
    state.events.push(event);
    if (rule.sealsTower) state.sealed = true;
    result.destroyed = true;
    result.event = event;

    const scene = resolveMapDestructibleBreakScene(definition, event);
    if (scene) collapseScenePieces(state, definition, scene, atSeconds);
    return result;
}

/**
 * @param {MapDestructibleState | null | undefined} state
 * @returns {{ sealed: boolean, segments: MapDestructibleSegmentState[], events: MapDestructibleEvent[] }}
 */
export function serializeMapDestructibleState(state) {
    /** @type {MapDestructibleSegmentState[]} */
    const segments = [];
    for (const segment of state?.segments ?? []) {
        segments.push({
            id: segment.id,
            hp: segment.hp,
            maxHp: segment.maxHp,
            destroyed: segment.destroyed === true,
            collapsed: segment.collapsed === true,
            destroyedAtSeconds: segment.destroyedAtSeconds,
            yaw: segment.yaw,
            lastHitAtSeconds: readLastHitAtSeconds(segment.lastHitAtSeconds),
        });
    }
    /** @type {MapDestructibleEvent[]} */
    const events = [];
    for (const event of state?.events ?? []) {
        events.push({
            segmentId: event.segmentId,
            kind: event.kind,
            atSeconds: event.atSeconds,
            yaw: event.yaw,
            ...(event.variantIndex !== undefined ? { variantIndex: readVariantIndex(event.variantIndex) } : {}),
        });
    }
    return { sealed: state?.sealed === true, segments, events };
}

/**
 * Replaces the whole state with what the host sent. A replica never simulates damage of its
 * own, so merging would only be a chance to drift apart.
 * @param {MapDestructibleState} state
 * @param {unknown} serialized
 * @returns {MapDestructibleState}
 */
export function applyMapDestructibleNetworkState(state, serialized) {
    if (!state) return state;
    const source = isRecord(serialized) ? serialized : {};

    /** @type {MapDestructibleSegmentState[]} */
    const segments = [];
    for (const entry of Array.isArray(source.segments) ? source.segments : []) {
        if (!isRecord(entry)) continue;
        const id = readText(entry.id, '', MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
        if (!id) continue;
        const maxHp = clampNumber(
            entry.maxHp,
            MAP_DESTRUCTIBLE_LIMITS.hp.min,
            MAP_DESTRUCTIBLE_LIMITS.hp.max,
            MAP_DESTRUCTIBLE_LIMITS.hp.fallback,
        );
        const destroyed = entry.destroyed === true;
        segments.push({
            id,
            hp: destroyed ? 0 : clampNumber(entry.hp, 0, maxHp, maxHp),
            maxHp,
            destroyed,
            // Only something that is gone can have gone down with a piece.
            collapsed: destroyed && entry.collapsed === true,
            destroyedAtSeconds: destroyed ? readAtSeconds(entry.destroyedAtSeconds) : -1,
            yaw: clampNumber(entry.yaw, -Math.PI * 2, Math.PI * 2, 0),
            lastHitAtSeconds: readLastHitAtSeconds(entry.lastHitAtSeconds),
        });
    }

    /** @type {MapDestructibleEvent[]} */
    const events = [];
    for (const entry of Array.isArray(source.events) ? source.events : []) {
        if (!isRecord(entry)) continue;
        const rule = resolveMapDestructibleKindRule(entry.kind);
        const segmentId = readText(entry.segmentId, '', MAP_DESTRUCTIBLE_LIMITS.idMaxLength);
        if (!rule || !segmentId) continue;
        events.push({
            segmentId,
            kind: rule.kind,
            atSeconds: readAtSeconds(entry.atSeconds),
            ...(entry.variantIndex !== undefined ? { variantIndex: readVariantIndex(entry.variantIndex) } : {}),
            yaw: clampNumber(entry.yaw, -Math.PI * 2, Math.PI * 2, 0),
        });
    }

    state.segments = segments;
    state.events = events;
    state.sealed = source.sealed === true;
    return state;
}

/**
 * How long the last break is still announced. The countdown runs on the map clock, so host and
 * replica show it for exactly as long. A clock that has not started yet - or was reset between
 * rounds - shows the full announcement rather than none.
 * @param {MapDestructibleState | null | undefined} state
 * @param {unknown} elapsedSeconds
 * @returns {number}
 */
function resolveBreakingSecondsRemaining(state, elapsedSeconds) {
    const events = state?.events;
    const last = Array.isArray(events) && events.length > 0 ? events[events.length - 1] : null;
    if (!last) return 0;
    const elapsed = Number(elapsedSeconds);
    const since = Number.isFinite(elapsed) ? elapsed - readAtSeconds(last.atSeconds) : 0;
    return Math.max(0, MAP_DESTRUCTIBLE_HUD.breakingAnnounceSeconds - Math.max(0, since));
}

/**
 * What the HUD needs: the segment currently under fire, which segment caused the last break, how
 * long that break is still announced, and how much is left of every segment.
 *
 * The focus is the standing segment with the least health left - what a player is shooting at
 * right now. Two equally hurt segments are decided by the newer hit, so the line does not jump
 * back and forth while one of them is being worked on. A segment that went down with somebody
 * else's piece is not standing either, and a sealed tower has no target left at all - pointing at
 * one would send a player shooting at geometry that is lying on the esplanade. Pure and
 * deterministic: the same state and the same map time always give the same HUD.
 * @param {MapDestructibleState | null | undefined} state
 * @param {{ segments?: readonly Readonly<MapDestructibleSegment>[] } | null | undefined} definition
 * @param {unknown} [elapsedSeconds] Match time the map clock stands at.
 * @returns {MapDestructibleHudState}
 */
export function resolveMapDestructibleHudState(state, definition, elapsedSeconds = 0) {
    /** @type {MapDestructibleHudSegment[]} */
    const segments = [];
    /** @type {MapDestructibleHudSegment | null} */
    let focusSegment = null;
    let focusRatio = Infinity;
    let focusAtSeconds = -1;
    const sealed = state?.sealed === true;

    for (const segment of state?.segments ?? []) {
        const authored = findDefinitionSegment(definition, segment.id);
        const maxHp = Number.isFinite(segment.maxHp) && segment.maxHp > 0 ? segment.maxHp : 0;
        const entry = {
            id: segment.id,
            label: authored?.label || segment.id,
            ratio: maxHp > 0 ? Math.min(1, Math.max(0, segment.hp / maxHp)) : 0,
        };
        segments.push(entry);
        if (sealed || segment.destroyed === true || entry.ratio >= 1) continue;
        const atSeconds = readLastHitAtSeconds(segment.lastHitAtSeconds);
        if (focusSegment && !(entry.ratio < focusRatio
            || (entry.ratio === focusRatio && atSeconds > focusAtSeconds))) continue;
        focusSegment = entry;
        focusRatio = entry.ratio;
        focusAtSeconds = atSeconds;
    }

    const breakingSecondsRemaining = resolveBreakingSecondsRemaining(state, elapsedSeconds);
    if (breakingSecondsRemaining > 0) {
        const events = Array.isArray(state?.events) ? state.events : [];
        const lastEvent = events.length > 0 ? events[events.length - 1] : null;
        focusSegment = segments.find((entry) => entry.id === lastEvent?.segmentId) || null;
    }
    return {
        active: focusSegment !== null || breakingSecondsRemaining > 0,
        sealed,
        focusSegment,
        breakingSecondsRemaining,
        segments,
    };
}
