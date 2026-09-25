import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'skyline_siege';
const COLLAPSE_MODELS = [
    'skyline-spire-collapse', 'skyline-crown-collapse', 'skyline-arcology-collapse',
];

async function startSkylineMatch(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    await expect(page.locator(`#map-select option[value="${MAP_KEY}"]`)).toHaveCount(1);
    await page.selectOption('#map-select', MAP_KEY);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.entityManager?.players?.length > 0
        && window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
    ), MAP_KEY, { timeout: 120_000 });
}

test.describe('Skyline Siege desktop runtime', () => {
    test('loads all three towers, applies damage, shows the fall, and resets the round', async ({ page }) => {
        test.setTimeout(300_000);
        await startSkylineMatch(page);

        await expect.poll(() => page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const arena = game?.arena;
            return !arena?._glbLoadError
                && arena?._glbScene?.children?.length === 7
                && arena?._glbLoadWarnings?.length === 0;
        }), { timeout: 120_000 }).toBe(true);

        const loaded = await page.evaluate((collapseIds) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const segments = game.entityManager.getMapDestructibleSystem().getState().segments;
            const slots = collapseIds.map((id) => arena._glbScene.getObjectByName(`glb-slot-${id}`));
            return {
                mapKey: arena.currentMapKey,
                mode: game.activeGameMode,
                segmentIds: segments.map((entry) => entry.id),
                collapseSlots: slots.map((slot) => ({ exists: !!slot, visible: slot?.visible === true })),
                warnings: [...arena._glbLoadWarnings],
            };
        }, COLLAPSE_MODELS);
        expect(loaded.mapKey).toBe(MAP_KEY);
        expect(loaded.mode).toBe('HUNT');
        expect(loaded.segmentIds).toEqual(['spire', 'crown', 'arcology']);
        expect(loaded.warnings).toEqual([]);
        expect(loaded.collapseSlots).toEqual(COLLAPSE_MODELS.map(() => ({ exists: true, visible: false })));

        const broken = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const destructibles = game.entityManager.getMapDestructibleSystem();
            const segment = destructibles.getState().segments.find((entry) => entry.id === 'spire');
            const result = destructibles.applyMeshHit('skyline_spire_structure', segment.hp, {
                hitDirection: { x: 1, y: 0, z: 0 }, cause: 'MG_BULLET',
            });
            return {
                resultApplied: result?.applied === true,
                destroyed: destructibles.getState().segments.find((entry) => entry.id === 'spire')?.destroyed === true,
                intactVisible: arena._glbScene.getObjectByName('glb-slot-skyline-spire-intact')?.visible === true,
                collapseVisible: arena._glbScene.getObjectByName('glb-slot-skyline-spire-collapse')?.visible === true,
            };
        });
        expect(broken).toEqual({ resultApplied: true, destroyed: true, intactVisible: false, collapseVisible: true });

        const reset = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const destructibles = game.entityManager.getMapDestructibleSystem();
            destructibles.startRound();
            return {
                segments: destructibles.getState().segments.map((entry) => ({ id: entry.id, destroyed: entry.destroyed })),
                intactVisible: game.arena._glbScene.getObjectByName('glb-slot-skyline-spire-intact')?.visible === true,
                collapseVisible: game.arena._glbScene.getObjectByName('glb-slot-skyline-spire-collapse')?.visible === true,
            };
        });
        expect(reset.segments).toEqual(['spire', 'crown', 'arcology'].map((id) => ({ id, destroyed: false })));
        expect(reset.intactVisible).toBe(true);
        expect(reset.collapseVisible).toBe(false);
    });
});
