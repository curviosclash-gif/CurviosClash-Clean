import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import {
    CANOPY_DECK,
    CANOPY_DECK_RADIUS,
    FOREST_GROUND,
} from '../src/core/config/maps/presets/giant_forest/GiantForestStructure.js';

const MAP_KEY = 'giant_forest';
const MAP_SCALE = 3;
const MAP = MAP_PRESET_CATALOG[MAP_KEY];
const TRUNKS = MAP.glbModels.filter(({ id }) => id.startsWith('giant-forest-trunk-'));
const CROWNS = MAP.glbModels.filter(({ id }) => id.startsWith('giant-forest-crown-'));

async function startForest(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
        && window.GAME_INSTANCE?.entityManager?.players?.length > 0
    ), MAP_KEY, { timeout: 180_000 });
}

test.describe('Giant forest runtime', () => {
    test('loads the two-storey forest in one scaled coordinate space', async ({ page }, testInfo) => {
        test.setTimeout(480_000);
        await startForest(page);

        await expect.poll(() => page.evaluate((modelCount) => {
            const arena = window.GAME_INSTANCE?.arena;
            return !arena?._glbLoadError && arena?._glbScene?.children?.length === modelCount;
        }, MAP.glbModels.length), { timeout: 360_000 }).toBe(true);

        const result = await page.evaluate(({ trunks, crownIds, ground, deck, deckRadius, scale }) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const colliderIds = new Set(arena.obstacles.map((entry) => String(entry?.modelId || '')));
            const trunkIds = trunks.map(({ id }) => id);
            const visible = (id) => arena._glbScene.getObjectByName(`glb-slot-${id}`)?.visible;
            const at = (x, y, z) => arena.checkCollisionFast(
                { x: x * scale, y: y * scale, z: z * scale },
                1.2,
            );
            const readFog = (seconds) => {
                arena.setGlbAnimationElapsedSeconds(seconds);
                return { ...game.renderer.updateMapFogLayer(seconds) };
            };

            const startFog = readFog(0);
            const endFog = readFog(200);
            arena.setGlbAnimationElapsedSeconds(0);
            game.renderer.updateMapFogLayer(0);
            game.renderer.render();

            return {
                warnings: [...arena._glbLoadWarnings],
                authoredSpawn: arena.getAuthoredPlayerSpawn(),
                trunksVisible: trunkIds.filter((id) => visible(id) !== false),
                crownsHidden: crownIds.filter((id) => visible(id) !== true),
                trunkColliders: trunkIds.filter((id) => colliderIds.has(id)).length,
                crownColliders: crownIds.filter((id) => colliderIds.has(id)).length,
                trunkSamples: trunks.slice(0, 6).map((descriptor) => {
                    return at(descriptor.position[0], ground + 20, descriptor.position[2]);
                }),
                deckSolid: at(0, deck + 1.5, -deckRadius),
                aboveDeckClear: !at(0, deck + 34, -deckRadius),
                heartClear: !at(0, ground + 30, 0),
                startFog,
                endFog,
                image: game.renderer.renderer.domElement.toDataURL('image/png'),
            };
        }, {
            trunks: TRUNKS.map(({ id, position }) => ({ id, position })),
            crownIds: CROWNS.map(({ id }) => id),
            ground: FOREST_GROUND,
            deck: CANOPY_DECK,
            deckRadius: CANOPY_DECK_RADIUS,
            scale: MAP_SCALE,
        });

        expect(result.warnings).toEqual([]);
        expect(result.authoredSpawn).toMatchObject({ x: -636, y: 60, z: -636 });
        expect(result.trunksVisible).toEqual([]);
        expect(result.crownsHidden).toEqual([]);
        expect(result.trunkColliders).toBe(TRUNKS.length);
        expect(result.crownColliders).toBe(0);
        expect(result.trunkSamples).toEqual(new Array(result.trunkSamples.length).fill(true));
        expect(result.deckSolid).toBe(true);
        expect(result.aboveDeckClear).toBe(true);
        expect(result.heartClear).toBe(true);
        expect(result.startFog.height).toBeCloseTo(CANOPY_DECK * MAP_SCALE, 3);
        expect(result.startFog.heightFalloff).toBeGreaterThan(0);
        expect(result.startFog.floorFalloff).toBe(0);
        expect(result.endFog.heightFalloff).toBe(0);
        expect(result.endFog.floor).toBeCloseTo(CANOPY_DECK * MAP_SCALE, 3);
        expect(result.endFog.floorFalloff).toBeGreaterThan(0);
        await testInfo.attach('giant-forest-runtime.png', {
            body: Buffer.from(result.image.split(',')[1], 'base64'),
            contentType: 'image/png',
        });
    });
});
