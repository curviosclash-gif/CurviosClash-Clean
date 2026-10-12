import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';

// Shared frame of the storm siege maps (bridge, lighthouse, dam): one landmark that collapses, a
// foam floor over the whole field, a vault below it, and the same HUNT scenario. Everything that
// makes a map its own (lighting, spawns, items, gates, water) is passed in.

const ALL_OPEN_FACES = ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'];

/**
 * One landmark segment that breaks into one collapse scene. The wreck lands where it was authored
 * (yawFromEvent false), so it can serve as a traversal ramp.
 * @param {object} spec
 * @param {string} spec.segmentId mesh prefix and segment id
 * @param {string} spec.label HUD word for the landmark
 * @param {number} spec.hp
 * @param {number[]} spec.anchor
 * @param {string} spec.sceneId
 * @param {string} spec.collapseModelId
 * @param {string[]} spec.hideModelIds models replaced by the wreck
 * @param {{ radius: number, damage: number, delaySeconds: number }} spec.blast
 */
export function createLandmarkDestructibles({
    segmentId, label, hp, anchor, sceneId, collapseModelId, hideModelIds, blast,
}) {
    return Object.freeze({
        gameModes: Object.freeze(['HUNT']),
        hudNoun: label,
        segments: Object.freeze([Object.freeze({
            id: segmentId,
            label,
            kind: 'landmark',
            hp,
            meshPrefixes: Object.freeze([segmentId]),
            anchor: Object.freeze(anchor),
        })]),
        pieces: Object.freeze(['landmark']),
        breakScenes: Object.freeze([Object.freeze({
            id: sceneId,
            trigger: Object.freeze({ segmentId }),
            modelId: collapseModelId,
            pieces: Object.freeze(['landmark']),
            hideModelIds: Object.freeze(hideModelIds),
            yawFromEvent: false,
            blast: Object.freeze(blast),
        })]),
    });
}

/**
 * @param {object} spec
 * @param {string} spec.id map key, also the id of its single-player scenario
 * @param {string} spec.name
 * @param {number[]} spec.size field size, the foam floor covers x and z
 * @param {string[]} [spec.openFaces] faces without a ceiling or wall
 * @param {object[]} [spec.wallObstacles] hard boxes between the foam floor and the vault shell
 * @param {{ room: object, obstacles: ReadonlyArray<object> }} spec.vault from createVaultRoom
 * @param {ReadonlyArray<object>} spec.glbModels
 * @param {object} spec.destructibles from createLandmarkDestructibles
 * @param {object} [spec.extras] map fields between destructibles and lighting (gates, lights, waterZone)
 * @param {object} spec.lighting input of normalizeMapLighting
 * @param {object} spec.playerSpawn
 * @param {ReadonlyArray<object>} spec.botSpawns
 * @param {ReadonlyArray<object>} spec.items
 */
export function createLandmarkSiegeMap({
    id, name, size, openFaces = ALL_OPEN_FACES, wallObstacles = [], vault, glbModels, destructibles,
    extras = {}, lighting, playerSpawn, botSpawns, items,
}) {
    return Object.freeze({
        [id]: Object.freeze({
            name,
            size: Object.freeze(size),
            scaleAuthoredAnchors: true,
            exclusionZone: Object.freeze({ openFaces: Object.freeze(openFaces) }),
            obstacles: Object.freeze([
                Object.freeze({ pos: [0, 2, 0], size: [size[0], 4, size[2]], kind: 'foam', compileWithGlb: true }),
                ...wallObstacles,
                ...vault.obstacles,
            ]),
            portals: Object.freeze([]),
            secretRooms: Object.freeze([vault.room]),
            glbModels,
            glbColliderMode: 'scene',
            glbAuthoredObstaclesCollisionOnly: true,
            destructibles,
            ...extras,
            lighting: normalizeMapLighting(lighting),
            playerSpawn,
            botSpawns,
            items,
            singlePlayerScenario: Object.freeze({
                enabled: true,
                id,
                modePath: 'fight',
                gameMode: 'HUNT',
                minBots: 3,
                botCount: 5,
            }),
        }),
    });
}
