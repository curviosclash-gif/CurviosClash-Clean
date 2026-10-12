// The underground vault every storm siege map hides below its field: a 1-unit hard shell around a
// square room, nine pickups on two levels plus the prizes every secret room holds. Only the room
// size, the unlock timing and the three portal points differ per map.

const WALL = 1;

function createShell(half, floor, ceiling) {
    const midY = (floor + ceiling) / 2;
    const height = ceiling - floor;
    const shell = half + WALL;
    return Object.freeze([
        { pos: [0, floor - WALL / 2, 0], size: [shell * 2, WALL, shell * 2] },
        { pos: [0, ceiling + WALL / 2, 0], size: [shell * 2, WALL, shell * 2] },
        { pos: [-half - WALL / 2, midY, 0], size: [WALL, height, shell * 2] },
        { pos: [half + WALL / 2, midY, 0], size: [WALL, height, shell * 2] },
        { pos: [0, midY, -half - WALL / 2], size: [shell * 2, height, WALL] },
        { pos: [0, midY, half + WALL / 2], size: [shell * 2, height, WALL] },
    ].map((box) => Object.freeze({ ...box, kind: 'hard', renderWithGlb: true, compileWithGlb: true })));
}

// Each pickup is mirrored half a room height lower, so the vault is two floors of the same layout.
function createItems(half, floor, ceiling) {
    const height = ceiling - floor;
    const corner = half - 7;
    const cornerY = floor + 18;
    const ringY = floor + 20;
    const prizeZ = half - 4;
    return Object.freeze([
        ...[
            [-corner, cornerY, -corner], [corner, cornerY, -corner], [corner, cornerY, corner], [-corner, cornerY, corner],
            [0, ringY, 0], [-7, ringY, 0], [7, ringY, 0], [0, ringY, 7], [0, ringY, -7],
        ].map((pos) => ({ pos })),
        // The prizes every secret room holds (user decision 28.09.2026).
        { pos: [0, cornerY, -prizeZ], type: 'BOMBER_STRIKE' },
        { pos: [0, cornerY, prizeZ], type: 'LIGHTNING' },
    ].flatMap((item) => [
        item,
        { ...item, pos: [item.pos[0], item.pos[1] - height / 2, item.pos[2]] },
    ]).map(({ pos, type }) => Object.freeze({ pos: Object.freeze(pos), ...(type ? { type } : {}) })));
}

/**
 * @param {object} spec
 * @param {string} spec.id room id
 * @param {number} spec.half half edge of the room
 * @param {number} spec.floor y of the floor
 * @param {number} spec.ceiling y of the ceiling
 * @param {string} spec.destructible id of the segment whose break opens the room
 * @param {number} spec.delaySeconds time between that break and the opening
 * @param {{ pos: number[], color: number }} spec.entryPortal portal on the field
 * @param {number[]} spec.ejectPos where a player leaves the room
 * @param {number} spec.ejectYawDeg heading after leaving
 * @returns {{ room: object, obstacles: ReadonlyArray<object> }}
 */
export function createVaultRoom({
    id, half, floor, ceiling, destructible, delaySeconds, entryPortal, ejectPos, ejectYawDeg,
}) {
    const roomY = floor + 18;
    return {
        obstacles: createShell(half, floor, ceiling),
        room: Object.freeze({
            id,
            modes: Object.freeze(['HUNT', 'ARCADE']),
            unlock: Object.freeze({ destructible, when: 'anyBreak', delaySeconds }),
            stayLimitSeconds: 20,
            refillSeconds: 30,
            entryPortal: Object.freeze({ pos: Object.freeze(entryPortal.pos), color: entryPortal.color }),
            roomPortal: Object.freeze({ pos: Object.freeze([0, roomY, 0]) }),
            bounds: Object.freeze({
                min: Object.freeze([-half, floor, -half]),
                max: Object.freeze([half, ceiling, half]),
            }),
            ejectPoint: Object.freeze({ pos: Object.freeze(ejectPos), yawDeg: ejectYawDeg }),
            items: createItems(half, floor, ceiling),
        }),
    };
}
