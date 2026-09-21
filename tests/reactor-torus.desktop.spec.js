import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

test('reactor plays one of four torus clouds with sound, flash and the enlarged ceiling', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await page.selectOption('#map-select', 'reactor_site');
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.gameMode = 'HUNT';
        game.settings.numBots = 0;
        document.getElementById('bot-count').value = '0';
        game.runtimeFacade.onSettingsChanged({ changedKeys: ['bots.count', 'mode'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => {
        const arena = window.GAME_INSTANCE?.arena;
        return arena?.currentMapKey === 'reactor_site'
            && arena._glbScene?.children?.length === arena.currentMapDefinition.glbModels.length
            && !arena._glbLoadError;
    }, null, { timeout: 180_000 });
    await waitForRenderFrames(page, 5);

    for (let variant = 0; variant < 4; variant += 1) {
        const result = await page.evaluate((selected) => {
            const game = window.GAME_INSTANCE;
            const manager = game.entityManager;
            const arena = game.arena;
            const system = manager.getMapDestructibleSystem();
            system.startRound();
            arena.setGlbAnimationElapsedSeconds(0);
            const oldInt = manager.runtimeRng.int;
            const oldPlay = manager.audio.play;
            const sounds = [];
            manager.runtimeRng.int = (count) => count === 4 ? selected : oldInt(count);
            manager.audio.play = function (type, options) { sounds.push(type); return oldPlay.call(this, type, options); };
            let event;
            try {
                event = system.applyMeshHit('reactor_block', 900).event;
                if (sounds.includes('REACTOR_BREACH')) throw new Error('sound preceded pressure');
                arena.setGlbAnimationElapsedSeconds(.28);
                system.updateFeedback();
            } finally {
                manager.runtimeRng.int = oldInt;
                manager.audio.play = oldPlay;
            }
            manager.particles.rocketBlastEffect.update(.01);
            const flash = manager.particles.rocketBlastEffect.light?.intensity || 0;
            const slots = arena._glbScene.children.filter((slot) => String(slot.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
            const active = slots.filter((slot) => slot.visible);
            return { selected: event.variantIndex, active: active.map((slot) => slot.userData.glbModelId),
                sounds, flash, height: arena.currentMapDefinition.size[1] };
        }, variant);
        expect(result.selected).toBe(variant);
        expect(result.active).toEqual([variant === 0 ? 'reactor-mushroom-cloud' : `reactor-mushroom-cloud-${variant + 1}`]);
        expect(result.sounds.filter((sound) => sound === 'REACTOR_BREACH')).toHaveLength(1);
        expect(result.flash).toBeGreaterThan(0);
        expect(result.height).toBe(286);
        for (const seconds of [2, 12, 48]) {
            const shot = await page.evaluate((time) => {
                const game = window.GAME_INSTANCE;
                const arena = game.arena;
                arena.setGlbAnimationElapsedSeconds(time);
                arena._glbAnimation.advance(0);
                const slot = arena._glbScene.children.find((node) => node.visible && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
                slot.updateWorldMatrix(true, true);
                let top = -Infinity;
                slot.traverse((node) => {
                    if (!node.isMesh) return;
                    const positions = node.geometry.attributes.position;
                    const m = node.matrixWorld.elements;
                    for (let i = 0; i < positions.count; i += 1) {
                        const y = m[1] * positions.getX(i) + m[5] * positions.getY(i) + m[9] * positions.getZ(i) + m[13];
                        if (y > top) top = y;
                    }
                });
                const runtime = game.renderer;
                const camera = runtime.cameras[0];
                const position = camera.position.clone();
                const quaternion = camera.quaternion.clone();
                camera.position.set(350, Math.max(160, top * 1.02), 450);
                camera.lookAt(0, top * .83, 0);
                camera.updateMatrixWorld(true);
                runtime.renderer.setRenderTarget(null);
                runtime.renderer.render(runtime.scene, camera);
                const png = runtime.renderer.domElement.toDataURL('image/png');
                camera.position.copy(position); camera.quaternion.copy(quaternion);
                camera.updateMatrixWorld(true);
                return { png, top };
            }, seconds);
            await writeFile(testInfo.outputPath(`variant-${variant + 1}-${seconds}s.png`), Buffer.from(shot.png.split(',')[1], 'base64'));
            if (seconds === 48) expect(shot.top).toBeCloseTo(286 * 1.15 * 3, 1);
        }
    }
    expect(errors).toEqual([]);
});
