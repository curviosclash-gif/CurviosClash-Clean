import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames, chooseFreePlayVariant } from './helpers.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';

// Kirschhain is ten blossom trees (about 36 MB of render GLBs, three files decoded at a time) with
// a small hidden collision body per trunk, an open sky and three authored item anchors written as
// pos: [x, y, z]. Three questions only the running app answers:
//
//   1. All twenty models load without a warning or a console error; the render models are what
//      is drawn and collides with nothing, the hidden trunk bodies are what collides.
//   2. The player starts free: the spawn is not inside geometry and the ship is still alive and
//      moving a moment later.
//   3. Every authored item anchor arrives at its authored place (times the map scale, because the
//      map sets scaleAuthoredAnchors), is free of collision and carries a spawned pickup.
//
// Draw calls and triangles of one frame are attached as numbers; frame times are not measured
// (a hidden render loop has no meaningful frame time).

const MAP_KEY = 'cherry_grove';
const MAP = MAP_PRESET_CATALOG[MAP_KEY];
const MODEL_COUNT = MAP.glbModels.length;
const RENDER_IDS = MAP.glbModels.filter((model) => model.id.endsWith('-render')).map(({ id }) => id);
const TRUNK_IDS = MAP.glbModels.filter((model) => model.id.endsWith('-trunk')).map(({ id }) => id);
const AUTHORED_ITEMS = MAP.items.map(({ pos }) => [...pos]);
const PICKUP_OWNER_ID = 'cherry-grove-desktop-proof';

async function startCherryGrove(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await chooseFreePlayVariant(page, 'ffa');
    await page.locator('#submenu-game:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });
    expect(
        await page.locator(`#map-select option[value="${MAP_KEY}"]`).count(),
        `the map picker has to offer "${MAP_KEY}"`,
    ).toBe(1);
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY, { timeout: 10_000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.entityManager?.players?.length > 0;
    }, MAP_KEY, { timeout: 180_000 });
}

