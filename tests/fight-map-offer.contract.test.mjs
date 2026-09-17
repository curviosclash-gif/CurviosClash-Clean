import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { resolveMapPreview } from '../src/ui/menu/MenuPreviewCatalog.js';
import { isMapOfferedForModePath } from '../src/ui/start-setup/StartSetupMapOffer.js';

function offered(mapKey, modePath) {
    return isMapOfferedForModePath(resolveMapPreview(mapKey), CONFIG.MAPS[mapKey], modePath);
}

test('Fight leaves out model showcases and pure race courses', () => {
    for (const mapKey of ['glb_hangar', 'glb_gallery', 'item_showcase', 'upgrade_showcase', 'showcase_nexus']) {
        assert.equal(offered(mapKey, 'fight'), false, `${mapKey} is a showcase`);
    }
    for (const mapKey of ['parcours_rift', 'parcours_rift_sprint', 'parcours_rift_precision', 'glass_serpent', 'micro_maw']) {
        assert.equal(offered(mapKey, 'fight'), false, `${mapKey} is a race course`);
    }
});

test('the showcase filter still reaches the model showcases in Fight', () => {
    const entry = resolveMapPreview('item_showcase');
    assert.equal(isMapOfferedForModePath(entry, CONFIG.MAPS.item_showcase, 'fight', 'showcase'), true);
    assert.equal(isMapOfferedForModePath(entry, CONFIG.MAPS.item_showcase, 'fight', 'all'), false);
    const course = resolveMapPreview('parcours_rift');
    assert.equal(isMapOfferedForModePath(course, CONFIG.MAPS.parcours_rift, 'fight', 'parcours-collection'), false);
});

test('Fight keeps arenas, adventures and the courses built for combat', () => {
    for (const mapKey of ['standard', 'maze', 'mega_maze', 'reactor_site', 'eiffel_tower_siege', 'magma_maze', 'aetherion_orrery', 'parcours_assault']) {
        assert.equal(offered(mapKey, 'fight'), true, `${mapKey} belongs in Fight`);
    }
});

test('the other mode paths keep every map in the picker', () => {
    for (const modePath of ['normal', 'arcade', 'quick_action']) {
        assert.equal(offered('parcours_rift', modePath), true);
        assert.equal(offered('glb_gallery', modePath), true);
    }
});
