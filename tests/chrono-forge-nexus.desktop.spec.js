import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { writeFile } from 'node:fs/promises';

test('Chrono-Forge Nexus loads and advances all eight Blender loops on desktop', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'chrono_forge_nexus');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'chrono_forge_nexus'
    ), null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });

    await page.click('#btn-start');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.arena?.currentMapKey === 'chrono_forge_nexus'
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 8
    ), null, { timeout: 30000 });

    const before = await page.evaluate(() => (
        window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds
    ));
    await expect.poll(
        () => page.evaluate((baseline) => {
            const game = window.GAME_INSTANCE;
            return game?.state === 'PLAYING'
                && game?.arena?.glbAnimationElapsedSeconds > baseline;
        }, before),
        {
            message: 'the Chrono-Forge animation clock should advance after match start',
            timeout: 5000,
        }
    ).toBeTruthy();
    const state = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        return {
            mapKey: arena.currentMapKey,
            trackCount: arena._glbAnimation.trackCount,
            loadError: arena._glbLoadError,
            warnings: arena._glbLoadWarnings,
            colliderMode: arena._glbFootprint?.colliderMode,
        };
    });

    expect(state.mapKey).toBe('chrono_forge_nexus');
    expect(state.loadError).toBeNull();
    expect(state.warnings).toEqual([]);
    expect(state.colliderMode).toBe('dynamic');
    expect(state.trackCount).toBe(8);

    // The moving setpieces must carry collision with them instead of leaving a hitbox
    // behind at the pose they were authored in.
    const probe = await page.evaluate(() => {
        const arena = window.GAME_INSTANCE.arena;
        const centerOf = (box) => ({
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: (box.min.z + box.max.z) / 2,
        });
        return arena._glbDynamicObstacles.map((obstacle, index) => ({
            index,
            center: centerOf(obstacle.box),
        }));
    });
    expect(probe.length).toBeGreaterThan(0);

    await expect.poll(
        () => page.evaluate((baseline) => {
            const arena = window.GAME_INSTANCE.arena;
            const centerOf = (box) => ({
                x: (box.min.x + box.max.x) / 2,
                y: (box.min.y + box.max.y) / 2,
                z: (box.min.z + box.max.z) / 2,
            });
            return baseline.some((entry) => {
                const obstacle = arena._glbDynamicObstacles[entry.index];
                if (!obstacle) return false;
                const current = centerOf(obstacle.box);
                const travelled = Math.hypot(
                    current.x - entry.center.x,
                    current.y - entry.center.y,
                    current.z - entry.center.z,
                );
                if (travelled < 1) return false;
                // Solid where the mesh is now, free where it used to be.
                return arena.checkCollisionFast(current, 0.5)
                    && !arena.checkCollisionFast(entry.center, 0.5);
            });
        }, probe),
        {
            message: 'an animated setpiece should collide at its current pose and no longer at its old one',
            timeout: 20000,
        }
    ).toBeTruthy();

    const temple = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const slot = arena._glbScene.getObjectByName('glb-slot-chrono-forge-temple-gates');
        const left = slot.getObjectByName('temple_gate_left');
        const right = slot.getObjectByName('temple_gate_right');
        const camera = game.renderer.cameras[0];
        const savedPosition = camera.position.clone();
        const savedRotation = camera.quaternion.clone();
        const savedTime = arena.glbAnimationElapsedSeconds;
        const phases = [];
        try {
            for (const [name, seconds] of [['closed', 0], ['opening', 1], ['open', 5], ['closing', 9]]) {
                arena.setGlbAnimationElapsedSeconds(seconds);
                arena.update(0);
                const center = left.getWorldPosition(left.position.clone())
                    .add(right.getWorldPosition(right.position.clone())).multiplyScalar(0.5);
                const width = slot.children[0].scale.x * 11;
                camera.position.copy(center).add(camera.position.clone().set(-width * 0.78, width * 0.08, width * 0.05));
                camera.lookAt(center);
                camera.updateMatrixWorld(true);
                game.renderer.render();
                phases.push({
                    name,
                    blocked: arena.checkCollisionFast(center, 1.1),
                    screenshot: game.renderer.renderer.domElement.toDataURL('image/png'),
                });
            }
            const collisionNames = arena._glbDynamicObstacles
                .map((entry) => entry.meshCollider.mesh.name)
                .filter((name) => name.startsWith('temple_')).sort();
            let lightCount = 0;
            game.renderer.scene.traverse((node) => {
                if (node.isPointLight && node.name.startsWith('map-light-chrono_temple_')) lightCount++;
            });
            return { phases, collisionNames, lightCount };
        } finally {
            camera.position.copy(savedPosition);
            camera.quaternion.copy(savedRotation);
            camera.updateMatrixWorld(true);
            arena.setGlbAnimationElapsedSeconds(savedTime);
            arena.update(0);
        }
    });
    for (const phase of temple.phases) {
        const screenshotPath = testInfo.outputPath(`temple-${phase.name}.png`);
        await writeFile(screenshotPath, Buffer.from(phase.screenshot.split(',')[1], 'base64'));
        await testInfo.attach(`temple-${phase.name}`, { path: screenshotPath, contentType: 'image/png' });
    }
    expect(temple.collisionNames).toEqual(['temple_gate_left', 'temple_gate_right']);
    expect(temple.lightCount).toBe(2);
    expect(temple.phases.find((phase) => phase.name === 'closed').blocked).toBe(true);
    expect(temple.phases.find((phase) => phase.name === 'open').blocked).toBe(false);
});
