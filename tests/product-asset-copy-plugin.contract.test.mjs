import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
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
        'assets/maps/chrono_forge/glb/08_time_core.glb',
        'assets/maps/kinetic_tide/glb/08_reactor_heart.glb',
        'assets/maps/verdant_aperture/glb/08_heart_seed.glb',
    ]) {
        assert.ok(statSync(path.join(outDir, relativePath)).size > 0, `${relativePath} was not copied`);
    }
});
