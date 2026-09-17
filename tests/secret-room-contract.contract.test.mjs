import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SECRET_ROOM_CONTRACT_VERSION,
    SECRET_ROOM_LIMITS,
    SECRET_ROOM_MODES,
    isPointInSecretRoom,
    isSecretRoomActiveInMode,
    normalizeSecretRooms,
    resolveSecretRoomUnlockSeconds,
} from '../src/shared/contracts/SecretRoomContract.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';

function authoredRoom(overrides = {}) {
    return {
        id: 'vault',
        modes: ['HUNT', 'ARCADE'],
        entryPortal: { pos: [100, 20, 0], color: 0xff00ff },
        roomPortal: { pos: [0, -200, 0] },
        bounds: { min: [-50, -250, -50], max: [50, -150, 50] },
        ejectPoint: { pos: [120, 30, 10], yawDeg: 90 },
        stayLimitSeconds: 25,
        refillSeconds: 40,
        items: [{ pos: [10, -200, 10], type: 'rocket' }],
        unlock: { destructible: 'eiffel', when: 'anyBreak', delaySeconds: 4 },
        ...overrides,
    };
}

function firstRoom(overrides = {}) {
    const rooms = normalizeSecretRooms([authoredRoom(overrides)]);
    return rooms[0];
}

test('T-SR1: contract version and limits are frozen house values', () => {
    assert.equal(SECRET_ROOM_CONTRACT_VERSION, 'secret-room.v1');
    assert.deepEqual([...SECRET_ROOM_MODES], ['HUNT', 'ARCADE']);
    assert.equal(SECRET_ROOM_LIMITS.maxRooms, 3);
    assert.equal(SECRET_ROOM_LIMITS.maxItems, 16);
    assert.equal(SECRET_ROOM_LIMITS.stayLimitSeconds.fallback, 20);
    assert.equal(SECRET_ROOM_LIMITS.stayLimitSeconds.min, 5);
    assert.equal(SECRET_ROOM_LIMITS.stayLimitSeconds.max, 120);
    assert.equal(SECRET_ROOM_LIMITS.refillSeconds.fallback, 30);
    assert.equal(SECRET_ROOM_LIMITS.refillSeconds.min, 5);
    assert.equal(SECRET_ROOM_LIMITS.refillSeconds.max, 300);
    assert.equal(SECRET_ROOM_LIMITS.unlockDelaySeconds.fallback, 4);
    assert.equal(SECRET_ROOM_LIMITS.unlockDelaySeconds.max, 60);
    assert.throws(() => {
        SECRET_ROOM_LIMITS.maxRooms = 9;
    });
});

test('T-SR2: a fully authored room keeps every field', () => {
    const room = firstRoom();
    assert.equal(room.id, 'vault');
    assert.deepEqual([...room.modes], ['HUNT', 'ARCADE']);
    assert.deepEqual([...room.entryPortal.pos], [100, 20, 0]);
    assert.equal(room.entryPortal.color, 0xff00ff);
    assert.deepEqual([...room.roomPortal.pos], [0, -200, 0]);
    assert.deepEqual([...room.bounds.min], [-50, -250, -50]);
    assert.deepEqual([...room.bounds.max], [50, -150, 50]);
    assert.deepEqual([...room.ejectPoint.pos], [120, 30, 10]);
    assert.equal(room.ejectPoint.yawDeg, 90);
    assert.equal(room.stayLimitSeconds, 25);
    assert.equal(room.refillSeconds, 40);
    assert.equal(room.items.length, 1);
    assert.deepEqual([...room.items[0].pos], [10, -200, 10]);
    assert.equal(room.items[0].type, 'ROCKET');
    assert.equal(room.unlock.destructible, 'eiffel');
    assert.equal(room.unlock.when, 'anyBreak');
    assert.equal(room.unlock.delaySeconds, 4);
});

test('T-SR3: missing optional fields fall back to the balancing defaults', () => {
    const room = firstRoom({
        modes: undefined,
        stayLimitSeconds: undefined,
        refillSeconds: undefined,
        items: undefined,
        unlock: undefined,
        entryPortal: { pos: [100, 20, 0] },
        ejectPoint: { pos: [120, 30, 10] },
    });
    assert.deepEqual([...room.modes], ['HUNT', 'ARCADE']);
    assert.equal(room.stayLimitSeconds, 20);
    assert.equal(room.refillSeconds, 30);
    assert.deepEqual(room.items, []);
    assert.equal(room.unlock, null);
    assert.equal(room.ejectPoint.yawDeg, 0);
    assert.equal(typeof room.entryPortal.color, 'number');
});

