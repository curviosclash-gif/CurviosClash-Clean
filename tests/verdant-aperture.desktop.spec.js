import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'verdant_aperture';
const SETPIECE_COUNT = 13;
// CONFIG.PLAYER.HITBOX_RADIUS. Probing with anything smaller would report gaps no vehicle can
// actually use, and the whole question here is what a player can fly through.
const HITBOX_RADIUS = 0.8;
// CONFIG.ARENA.MAP_SCALE turns authored coordinates into world ones.
const MAP_SCALE = 3;
const ROOT_DECK_Y = 54 * MAP_SCALE;
// A join sits on a deck cell centre; the cell is 30 authored units across.
const JOIN = { x: -45 * MAP_SCALE, z: -45 * MAP_SCALE };
const SOLID_CELL = { x: -105 * MAP_SCALE, z: -105 * MAP_SCALE };
const CELL_HALF = 15 * MAP_SCALE;

async function startVerdantAperture(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.settings?.mapKey === mapKey
    ), MAP_KEY, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await page.waitForFunction((expected) => (
        window.GAME_INSTANCE?.arena?.currentMapKey === expected.mapKey
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === expected.count
    ), { mapKey: MAP_KEY, count: SETPIECE_COUNT }, { timeout: 30000 });
}

test('Verdant Aperture loads all thirteen greenhouse loops on desktop', async ({ page }) => {
    await startVerdantAperture(page);

    const before = await page.evaluate(() => window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds);
    await expect.poll(
        () => page.evaluate((baseline) => {
            const game = window.GAME_INSTANCE;
            return game?.state === 'PLAYING'
                && game?.arena?.glbAnimationElapsedSeconds > baseline;
        }, before),
        { message: 'the Verdant Aperture animation clock should advance after match start', timeout: 5000 }
    ).toBeTruthy();

    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            trackCount: arena._glbAnimation.trackCount,
            loadError: arena._glbLoadError,
            warnings: arena._glbLoadWarnings,
            colliderMode: arena._glbFootprint?.colliderMode,
            dynamicObstacles: arena._glbDynamicObstacles.length,
        };
    });

    expect(state.mapKey).toBe(MAP_KEY);
    expect(state.loadError).toBeNull();
    expect(state.warnings).toEqual([]);
    expect(state.colliderMode).toBe('dynamic');
    expect(state.trackCount).toBe(SETPIECE_COUNT);
    expect(state.dynamicObstacles).toBeGreaterThan(0);
});

test('the storey decks separate the levels and only open where a setpiece gates them', async ({ page }) => {
    test.setTimeout(180_000);
    await startVerdantAperture(page);
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 10000 });

    // Poses the setpieces at each step of the beat and scans two deck cells with the real
    // vehicle hitbox. Driving the clock through setGlbAnimationElapsedSeconds -- the same seam a
    // network resync uses -- makes this deterministic and instant. Waiting for the beat to pass
    // on its own is not an option: the test window throttles the loop roughly sixtyfold.
    const sweep = await page.evaluate(({ hitbox, y, join, solid, half, beat, steps }) => {
        const arena = window.GAME_INSTANCE.arena;
        const step = half / 4;

        const scanCell = (centre) => {
            let free = 0;
            let total = 0;
            for (let x = centre.x - half; x <= centre.x + half; x += step) {
                for (let z = centre.z - half; z <= centre.z + half; z += step) {
                    total += 1;
                    if (!arena.checkCollisionFast({ x, y, z }, hitbox)) free += 1;
                }
            }
            return free / total;
        };

        const joinSamples = [];
        const solidSamples = [];
        for (let index = 0; index < steps; index += 1) {
            arena.setGlbAnimationElapsedSeconds((beat * index) / steps);
            // Applies the pose and moves the dynamic colliders onto it.
            arena.update(1 / 1000);
            joinSamples.push(scanCell(join));
            solidSamples.push(scanCell(solid));
        }
        return {
            joinMin: Math.min(...joinSamples),
            joinMax: Math.max(...joinSamples),
            solidMax: Math.max(...solidSamples),
            sampleCount: joinSamples.length,
            joinByStep: joinSamples.map((value) => Number(value.toFixed(3))),
        };
    }, {
        hitbox: HITBOX_RADIUS,
        y: ROOT_DECK_Y,
        join: JOIN,
        solid: SOLID_CELL,
        half: CELL_HALF,
        beat: 6,
        steps: 24,
    });

    // Reported so the numbers land in the run log and can go into a commit body as a proof.
    // eslint-disable-next-line no-console
    console.log('verdant aperture join passability per beat step:', JSON.stringify(sweep));

    expect(sweep.sampleCount).toBe(24);
    // A cell of plain deck is a floor: nothing passes it at any point in the loop.
    expect(sweep.solidMax).toBe(0);
    // The gated join has to be usable at some point, or the level is sealed off.
    expect(sweep.joinMax).toBeGreaterThan(0);
});
