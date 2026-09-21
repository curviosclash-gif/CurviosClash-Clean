import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import {
    CANOPY_DECK,
    CANOPY_DECK_RADIUS,
    FOREST_GROUND,
} from '../src/core/config/maps/presets/giant_forest/GiantForestStructure.js';

// The giant forest is the first map that places a drawn model and a separate, invisible collision
// body in the same spot, and the first whose fog moves during a round. Four questions only the
// running app answers:
//
//   1. All 133 models load without a warning, with every crown drawn and every collision body
//      hidden - and the hidden ones are the ones that produced colliders.
//   2. A trunk is solid and its crown is not: a probe inside the trunk is blocked, one in the
//      leaves beside it is free. That is the whole point of collisionOnly.
//   3. The canopy is a storey: the decks and their bridges carry, the air above them does not.
//   4. The fog really turns over - a lid below the deck at the start, a floor above it later -
//      and it follows the same map clock as everything else on the map.
//
// Coordinates are authored units multiplied by the map scale of three on the way into any runtime
// query, because the forest sets scaleAuthoredAnchors.

const MAP_KEY = 'giant_forest';
const MAP_SCALE = 3;
const MAP = MAP_PRESET_CATALOG[MAP_KEY];
const MODEL_COUNT = MAP.glbModels.length;
const TRUNKS = MAP.glbModels.filter((model) => model.id.startsWith('giant-forest-trunk-'));
const CROWNS = MAP.glbModels.filter((model) => model.id.startsWith('giant-forest-crown-'));

function world([x, y, z]) {
    return { x: x * MAP_SCALE, y: y * MAP_SCALE, z: z * MAP_SCALE };
}

async function startMatch(page) {
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    const offered = await page.locator(`#map-select option[value="${MAP_KEY}"]`).count();
    expect(offered, `the map picker has to offer "${MAP_KEY}" (BASE_MAP_KEYS)`).toBe(1);
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY, { timeout: 10_000 });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.entityManager?.players?.length > 0
        && window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
    ), MAP_KEY, { timeout: 180_000 });
}