test.describe('Cherry grove', () => {
    test('loads all ten trees, starts the player free and places the item anchors', async ({ page }, testInfo) => {
        test.setTimeout(360_000);
        await waitForLoadedGame(page);
        const errors = collectErrors(page);
        await startCherryGrove(page);

        await expect.poll(() => page.evaluate((count) => {
            const arena = window.GAME_INSTANCE?.arena;
            return !arena?._glbLoadError && (arena?._glbScene?.children?.length || 0) === count;
        }, MODEL_COUNT), { timeout: 240_000, message: 'the grove has to load whole' }).toBe(true);
        await waitForRenderFrames(page, 12);

        // --- 1. What loaded ---------------------------------------------------------------
        const loaded = await page.evaluate(({ renderIds, trunkIds }) => {
            const arena = window.GAME_INSTANCE.arena;
            const slot = (id) => arena._glbScene.getObjectByName(`glb-slot-${id}`);
            const colliderIds = new Set(arena.obstacles.map((entry) => String(entry?.modelId || '')));
            return {
                warnings: [...arena._glbLoadWarnings],
                modelCount: arena._glbScene.children.length,
                renderSlots: renderIds.filter((id) => slot(id)).length,
                trunkSlots: trunkIds.filter((id) => slot(id)).length,
                // Whether a far tree is currently culled is up to the camera; a trunk body is
                // never drawn, whatever the camera does.
                visibleTrunks: trunkIds.filter((id) => slot(id)?.visible === true),
                trunksWithColliders: trunkIds.filter((id) => colliderIds.has(id)).length,
                renderModelsWithColliders: renderIds.filter((id) => colliderIds.has(id)).length,
            };
        }, { renderIds: RENDER_IDS, trunkIds: TRUNK_IDS });

        expect(loaded.warnings, `GLB load warnings: ${loaded.warnings.join(' | ')}`).toEqual([]);
        expect(loaded.modelCount).toBe(MODEL_COUNT);
        expect(loaded.renderSlots, 'every blossom tree has a slot').toBe(RENDER_IDS.length);
        expect(loaded.trunkSlots, 'and every trunk its collision slot').toBe(TRUNK_IDS.length);
        expect(loaded.visibleTrunks, 'collision bodies are never drawn').toEqual([]);
        expect(loaded.trunksWithColliders, 'the hidden bodies are what collides').toBe(TRUNK_IDS.length);
        expect(loaded.renderModelsWithColliders, 'the blossoms are flown through').toBe(0);

        // --- 2. The player starts free ----------------------------------------------------
        const start = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const player = game.entityManager.players.find((entry) => !entry.isBot);
            const spawn = { x: player.position.x, y: player.position.y, z: player.position.z };
            return {
                spawn,
                blocked: game.arena.checkCollisionFast(spawn, player.hitboxRadius),
                alive: player.alive === true,
            };
        });
        expect(start.alive, 'the player is alive at the spawn').toBe(true);
        expect(start.blocked, 'the spawn is not inside geometry').toBe(false);
        // A spawn inside a tree body kills the ship before it gets far from its spawn point.
        await expect.poll(() => page.evaluate(({ x, z }) => {
            const player = window.GAME_INSTANCE?.entityManager?.players?.find((entry) => !entry.isBot);
            if (!player?.alive || !player.position) return -1;
            return Math.hypot(player.position.x - x, player.position.z - z);
        }, start.spawn), { timeout: 30_000, message: 'the ship flies on, alive' }).toBeGreaterThan(12);

        // --- 3. A pickup lies where the anchor was authored -------------------------------
        const items = await page.evaluate(({ authored, ownerId }) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const powerups = game.entityManager.powerupManager;
            const player = game.entityManager.players.find((entry) => !entry.isBot);
            const scale = game.entityManager.entityRuntimeConfig.ARENA.MAP_SCALE;
            const anchors = arena.getAuthoredItemAnchors();
            const types = Object.keys(game.entityManager.entityRuntimeConfig.POWERUP.TYPES);
            const placed = anchors.map((anchor, index) => {
                // The anchors carry no pickup type: take the first one this mode lets spawn.
                let item = null;
                for (const type of types) {
                    item = powerups.spawnAtAnchor({ ...anchor, type, ownerId: `${ownerId}:${index}` });
                    if (item) break;
                }
                return {
                    expected: authored[index].map((value) => value * scale),
                    anchor: [anchor.x, anchor.y, anchor.z],
                    blocked: arena.checkCollisionFast(anchor, player.hitboxRadius),
                    spawned: !!item,
                    at: item ? [item.mesh.position.x, item.mesh.position.y, item.mesh.position.z] : null,
                };
            });
            return { scale, count: anchors.length, placed };
        }, { authored: AUTHORED_ITEMS, ownerId: PICKUP_OWNER_ID });

        expect(items.scale, 'the map is scaled by three').toBe(3);
        expect(items.count, 'every authored anchor reaches the arena').toBe(AUTHORED_ITEMS.length);
        for (const entry of items.placed) {
            expect(entry.anchor, 'pos: [x, y, z] is read, not left at the origin').toEqual(entry.expected);
            expect(entry.blocked, `anchor ${entry.expected} is free of collision`).toBe(false);
            expect(entry.spawned, `a pickup spawns at anchor ${entry.expected}`).toBe(true);
            expect(entry.at, 'and it lies on the anchor').toEqual(entry.expected);
        }
        await page.evaluate((ownerId) => {
            const powerups = window.GAME_INSTANCE.entityManager.powerupManager;
            for (let index = 0; index < 8; index += 1) powerups.removeByOwnerId(`${ownerId}:${index}`);
        }, PICKUP_OWNER_ID);

        // --- 4. What one frame costs (logged, not asserted: no budget is measured yet) ----
        const cost = await page.evaluate(() => {
            const renderer = window.GAME_INSTANCE.renderer;
            renderer.render();
            const info = renderer.renderer.info;
            return {
                calls: info.render.calls,
                triangles: info.render.triangles,
                geometries: info.memory.geometries,
                textures: info.memory.textures,
                obstacles: window.GAME_INSTANCE.arena.obstacles.length,
            };
        });
        await testInfo.attach('cherry-grove-cost.json', {
            body: JSON.stringify(cost, null, 2),
            contentType: 'application/json',
        });
        expect(cost.calls, 'something is drawn').toBeGreaterThan(0);

        expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('cherry-grove-ingame.png') });
    });
});
