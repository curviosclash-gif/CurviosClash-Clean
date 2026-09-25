// Parcours ring clearance on maps whose collision comes (partly) from GLB geometry. check:parcours
// sees authored boxes only (scripts/parcours-ring-clearance.mjs), so these maps are checked against
// the real arena: a ring centre that stays inside collision for every sample over up to 15 s fails.
// Moving mechanisms (a travelling hoarding gap, rotating bridges) block a ring only for a while and
// pass. Rings threaded on purpose carry centerObstructionAllowed in their preset.
//
// The rings come straight from the preset, so the check does not depend on the parcours being active
// in the session (aetherion_orrery's single-player scenario, for one, starts a fight match).

import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { resolveGLBColliderMode } from '../src/entities/mapSchema/MapSchemaGlbOps.js';

// Up to 15 s: a travelling gap (Notre-Dame hoarding) frees its ring only ~10 % of the time.
const SAMPLE_COUNT = 30;
const SAMPLE_INTERVAL_MS = 500;
const SHIP_RADIUS = 1.2;
const MAP_SCALE = Number(CONFIG_SECTIONS.ARENA.MAP_SCALE) || 1;

function glbColliderParcoursMaps() {
    return Object.entries(MAP_PRESET_CATALOG)
        .filter(([, mapDef]) => mapDef?.parcours?.enabled === true)
        .filter(([, mapDef]) => (Array.isArray(mapDef.glbModels) && mapDef.glbModels.length > 0) || !!mapDef.glbModel)
        .filter(([, mapDef]) => resolveGLBColliderMode(mapDef.glbColliderMode) !== 'fallbackOnly')
        .map(([mapKey, mapDef]) => ({
            mapKey,
            rings: [...(mapDef.parcours.checkpoints || []), mapDef.parcours.finish]
                .filter((ring) => Array.isArray(ring?.pos) && ring.centerObstructionAllowed !== true)
                .map((ring) => ({ id: ring.id, pos: ring.pos.map((value) => value * MAP_SCALE) })),
        }));
}

async function startMap(page, mapKey) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    const hasMapOption = await page.locator(`#map-select option[value="${mapKey}"]`).count() > 0;
    if (hasMapOption) {
        await page.selectOption('#map-select', mapKey);
        await page.waitForFunction((key) => window.GAME_INSTANCE?.settings?.mapKey === key, mapKey);
        await page.click('#btn-start');
    } else {
        // Hidden authored variants stay loadable through the runtime for collision checks.
        await page.evaluate(async (key) => {
            const game = window.GAME_INSTANCE;
            game.settings.mapKey = key;
            await game.runtimeFacade.startMatch();
        }, mapKey);
    }
    await page.waitForFunction((key) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === key
        && (window.GAME_INSTANCE?.arena?._glbScene?.children?.length || 0) > 0
    ), mapKey, { timeout: 90_000 });
}

for (const { mapKey, rings } of glbColliderParcoursMaps()) {
    test(`${mapKey}: no ring centre stays inside collision`, async ({ page }) => {
        // Mechanism maps load their GLB packs for up to ~90 s, then sampling takes up to 15 s.
        test.setTimeout(180_000);
        await startMap(page, mapKey);
        const blockedEverySample = await page.evaluate(async ({ samples, interval, radius, ringList }) => {
            const arena = window.GAME_INSTANCE.arena;
            const blockedCount = new Map(ringList.map((ring) => [ring.id, 0]));
            for (let sample = 0; sample < samples && [...blockedCount.values()].some((count) => count === sample); sample += 1) {
                for (const ring of ringList) {
                    const point = { x: ring.pos[0], y: ring.pos[1], z: ring.pos[2] };
                    if (arena.checkCollision(point, radius)) blockedCount.set(ring.id, blockedCount.get(ring.id) + 1);
                }
                await new Promise((resolve) => setTimeout(resolve, interval));
            }
            // A ring counts as blocked only when no sample ever found its centre free.
            return [...blockedCount].filter(([, count]) => count >= samples).map(([id]) => id);
        }, { samples: SAMPLE_COUNT, interval: SAMPLE_INTERVAL_MS, radius: SHIP_RADIUS, ringList: rings });
        expect(blockedEverySample).toEqual([]);
    });
}
