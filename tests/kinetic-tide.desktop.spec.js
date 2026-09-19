import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';
import { writeFile } from 'node:fs/promises';

test('Kinetic Tide loads ten setpieces and holds them on offset phases of one beat', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="arcade"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'kinetic_tide');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'kinetic_tide'
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
        window.GAME_INSTANCE?.arena?.currentMapKey === 'kinetic_tide'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 10
    )), {
        timeout: 90_000,
        message: 'Kinetic Tide should load all ten animated setpieces',
    }).toBeTruthy();

    const initialElapsed = await page.evaluate(() => (
        window.GAME_INSTANCE.arena.glbAnimationElapsedSeconds
    ));
    await expect.poll(() => page.evaluate((elapsed) => (
        window.GAME_INSTANCE?.arena?.glbAnimationElapsedSeconds > elapsed
    ), initialElapsed), {
        timeout: 10_000,
        message: 'the Kinetic Tide animation clock should advance after match start',
    }).toBeTruthy();

    // The three lock gates share one clip and one beat but sit a third of a beat apart.
    // Reading their clip positions in the same frame is the proof that the offsets survive
    // into the running game rather than only holding in the preset.
    const gatePhases = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbAnimation._tracks
            .filter((track) => track.clipName === 'BreathGateLoop')
            .map((track) => Number(track.action.time.toFixed(3)))
    ));
    expect(gatePhases).toHaveLength(3);
    expect(new Set(gatePhases).size).toBe(3);
    for (const phase of gatePhases) {
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(4);
    }

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

    expect(state).toEqual({
        mapKey: 'kinetic_tide',
        trackCount: 10,
        warningCount: 0,
        colliderMode: 'dynamic',
        glbSceneChildren: 43,
    });

    const claddingColliders = await page.evaluate(() => (
        window.GAME_INSTANCE.arena._glbDynamicObstacles.filter((obstacle) => (
            String(obstacle.modelId || '').startsWith('kinetic-tide-cladding-')
        )).length
    ));
    expect(claddingColliders, 'decorative cladding must not create dynamic colliders').toBe(0);

    const visualQa = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const camera = game.renderer.cameras[0];
        const savedPosition = camera.position.clone();
        const savedRotation = camera.quaternion.clone();
        const savedTime = arena.glbAnimationElapsedSeconds;
        const mechanismIds = [
            'kinetic-tide-gate-two',
            'kinetic-tide-piston-tunnel',
            'kinetic-tide-iris-shutter',
            'kinetic-tide-carousel',
            'kinetic-tide-pendulums',
            'kinetic-tide-lift-rings',
            'kinetic-tide-tide-wall',
            'kinetic-tide-reactor-heart',
        ];
        const shots = [];
        try {
            for (const modelId of mechanismIds) {
                const descriptor = arena.currentMapDefinition.glbModels.find((entry) => entry.id === modelId);
                const slot = arena._glbScene.getObjectByName(`glb-slot-${modelId}`);
                const track = arena._glbAnimation._tracks.find((entry) => entry.modelId === modelId);
                const duration = track?.durationSeconds || 4;
                for (const [phase, seconds] of [['phase-a', duration * 0.125], ['phase-b', duration * 0.625]]) {
                    arena.setGlbAnimationElapsedSeconds(seconds);
                    arena.update(0);
                    const size = descriptor.targetSize * 3;
                    const center = slot.position.clone();
                    center.y += size * 0.45;
                    const approach = camera.position.clone().set(0, 0, 1)
                        .applyQuaternion(slot.quaternion).normalize().multiplyScalar(size * 1.35);
                    camera.position.copy(center).add(approach);
                    camera.position.y += size * 0.08;
                    camera.lookAt(center);
                    camera.updateMatrixWorld(true);
                    game.renderer.render();
                    shots.push({
                        name: `${modelId.replace('kinetic-tide-', '')}-${phase}`,
                        screenshot: game.renderer.renderer.domElement.toDataURL('image/png'),
                    });
                }
            }

            const cladding = [];
            for (const slot of arena._glbScene.children) {
                const modelId = String(slot.userData?.glbModelId || '');
                if (!modelId.startsWith('kinetic-tide-cladding-')) continue;
                let meshes = 0;
                let lights = 0;
                let invalidNames = 0;
                let maxEmission = 0;
                slot.traverse((node) => {
                    if (node.isLight) lights += 1;
                    if (!node.isMesh) return;
                    meshes += 1;
                    if (!String(node.name || '').includes('_nocol')) invalidNames += 1;
                    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                        maxEmission = Math.max(maxEmission, Number(material?.emissiveIntensity) || 0);
                    }
                });
                cladding.push({ modelId, visible: slot.visible, meshes, lights, invalidNames, maxEmission });
            }
            return { shots, cladding };
        } finally {
            camera.position.copy(savedPosition);
            camera.quaternion.copy(savedRotation);
            camera.updateMatrixWorld(true);
            arena.setGlbAnimationElapsedSeconds(savedTime);
            arena.update(0);
        }
    });
    for (const shot of visualQa.shots) {
        const screenshotPath = testInfo.outputPath(`${shot.name}.png`);
        await writeFile(screenshotPath, Buffer.from(shot.screenshot.split(',')[1], 'base64'));
        await testInfo.attach(shot.name, { path: screenshotPath, contentType: 'image/png' });
    }
    expect(visualQa.shots).toHaveLength(16);
    expect(visualQa.cladding).toHaveLength(16);
    expect(visualQa.cladding.filter((entry) => !(
        entry.visible && entry.meshes > 0 && entry.lights === 0 && entry.invalidNames === 0
            && entry.maxEmission <= 1.5
    ))).toEqual([]);

    // The moving parts have to carry their collision with them, otherwise a closed gate
    // would still be flyable and an open one would still block.
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

    await expect.poll(() => page.evaluate((baseline) => {
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
            return arena.checkCollisionFast(current, 0.5)
                && !arena.checkCollisionFast(entry.center, 0.5);
        });
    }, probe), {
        timeout: 20_000,
        message: 'a Kinetic Tide setpiece should collide at its current pose and no longer at its old one',
    }).toBeTruthy();
});