test('T-SR4: numeric fields are clamped to their range', () => {
    assert.equal(firstRoom({ stayLimitSeconds: 1 }).stayLimitSeconds, 5);
    assert.equal(firstRoom({ stayLimitSeconds: 999 }).stayLimitSeconds, 120);
    assert.equal(firstRoom({ refillSeconds: 0 }).refillSeconds, 5);
    assert.equal(firstRoom({ refillSeconds: 9999 }).refillSeconds, 300);
    assert.equal(firstRoom({ stayLimitSeconds: 'abc' }).stayLimitSeconds, 20);
    const clampedDelay = firstRoom({ unlock: { destructible: 'eiffel', delaySeconds: 999 } });
    assert.equal(clampedDelay.unlock.delaySeconds, 60);
    const negativeDelay = firstRoom({ unlock: { destructible: 'eiffel', delaySeconds: -5 } });
    assert.equal(negativeDelay.unlock.delaySeconds, 0);
});

test('T-SR5: yaw is folded into [0, 360)', () => {
    assert.equal(firstRoom({ ejectPoint: { pos: [120, 30, 10], yawDeg: 450 } }).ejectPoint.yawDeg, 90);
    assert.equal(firstRoom({ ejectPoint: { pos: [120, 30, 10], yawDeg: -90 } }).ejectPoint.yawDeg, 270);
});

test('T-SR6: empty and duplicate ids drop the room', () => {
    const rooms = normalizeSecretRooms([
        authoredRoom({ id: 'vault' }),
        authoredRoom({ id: '  vault  ' }),
        authoredRoom({ id: '   ' }),
        authoredRoom({ id: 42 }),
        authoredRoom({ id: 'second' }),
    ]);
    assert.deepEqual(rooms.map((room) => room.id), ['vault', 'second']);
});

test('T-SR7: swapped bounds are put back in order, degenerate bounds drop the room', () => {
    const swapped = firstRoom({ bounds: { min: [50, -150, 50], max: [-50, -250, -50] } });
    assert.deepEqual([...swapped.bounds.min], [-50, -250, -50]);
    assert.deepEqual([...swapped.bounds.max], [50, -150, 50]);
    assert.equal(normalizeSecretRooms([authoredRoom({ bounds: { min: [0, 0, 0], max: [0, 0, 0] } })]).length, 0);
    assert.equal(normalizeSecretRooms([authoredRoom({ bounds: { min: [-50, -250, -50], max: [50, -250, 50] } })]).length, 0);
    assert.equal(normalizeSecretRooms([authoredRoom({ bounds: undefined })]).length, 0);
});

test('T-SR8: the way back has to sit inside the room, the way in and out outside it', () => {
    assert.equal(normalizeSecretRooms([authoredRoom({ roomPortal: { pos: [900, 900, 900] } })]).length, 0);
    assert.equal(normalizeSecretRooms([authoredRoom({ entryPortal: { pos: [0, -200, 0] } })]).length, 0);
    assert.equal(normalizeSecretRooms([authoredRoom({ ejectPoint: { pos: [0, -200, 0] } })]).length, 0);
    assert.equal(normalizeSecretRooms([authoredRoom({ roomPortal: undefined })]).length, 0);
    assert.equal(normalizeSecretRooms([authoredRoom({ entryPortal: { pos: [1, 'x', 0] } })]).length, 0);
});

test('T-SR9: items outside the room are dropped, the room survives', () => {
    const room = firstRoom({
        items: [
            { pos: [10, -200, 10] },
            { pos: [900, 900, 900] },
            { pos: [-50, -250, -50] },
            { pos: [1, 2] },
            'nonsense',
        ],
    });
    assert.equal(room.items.length, 2);
    assert.deepEqual([...room.items[1].pos], [-50, -250, -50]);
    assert.equal(room.items[0].type, undefined);
});

test('T-SR10: item count and room count have hard ceilings', () => {
    const manyItems = Array.from({ length: 30 }, () => ({ pos: [0, -200, 0] }));
    assert.equal(firstRoom({ items: manyItems }).items.length, SECRET_ROOM_LIMITS.maxItems);
    const manyRooms = Array.from({ length: 6 }, (_, index) => authoredRoom({ id: `vault_${index}` }));
    assert.equal(normalizeSecretRooms(manyRooms).length, SECRET_ROOM_LIMITS.maxRooms);
});

test('T-SR11: modes are filtered and default to both', () => {
    assert.deepEqual([...firstRoom({ modes: ['hunt'] }).modes], ['HUNT']);
    assert.deepEqual([...firstRoom({ modes: ['CLASSIC'] }).modes], ['HUNT', 'ARCADE']);
    assert.deepEqual([...firstRoom({ modes: [] }).modes], ['HUNT', 'ARCADE']);
    assert.deepEqual([...firstRoom({ modes: 'HUNT' }).modes], ['HUNT', 'ARCADE']);
    assert.deepEqual([...firstRoom({ modes: ['HUNT', 'HUNT'] }).modes], ['HUNT']);
});

