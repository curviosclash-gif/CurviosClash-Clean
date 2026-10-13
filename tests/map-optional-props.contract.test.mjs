import assert from 'node:assert/strict';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';

// An optional prop may fail to load without sending the map to its fallback boxes. That is only
// safe for pure decoration: nothing may collide with it, nothing invisible may stand in its place,
// and no destructible may hide or replace it. Visible models with an invisible collision twin
// (giant forest crowns, cherry trees) must stay required, or a load error leaves invisible walls.

const samePosition = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((value, index) => Math.abs(Number(value) - Number(b[index])) < 1e-6);

function destructibleModelIds(map) {
    const authored = normalizeMapDestructibles(map?.destructibles);
    const ids = new Set(authored?.hideModelIds || []);
    for (const scene of authored?.breakScenes || []) {
        ids.add(scene.modelId);
        for (const id of scene.modelVariants || []) ids.add(id);
        for (const attachment of scene.attachedModels || []) ids.add(attachment.modelId);
    }
    for (const segment of authored?.segments || []) {
        for (const id of segment.hideModelIds || []) ids.add(id);
    }
    return ids;
}

test('every optional prop in the catalog is pure decoration', () => {
    const problems = [];
    for (const [mapKey, map] of Object.entries(MAP_PRESET_CATALOG)) {
        const models = Array.isArray(map?.glbModels) ? map.glbModels : [];
        const destructibleIds = destructibleModelIds(map);
        for (const model of models) {
            if (model?.role !== 'optionalProp') continue;
            const where = `${mapKey} ${model.id}`;
            if (model.collision !== false) problems.push(`${where}: optional prop must say collision: false`);
            if (model.collisionOnly === true) problems.push(`${where}: optional prop is collision only`);
            if (model.hiddenUntilTriggered === true) problems.push(`${where}: optional prop is a break scene`);
            if (destructibleIds.has(model.id)) problems.push(`${where}: a destructible hides or replaces it`);
            const twin = models.find((other) => other !== model && other?.collisionOnly === true
                && samePosition(other.position, model.position));
            if (twin) problems.push(`${where}: has the invisible collision twin ${twin.id}`);
        }
    }
    assert.deepEqual(problems, []);
});

test('the decoration families are optional, the models with collision twins stay required', () => {
    const roleOf = (mapKey, predicate) => (MAP_PRESET_CATALOG[mapKey].glbModels || [])
        .filter((model) => predicate(String(model.id), String(model.url)))
        .map((model) => model.role || 'required');
    const all = (roles, role) => roles.length > 0 && roles.every((value) => value === role);
    const isGlowingMushroom = (_id, url) => url.includes('/glowing_mushroom/');

    for (const mapKey of ['eiffel_tower', 'eiffel_tower_siege']) {
        assert.ok(all(roleOf(mapKey, (id) => id.startsWith('eiffel-historic-')), 'optionalProp'), `${mapKey} historic props`);
    }
    assert.ok(all(roleOf('giant_forest', (id) => /^giant-forest-(fern|root|vine)/.test(id)), 'optionalProp'), 'giant forest undergrowth');
    for (const mapKey of ['crystal_ruins', 'verdant_aperture', 'dandelion_sky', 'sunflower_meadow', 'reactor_site']) {
        assert.ok(all(roleOf(mapKey, isGlowingMushroom), 'optionalProp'), `${mapKey} glowing mushrooms`);
    }

    assert.ok(all(roleOf('giant_forest', (id) => id === 'giant-forest-floor'), 'required'), 'forest floor stays required');
    assert.ok(roleOf('cherry_grove', (id) => id.endsWith('-render')).every((role) => role !== 'optionalProp'), 'cherry trees stay required');
    assert.ok(roleOf('storm_lighthouse_siege', (id) => id === 'storm-lighthouse-beacon').every((role) => role !== 'optionalProp'), 'lighthouse beacon stays required');
});
