import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { writeFile } from 'node:fs/promises';

const RIDES = [
    ['marquee', [1, 0]], ['clown', [1, 0]], ['hammer-two', [1, 0]], ['ducks', [1, 0]], ['swing', [1, 0]],
    ['wheel', [1, 0]], ['loop', [1, 0]], ['carousel', [0, 1]], ['tower', [-1, 0]], ['big-top', [-1, 0]],
];

test('Neon-Jahrmarkt loads every ride, runs them on one clock and moves their collision', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'neon_carnival');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'neon_carnival', null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');

    await expect.poll(() => page.evaluate(() => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?.currentMapKey === 'neon_carnival' && !!arena._glbScene && !arena._glbLoadError
            && arena._glbAnimation?.trackCount === 14;
    }), { timeout: 90_000, message: 'all fourteen animated rides should load' }).toBeTruthy();

    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            warnings: arena._glbLoadWarnings.length,
            slots: arena._glbScene.children.length,
            colliderMode: arena.currentMapDefinition.glbColliderMode,
            skylineColliders: arena._glbDynamicObstacles.filter((entry) => String(entry.modelId).includes('skyline')).length,
            movingColliders: arena._glbDynamicObstacles.length,
        };
    });
    expect(state).toMatchObject({ warnings: 0, slots: 14, colliderMode: 'scene', skylineColliders: 0 });
    expect(state.movingColliders).toBeGreaterThan(40);

    const startClock = await page.evaluate(() => window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds);
    await expect.poll(() => page.evaluate((elapsed) => (
        window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds > elapsed
    ), startClock), { timeout: 10_000, message: 'the fair clock should run once the match starts' }).toBeTruthy();

    // The three hammers share one clip a third of a beat apart; reading them in one frame proves
    // the offsets reach the running game.
    const hammerPhases = await page.evaluate(() => window.GAME_INSTANCE.arena._glbAnimation._tracks
        .filter((track) => track.clipName === 'HammerStrikeLoop')
        .map((track) => Number(track.action.time.toFixed(3))));
    expect(hammerPhases).toHaveLength(3);
    expect(new Set(hammerPhases).size).toBe(3);

    // One shot per ride, from where a player approaches it, at two points of its loop.
    const shots = await page.evaluate((rides) => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const camera = game.renderer.cameras[0];
        const saved = { position: camera.position.clone(), rotation: camera.quaternion.clone(), time: arena.glbAnimationElapsedSeconds };
        const result = [];
        try {
            for (const [ride, [dx, dz]] of rides) {
                const slot = arena._glbScene.getObjectByName(`glb-slot-neon-carnival-${ride}`);
                const marker = slot.getObjectByName('Anchor_Pass');
                const track = arena._glbAnimation._tracks.find((entry) => entry.modelId === `neon-carnival-${ride}`);
                for (const [phase, share] of [['a', 0.1], ['b', 0.6]]) {
                    arena.setGlbAnimationElapsedSeconds(track.durationSeconds * share);
                    arena.update(0);
                    slot.updateMatrixWorld(true);
                    const target = marker.getWorldPosition(camera.position.clone());
                    const distance = ride === 'big-top' ? 150 : 105;
                    camera.position.set(target.x - dx * distance, target.y + distance * 0.28, target.z - dz * distance);
                    camera.lookAt(target.x, target.y + 12, target.z);
                    camera.updateMatrixWorld(true);
                    game.renderer.render();
                    result.push({ name: `${ride}-${phase}`, data: game.renderer.renderer.domElement.toDataURL('image/png') });
                }
            }
        } finally {
            camera.position.copy(saved.position);
            camera.quaternion.copy(saved.rotation);
            camera.updateMatrixWorld(true);
            arena.setGlbAnimationElapsedSeconds(saved.time);
            arena.update(0);
        }
        return result;
    }, RIDES);
    for (const shot of shots) {
        const file = testInfo.outputPath(`${shot.name}.png`);
        await writeFile(file, Buffer.from(shot.data.split(',')[1], 'base64'));
        await testInfo.attach(shot.name, { path: file, contentType: 'image/png' });
    }
    expect(shots).toHaveLength(RIDES.length * 2);

    // A moving part has to take its collision along: solid where it is now, free where it was.
    const baseline = await page.evaluate(() => window.GAME_INSTANCE.arena._glbDynamicObstacles.map((entry, index) => ({
        index,
        center: { x: (entry.box.min.x + entry.box.max.x) / 2, y: (entry.box.min.y + entry.box.max.y) / 2, z: (entry.box.min.z + entry.box.max.z) / 2 },
    })));
    await expect.poll(() => page.evaluate((entries) => {
        const arena = window.GAME_INSTANCE.arena;
        return entries.some(({ index, center }) => {
            const box = arena._glbDynamicObstacles[index]?.box;
            if (!box) return false;
            const now = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
            if (Math.hypot(now.x - center.x, now.y - center.y, now.z - center.z) < 3) return false;
            return arena.checkCollisionFast(now, 0.5) && !arena.checkCollisionFast(center, 0.5);
        });
    }, baseline), { timeout: 20_000, message: 'a ride should collide at its current pose and no longer at its old one' }).toBeTruthy();
});