test.describe('Giant forest', () => {
    test('the trees are solid where they are drawn, the canopy carries, and the fog turns over', async ({ page }, testInfo) => {
        test.setTimeout(480_000);
        await startMatch(page);

        await expect.poll(() => page.evaluate((count) => {
            const arena = window.GAME_INSTANCE?.arena;
            return !arena?._glbLoadError && (arena?._glbScene?.children?.length || 0) === count;
        }, MODEL_COUNT), { timeout: 360_000, message: 'the forest has to load whole' }).toBe(true);

        // --- 1. What loaded ---------------------------------------------------------------
        const loaded = await page.evaluate(({ trunkIds, crownIds }) => {
            const arena = window.GAME_INSTANCE.arena;
            const visibility = (ids) => ids.map((id) => {
                const slot = arena._glbScene.getObjectByName(`glb-slot-${id}`);
                return slot ? slot.visible : null;
            });
            const colliderIds = new Set(arena.obstacles.map((entry) => String(entry?.modelId || '')));
            return {
                warnings: [...arena._glbLoadWarnings],
                modelCount: arena._glbScene.children.length,
                trunkVisible: visibility(trunkIds),
                crownVisible: visibility(crownIds),
                trunksWithColliders: trunkIds.filter((id) => colliderIds.has(id)).length,
                crownsWithColliders: crownIds.filter((id) => colliderIds.has(id)).length,
                deckColliders: arena.obstacles.filter(
                    (entry) => String(entry?.modelId || '') === 'giant-forest-canopy-walks',
                ).length,
                floorColliders: arena.obstacles.filter(
                    (entry) => String(entry?.modelId || '') === 'giant-forest-floor',
                ).length,
                shadowCasters: (() => {
                    let count = 0;
                    arena._glbScene.traverse((node) => { if (node?.isMesh && node.castShadow) count += 1; });
                    return count;
                })(),
            };
        }, { trunkIds: TRUNKS.map(({ id }) => id), crownIds: CROWNS.map(({ id }) => id) });

        expect(loaded.warnings, `GLB load warnings: ${loaded.warnings.join(' | ')}`).toEqual([]);
        expect(loaded.modelCount).toBe(MODEL_COUNT);
        expect(new Set(loaded.trunkVisible), 'every collision body stays hidden').toEqual(new Set([false]));
        expect(new Set(loaded.crownVisible), 'every crown is drawn').toEqual(new Set([true]));
        expect(loaded.trunksWithColliders, 'the hidden bodies are what collides').toBe(TRUNKS.length);
        expect(loaded.crownsWithColliders, 'and the crowns are flown through').toBe(0);
        expect(loaded.deckColliders, 'the canopy walks are solid').toBeGreaterThan(0);
        expect(loaded.floorColliders, 'the drawn ground is not').toBe(0);

        // --- 2. A trunk is solid, its crown is not ----------------------------------------
        const probes = await page.evaluate(({ trunks, ground, deck, deckRadius, scale }) => {
            const arena = window.GAME_INSTANCE.arena;
            const at = (x, y, z) => arena.checkCollisionFast({ x: x * scale, y: y * scale, z: z * scale }, 1.2);
            const sample = trunks.slice(0, 8).map((trunk) => {
                const [x, , z] = trunk.position;
                return {
                    id: trunk.id,
                    // Halfway up the trunk, where the cylinder is at its plainest.
                    inTrunk: at(x, ground + 20, z),
                    // Out in the leaves, a crown's width away but still under the same canopy.
                    inLeaves: at(x + 26, ground + 34, z),
                };
            });
            return {
                sample,
                // Inside the planks themselves: they are three units thick and their underside is
                // the deck height, so a probe a unit and a half up is in the timber.
                onDeck: at(0, deck + 1.5, -deckRadius),
                aboveDeck: at(0, deck + 34, -deckRadius),
                onBridge: at(deckRadius / 2, deck + 1.5, -deckRadius / 2),
                inHeartClearing: at(0, ground + 30, 0),
            };
        }, {
            trunks: TRUNKS.map(({ id, position }) => ({ id, position })),
            ground: FOREST_GROUND,
            deck: CANOPY_DECK,
            deckRadius: CANOPY_DECK_RADIUS,
            scale: MAP_SCALE,
        });

        const solidTrunks = probes.sample.filter((entry) => entry.inTrunk);
        expect(solidTrunks.length, `trunks probed solid: ${solidTrunks.map((e) => e.id).join(', ')}`)
            .toBe(probes.sample.length);
        expect(probes.sample.filter((entry) => entry.inLeaves), 'leaves are flown through').toEqual([]);
        expect(probes.onDeck, 'the deck carries').toBe(true);
        expect(probes.aboveDeck, 'the air above it does not').toBe(false);
        expect(probes.onBridge, 'and the bridge between two decks carries too').toBe(true);
        expect(probes.inHeartClearing, 'the central clearing stays open').toBe(false);

        // --- 3. The fog turns over on the map clock ---------------------------------------
        const fog = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const read = (seconds) => {
                game.arena.setGlbAnimationElapsedSeconds(seconds);
                return { ...game.renderer.updateMapFogLayer(seconds) };
            };
            const start = read(0);
            const middle = read(120);
            const late = read(200);
            read(0);
            const restarted = { ...game.renderer.updateMapFogLayer(0) };
            return { start, middle, late, restarted };
        });

        expect(fog.start.heightFalloff, 'a lid at the start').toBeGreaterThan(0);
        expect(fog.start.floorFalloff, 'and no floor').toBe(0);
        expect(fog.start.height, 'the lid stands at the canopy deck, in world units')
            .toBeCloseTo(CANOPY_DECK * MAP_SCALE, 3);
        expect(fog.middle.floorFalloff, 'halfway through, both edges are established').toBeGreaterThan(0);
        expect(fog.middle.heightFalloff).toBeGreaterThan(0);
        expect(fog.middle.height, 'and the band has risen').toBeGreaterThan(fog.start.height);
        expect(fog.late.heightFalloff, 'in the end the lid is gone').toBe(0);
        expect(fog.late.floor, 'and the floor stands where the lid did')
            .toBeCloseTo(CANOPY_DECK * MAP_SCALE, 3);
        expect(fog.restarted, 'a restart puts the fog back').toEqual(fog.start);

        // --- 4. What it costs -------------------------------------------------------------
        const cost = await page.evaluate(() => {
            const renderer = window.GAME_INSTANCE.renderer;
            renderer.render();
            return {
                calls: renderer.renderer.info.render.calls,
                triangles: renderer.renderer.info.render.triangles,
                geometries: renderer.renderer.info.memory.geometries,
                obstacles: window.GAME_INSTANCE.arena.obstacles.length,
            };
        });

        // A look at both halves of the round, from the same place: the fog is the only thing that
        // changes between them, and it changes which storey a player can see.
        for (const [label, seconds] of [['fog-below', 0], ['fog-above', 200]]) {
            const image = await page.evaluate(async ({ atSeconds, deck, ground, scale }) => {
                const game = window.GAME_INSTANCE;
                const player = game.entityManager.players[0];
                // The middle of the heart clearing, just under the canopy, looking out into the
                // trees. Teleporting is only safe where nothing stands, which is what a clearing is.
                player.position.set(0, (deck - 6) * scale, 0);
                player.velocity?.set?.(0, 0, 0);
                game.arena.setGlbAnimationElapsedSeconds(atSeconds);
                game.renderer.updateMapFogLayer(atSeconds);
                for (let frame = 0; frame < 4; frame += 1) game.renderer.render();
                void ground;
                return game.renderer.renderer.domElement.toDataURL('image/png');
            }, { atSeconds: seconds, deck: CANOPY_DECK, ground: FOREST_GROUND, scale: MAP_SCALE });
            await testInfo.attach(`giant-forest-${label}.png`, {
                body: Buffer.from(image.split(',')[1], 'base64'),
                contentType: 'image/png',
            });
        }

        await testInfo.attach('giant-forest-cost.json', {
            body: JSON.stringify({ ...cost, shadowCasters: loaded.shadowCasters }, null, 2),
            contentType: 'application/json',
        });
        // A forest of 53 trees at 23k triangles each would be 1.2M if none of it were culled.
        // The fog range and the per-crown cull distance are what keep this affordable.
        expect(cost.triangles, `${cost.triangles} triangles in one frame`).toBeLessThan(900_000);
        expect(cost.calls, `${cost.calls} draw calls`).toBeLessThan(420);
    });
});
