import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

// Fifteen GLBs is more than any earlier map loads, and seven of them are one building split into
// parts. Two things therefore have to be shown in the running app rather than argued from the
// preset: that the parts land back together as one cathedral, and that the eight site machines
// run on their own phases of the shared beat instead of moving in lockstep. Both are checked in
// a single run, because loading this map takes long enough that doing it twice is wasteful.

test('Notre-Dame loads as one cathedral with its site running on the shared beat', async ({ page }) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'notre_dame');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'notre_dame'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await expect.poll(() => page.evaluate(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'notre_dame'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 8
    )), {
        timeout: 150_000,
        message: 'Notre-Dame should load all fifteen parts and animate the eight site pieces',
    }).toBeTruthy();

    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            trackCount: arena._glbAnimation.trackCount,
            warningCount: arena._glbLoadWarnings.length,
            colliderMode: arena.currentMapDefinition?.glbColliderMode,
            glbSceneChildren: arena._glbScene?.children?.length || 0,
        };
    });

    // Only the site moves, so only eight of the fifteen carry a clip.
    expect(state).toEqual({
        mapKey: 'notre_dame',
        trackCount: 8,
        warningCount: 0,
        colliderMode: 'dynamic',
        glbSceneChildren: 15,
    });

    const initialElapsed = await page.evaluate(() => (
        window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds
    ));
    await expect.poll(() => page.evaluate((elapsed) => (
        window.GAME_INSTANCE?.arena?.glbAnimationElapsedSeconds > elapsed
    ), initialElapsed), {
        timeout: 15_000,
        message: 'the site clock should advance once the match is running',
    }).toBeTruthy();

    // The eight clips sit on four different offsets of one six second beat. Reading their clip
    // positions in a single frame is the proof that those offsets survive into the running game
    // rather than only holding in the preset.
    const phases = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbAnimation._tracks
            .map((track) => ({ clip: track.clipName, time: Number(track.action.time.toFixed(3)) }))
    ));
    expect(phases).toHaveLength(8);
    expect(new Set(phases.map((entry) => entry.clip)).size).toBe(8);
    expect(new Set(phases.map((entry) => entry.time)).size).toBeGreaterThan(1);
    for (const entry of phases) {
        expect(entry.time).toBeGreaterThanOrEqual(0);
    }

    // Where every part actually ended up in the world. If the preset had undone the recentring
    // the loader applies wrongly, the towers would sit somewhere other than the nave, and it
    // would show here: as a west front that is not west of the choir, or as a spire that does
    // not stand over the crossing.
    const layout = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const parts = {};
        // Three.js is not exposed on window, so the world box is folded by hand: take each
        // geometry's own local box and push its eight corners through the mesh world matrix.
        for (const slot of arena._glbScene.children) {
            const url = String(slot.userData?.glbModelUrl || '');
            const name = url.split('/').pop().replace('.glb', '');
            const bounds = {
                minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
            };
            slot.updateWorldMatrix(true, true);
            slot.traverse((child) => {
                if (!child.isMesh || !child.geometry) return;
                if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                const local = child.geometry.boundingBox;
                const m = child.matrixWorld.elements;
                for (const cx of [local.min.x, local.max.x]) {
                    for (const cy of [local.min.y, local.max.y]) {
                        for (const cz of [local.min.z, local.max.z]) {
                            const x = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
                            const y = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
                            bounds.minX = Math.min(bounds.minX, x);
                            bounds.maxX = Math.max(bounds.maxX, x);
                            bounds.minY = Math.min(bounds.minY, y);
                            bounds.maxY = Math.max(bounds.maxY, y);
                        }
                    }
                }
            });
            parts[name] = bounds;
        }
        return parts;
    });

    const facade = layout['01_west_facade'];
    const nave = layout['02_nave'];
    const transept = layout['03_transept'];
    const choir = layout['04_choir_apse'];
    const roof = layout['06_roof_fleche'];
    for (const part of [facade, nave, transept, choir, roof]) {
        expect(part).toBeTruthy();
    }

    // West to east, in order, each part meeting the next rather than floating apart.
    expect(facade.maxX).toBeLessThan(nave.maxX);
    expect(nave.maxX).toBeLessThan(transept.maxX);
    expect(transept.maxX).toBeLessThan(choir.maxX);
    expect(nave.minX - facade.maxX).toBeLessThan(12);
    expect(transept.minX - nave.maxX).toBeLessThan(12);
    expect(choir.minX - transept.maxX).toBeLessThan(12);

    // 127.5 m of cathedral at 1.4 authored units per metre and a map scale of 3 is about 535
    // world units from the west front to the east end.
    const overall = choir.maxX - facade.minX;
    expect(overall).toBeGreaterThan(500);
    expect(overall).toBeLessThan(575);

    // The spire is the highest thing on the map and stands above everything else.
    expect(roof.maxY).toBeGreaterThan(facade.maxY);
    expect(roof.maxY).toBeGreaterThan(nave.maxY);
    // 8 + 96 * 1.4 authored units, times the map scale of 3, is about 427.
    expect(roof.maxY).toBeGreaterThan(390);
    expect(roof.maxY).toBeLessThan(450);
});
