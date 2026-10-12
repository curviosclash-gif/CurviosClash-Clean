import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGLBModelCollection } from '../src/entities/GLBMapLoader.js';

// An optional prop may fail to load on one machine and load on another. If it carried collision,
// host and client would fly through different worlds, because a missing optional prop no longer
// sends the map to its fallback. So an optional prop is decoration only, whatever the preset says.

test('an optional prop never collides, even when its entry asks for collision', () => {
    const [prop, required] = normalizeGLBModelCollection([
        { id: 'deco', url: 'assets/maps/frozen_helix/glb/crystal_a.glb', role: 'optionalProp', collision: true, collisionOnly: true },
        { id: 'world', url: 'assets/maps/frozen_helix/glb/01_world.glb', collision: true },
    ]);
    assert.equal(prop.role, 'optionalProp');
    assert.equal(prop.collision, false);
    assert.equal(prop.collisionOnly, false);
    assert.equal(required.collision, true, 'required models keep their collision');
});
