import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapUnits } from '../src/shared/contracts/MapUnitContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';

const MAP = MAP_PRESET_CATALOG.eiffel_tower_siege;
const ROOM = normalizeSecretRooms(MAP.secretRooms)[0];

test('the Eiffel vault contains one boss whose patrol and body stay inside the room', () => {
    const units = normalizeMapUnits(MAP.mapUnits);
    const bosses = units.filter((unit) => unit.kind === 'boss');
    assert.equal(bosses.length, 1);
    const [boss] = bosses;

    assert.equal(boss.secretRoomId, ROOM.id);
    assert.equal(boss.maxHp, 800);
    assert.equal(boss.respawnSeconds, 0);
    assert.equal(boss.lootCount, 3);
    assert.ok(boss.guaranteedLoot.includes('ROCKET_MEGA'));

    const clearance = boss.hitboxRadius;
    for (const point of boss.path) {
        assert.ok(point[0] >= ROOM.bounds.min[0] + clearance && point[0] <= ROOM.bounds.max[0] - clearance);
        assert.ok(point[2] >= ROOM.bounds.min[2] + clearance && point[2] <= ROOM.bounds.max[2] - clearance);
        assert.ok(point[1] >= ROOM.bounds.min[1] && point[1] <= ROOM.bounds.max[1]);
    }
});
