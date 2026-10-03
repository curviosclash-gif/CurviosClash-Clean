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
import { buildRouteFromParcours } from '../src/entities/systems/ParcoursProgressUtils.js';

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

test('notre_dame: both CP11 branches reach CP12 through the east apse opening', async ({ page }) => {
    test.setTimeout(180_000);
    await startMap(page, 'notre_dame');

    const map = MAP_PRESET_CATALOG.notre_dame;
    const route = buildRouteFromParcours(map.parcours);
    const cp12 = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP12');
    const choir = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_CHOIR');
    const ambulatory = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_AMBULATORY');
    const choirExit = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_APSE_EXIT');
    const ambulatoryExit = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_APSE_EXIT_AMBULATORY');
    const apseApproach = route.checkpoints.find((checkpoint) => checkpoint.id === 'CP11_APSE_APPROACH');
    expect(cp12).toBeTruthy();
    expect(choir).toBeTruthy();
    expect(ambulatory).toBeTruthy();
    expect(choirExit).toBeTruthy();
    expect(ambulatoryExit).toBeTruthy();
    expect(apseApproach).toBeTruthy();

    const routes = route.guidancePaths.map((guidance) => ({
        id: guidance.branchCheckpointId,
        points: guidance.points,
    }));

    const collisions = await page.evaluate(({ routePaths, scale, shipRadius }) => {
        const arena = window.GAME_INSTANCE?.arena;
        if (!arena?.checkCollision) return [{ error: 'runtime arena collision query unavailable' }];
        const hits = [];
        for (const routePath of routePaths) {
            for (let segment = 0; segment < routePath.points.length - 1; segment += 1) {
                const from = routePath.points[segment];
                const to = routePath.points[segment + 1];
                const distance = Math.hypot(
                    (to[0] - from[0]) * scale,
                    (to[1] - from[1]) * scale,
                    (to[2] - from[2]) * scale,
                );
                const steps = Math.max(1, Math.ceil(distance / (shipRadius / 2)));
                for (let step = 0; step <= steps; step += 1) {
                    const t = step / steps;
                    const point = {
                        x: (from[0] + (to[0] - from[0]) * t) * scale,
                        y: (from[1] + (to[1] - from[1]) * t) * scale,
                        z: (from[2] + (to[2] - from[2]) * t) * scale,
                    };
                    if (arena.checkCollision(point, shipRadius)) {
                        hits.push({ id: routePath.id, segment, step, point });
                        break;
                    }
                }
            }
        }
        return hits;
    }, { routePaths: routes, scale: MAP_SCALE, shipRadius: 1.6 });
    expect(collisions).toEqual([]);
});