test('T-SR12: isSecretRoomActiveInMode answers per mode', () => {
    const huntOnly = firstRoom({ modes: ['HUNT'] });
    assert.equal(isSecretRoomActiveInMode(huntOnly, 'HUNT'), true);
    assert.equal(isSecretRoomActiveInMode(huntOnly, 'hunt'), true);
    assert.equal(isSecretRoomActiveInMode(huntOnly, 'ARCADE'), false);
    assert.equal(isSecretRoomActiveInMode(huntOnly, null), false);
    assert.equal(isSecretRoomActiveInMode(null, 'HUNT'), false);
    assert.equal(isSecretRoomActiveInMode({ id: 'x' }, 'CLASSIC'), true);
});

test('T-SR13: unlock variants normalize, an unnamed structure drops the room', () => {
    assert.equal(firstRoom({ unlock: { destructible: 'eiffel' } }).unlock.when, 'anyBreak');
    assert.equal(firstRoom({ unlock: { destructible: 'eiffel' } }).unlock.delaySeconds, 4);
    assert.equal(firstRoom({ unlock: { destructible: 'eiffel', when: 'sealed' } }).unlock.when, 'sealed');
    const bySegment = firstRoom({ unlock: { destructible: 'eiffel', when: { segmentId: 'leg_a' } } });
    assert.equal(bySegment.unlock.when, 'segment');
    assert.equal(bySegment.unlock.segmentId, 'leg_a');
    assert.equal(firstRoom({ unlock: { destructible: 'eiffel', when: 'later' } }).unlock.when, 'anyBreak');
    assert.equal(firstRoom({ unlock: { destructible: 'eiffel', when: { segmentId: '' } } }).unlock.when, 'anyBreak');
    assert.equal(normalizeSecretRooms([authoredRoom({ unlock: { when: 'sealed' } })]).length, 0);
    assert.equal(firstRoom({ unlock: 'yes' }).unlock, null);
});

test('T-SR14: garbage input never throws and yields an empty list', () => {
    assert.deepEqual(normalizeSecretRooms(undefined), []);
    assert.deepEqual(normalizeSecretRooms(null), []);
    assert.deepEqual(normalizeSecretRooms(7), []);
    assert.deepEqual(normalizeSecretRooms('rooms'), []);
    assert.deepEqual(normalizeSecretRooms({ id: 'vault' }), []);
    assert.deepEqual(normalizeSecretRooms([null, 5, 'x', []]), []);
});

test('T-SR15: normalizeSecretRooms can report why an entry was dropped', () => {
    const warnings = [];
    normalizeSecretRooms([authoredRoom({ id: '' })], { warnings });
    assert.equal(warnings.length > 0, true);
    assert.equal(warnings.every((entry) => typeof entry === 'string'), true);
});

test('T-SR16: isPointInSecretRoom is inclusive on the faces', () => {
    const room = firstRoom();
    assert.equal(isPointInSecretRoom(room, [0, -200, 0]), true);
    assert.equal(isPointInSecretRoom(room, { x: 0, y: -200, z: 0 }), true);
    assert.equal(isPointInSecretRoom(room, [-50, -250, -50]), true);
    assert.equal(isPointInSecretRoom(room, [50, -150, 50]), true);
    assert.equal(isPointInSecretRoom(room, [50.0001, -150, 50]), false);
    assert.equal(isPointInSecretRoom(room, [0, -149.9, 0]), false);
    assert.equal(isPointInSecretRoom(room, null), false);
    assert.equal(isPointInSecretRoom(null, [0, 0, 0]), false);
    assert.equal(isPointInSecretRoom(room, ['a', 0, 0]), false);
});

test('T-SR17: a room without unlock is open from the first second', () => {
    const room = firstRoom({ unlock: undefined });
    assert.equal(resolveSecretRoomUnlockSeconds(room, null), 0);
    assert.equal(resolveSecretRoomUnlockSeconds(room, { events: [], sealed: false }), 0);
    assert.equal(resolveSecretRoomUnlockSeconds(room, 'broken'), 0);
});

test('T-SR18: anyBreak takes the earliest event plus the delay', () => {
    const room = firstRoom();
    const state = {
        sealed: false,
        events: [
            { segmentId: 'shaft', kind: 'shaft', atSeconds: 41 },
            { segmentId: 'leg_a', kind: 'leg_mid', atSeconds: 12 },
        ],
    };
    assert.equal(resolveSecretRoomUnlockSeconds(room, state), 16);
    assert.equal(resolveSecretRoomUnlockSeconds(room, { sealed: false, events: [] }), Infinity);
    assert.equal(resolveSecretRoomUnlockSeconds(room, null), Infinity);
    assert.equal(resolveSecretRoomUnlockSeconds(room, { events: 'nope' }), Infinity);
});

