import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getMapFloorMaterial } from '../src/entities/arena/ArenaBuildResourceCache.js';

test('a map floor appearance yields one shared plain material, anything else keeps the checker', () => {
    assert.equal(getMapFloorMaterial(undefined), null);
    assert.equal(getMapFloorMaterial({}), null);
    assert.equal(getMapFloorMaterial({ color: 'green' }), null);
    assert.equal(getMapFloorMaterial({ color: 0x1000000 }), null);

    const meadow = getMapFloorMaterial({ color: 0x44602f, roughness: 0.95 });
    assert.equal(meadow.color.getHex(), 0x44602f);
    assert.equal(meadow.map, null, 'no checker texture on a meadow');
    assert.equal(meadow.roughness, 0.95);
    assert.equal(meadow.transparent, true, 'the far edge still fades into the sky');
    assert.equal(meadow.defines.ATMOSPHERIC_FOG_ALPHA_FADE, 1);
    assert.equal(getMapFloorMaterial({ color: 0x44602f, roughness: 0.95 }), meadow,
        'rebuilding the same map must not leak a material per build');
    assert.equal(getMapFloorMaterial({ color: 0x44602f, roughness: 7 }).roughness, 1);
});

test('the arena builder lays the map floor material when a map asks for one', () => {
    const source = readFileSync(new URL('../src/entities/arena/ArenaBuilder.js', import.meta.url), 'utf8');
    assert.match(source, /getMapFloorMaterial\(mapResolution\.map\?\.floorAppearance\)\s*\|\|\s*materialBundle\.floorMat/);
});
