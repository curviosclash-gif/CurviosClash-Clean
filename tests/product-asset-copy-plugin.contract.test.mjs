import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { copyObjVehicleAssetsPlugin } from '../dev/vite/productAssetCopyPlugin.js';

test('renderer build copies every editor OBJ asset group', (context) => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'curvios-editor-assets-'));
    context.after(() => rmSync(outDir, { recursive: true, force: true }));

    const plugin = copyObjVehicleAssetsPlugin();
    plugin.configResolved({ root: process.cwd(), build: { outDir } });
    plugin.writeBundle();

    for (const relativePath of [
        'assets/items/item_crystal.obj',
        'assets/portals/portal_ring.obj',
        'assets/trails/trail_arrow.obj',
        'assets/models/jets/cc0/WWIairplane.obj',
        'assets/models/jets/cc0/funky_aircraft_low.obj',
        'assets/models/jets/cc0/funky_aircraft_high.obj',
        'assets/models/jets/cc0/funky_aircraft_control.obj',
        'assets/models/jets/cc0/pinnace_lo.obj',
        'assets/models/jets/cc0/spaceship_pack/dist/obj_mtl/ship5.obj',
        'assets/models/giant_dandelion/giant_dandelion_shootable.glb',
        'assets/models/giant_dandelion/giant_dandelion_lod2.glb',
        ...Array.from({ length: 10 }, (_, index) => {
            const variant = String(index + 1).padStart(2, '0');
            return `assets/models/ancient_tree/variants/variant_${variant}/ancient_tree_${variant}_lod2.glb`;
        }),
        'assets/maps/chrono_forge/glb/08_time_core.glb',
        'assets/maps/kinetic_tide/glb/08_reactor_heart.glb',
        'assets/maps/verdant_aperture/glb/08_heart_seed.glb',
        'assets/maps/notre_dame/glb/01_west_facade.glb',
        'assets/maps/burg_falkenwacht/glb/01_terrain.glb',
        'assets/maps/burg_falkenwacht/glb/10_drawbridge.glb',
        'assets/maps/burg_falkenwacht/glb/11_portcullis.glb',
        'assets/maps/burg_falkenwacht/props/falkenwacht-woodpile/falkenwacht-woodpile-v01/runtime.glb',
        'assets/maps/aetherion_orrery/glb/10_celestial_core.glb',
        'assets/models/verdant_wildwuchs/fern_v01.glb',
        'assets/models/glowing_mushroom/cap_v01.glb',
        'assets/models/glowing_mushroom/shelf_v03.glb',
    ]) {
        assert.ok(statSync(path.join(outDir, relativePath)).size > 0, `${relativePath} was not copied`);
    }
    for (const relativePath of [
        'assets/maps/burg_falkenwacht/props/falkenwacht-woodpile/falkenwacht-woodpile-v01/source.blend',
        // The mushroom pack keeps its Blender sources and contact sheet beside the runtime files,
        // so the copy has to filter by extension rather than take the directory whole.
        'assets/models/glowing_mushroom/blender/cap_v01.blend',
        'assets/models/glowing_mushroom/manifest.json',
    ]) {
        assert.equal(existsSync(path.join(outDir, relativePath)), false,
            `${relativePath} stays out of the renderer build`);
    }
});