test('T-SR19: a named segment only counts its own breaks', () => {
    const room = firstRoom({ unlock: { destructible: 'eiffel', when: { segmentId: 'leg_a' }, delaySeconds: 2 } });
    const state = {
        sealed: false,
        events: [
            { segmentId: 'shaft', kind: 'shaft', atSeconds: 5 },
            { segmentId: 'leg_a', kind: 'leg_mid', atSeconds: 30 },
            { segmentId: 'leg_a', kind: 'leg_mid', atSeconds: 44 },
        ],
    };
    assert.equal(resolveSecretRoomUnlockSeconds(room, state), 32);
    assert.equal(
        resolveSecretRoomUnlockSeconds(room, { sealed: false, events: [{ segmentId: 'shaft', atSeconds: 5 }] }),
        Infinity
    );
});

test('T-SR20: sealed waits for the last event of a fallen structure', () => {
    const room = firstRoom({ unlock: { destructible: 'eiffel', when: 'sealed', delaySeconds: 4 } });
    const events = [
        { segmentId: 'shaft', kind: 'shaft', atSeconds: 10 },
        { segmentId: 'leg_a', kind: 'leg_lower', atSeconds: 22 },
    ];
    assert.equal(resolveSecretRoomUnlockSeconds(room, { sealed: true, events }), 26);
    assert.equal(resolveSecretRoomUnlockSeconds(room, { sealed: false, events }), Infinity);
    assert.equal(resolveSecretRoomUnlockSeconds(room, { sealed: true, events: [] }), Infinity);
});

test('T-SR21: unusable event times are ignored instead of unlocking early', () => {
    const room = firstRoom();
    const state = {
        sealed: false,
        events: [
            { segmentId: 'shaft', atSeconds: 'soon' },
            { segmentId: 'leg_a', atSeconds: 20 },
        ],
    };
    assert.equal(resolveSecretRoomUnlockSeconds(room, state), 24);
    assert.equal(resolveSecretRoomUnlockSeconds(null, state), Infinity);
});

test('T-SR23: the schema keeps a secret room block', () => {
    const document = normalizeMapSchemaDocument({ secretRooms: [authoredRoom()] });
    assert.equal(Array.isArray(document.secretRooms), true);
    assert.equal(document.secretRooms.length, 1);
    assert.equal(document.secretRooms[0].id, 'vault');
    assert.equal(document.secretRooms[0].stayLimitSeconds, 25);
});

test('T-SR24: a map without the block stays exactly as it was', () => {
    const before = normalizeMapSchemaDocument({ hardBlocks: [{ x: 1, y: 2, z: 3 }] });
    assert.equal(Object.prototype.hasOwnProperty.call(before, 'secretRooms'), false);
    const withEmptyBlock = normalizeMapSchemaDocument({ hardBlocks: [{ x: 1, y: 2, z: 3 }], secretRooms: [] });
    assert.deepEqual(withEmptyBlock, before);
    const withGarbageBlock = normalizeMapSchemaDocument({ hardBlocks: [{ x: 1, y: 2, z: 3 }], secretRooms: 'x' });
    assert.deepEqual(withGarbageBlock, before);
});

test('T-SR25: too many rooms are refused like every other map collection', () => {
    const tooMany = Array.from({ length: 9 }, (_, index) => authoredRoom({ id: `vault_${index}` }));
    assert.throws(() => normalizeMapSchemaDocument({ secretRooms: tooMany }), /secretRooms/);
});

test('T-SR26: the runtime map definition carries the block in map units', () => {
    const converted = toArenaMapDefinition({ secretRooms: [authoredRoom()] }, { mapScale: 2 });
    const room = converted.map.secretRooms[0];
    assert.equal(room.id, 'vault');
    assert.deepEqual([...room.bounds.min], [-25, -125, -25]);
    assert.deepEqual([...room.bounds.max], [25, -75, 25]);
    assert.deepEqual([...room.entryPortal.pos], [50, 10, 0]);
    assert.deepEqual([...room.roomPortal.pos], [0, -100, 0]);
    assert.deepEqual([...room.ejectPoint.pos], [60, 15, 5]);
    assert.deepEqual([...room.items[0].pos], [5, -100, 5]);
    assert.equal(room.ejectPoint.yawDeg, 90);
    assert.equal(room.stayLimitSeconds, 25);
});

test('T-SR27: a runtime map without rooms has no secret room field', () => {
    const converted = toArenaMapDefinition({ hardBlocks: [{ x: 1, y: 2, z: 3 }] }, { mapScale: 1 });
    assert.equal(Object.prototype.hasOwnProperty.call(converted.map, 'secretRooms'), false);
});
