import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';

async function captureHydraPose(page, testInfo, pose) {
    const png = await page.evaluate((requestedPose) => {
        const game = window.GAME_INSTANCE;
        const system = game?.entityManager?._mapUnitSystem;
        const unit = system?.units?.[0];
        if (!unit?.root?.userData?.hydra?.model) throw new Error('Hydra GLB is not loaded');
        unit.yaw = 0;
        if (requestedPose === 'bite') {
            unit.hydra.phase = 'warning';
            unit.hydra.action = 'snap';
            unit.hydra.head = 3;
            unit.hydra.event += 1;
            unit.hydra.direction.set(0, 0, 1);
            unit.hydra.moving = false;
            system._updateVisual(unit, 0);
            system._updateVisual(unit, 0.92);
        } else {
            unit.hydra.phase = 'idle';
            unit.hydra.action = 'idle';
            unit.hydra.moving = true;
            system._updateVisual(unit, 0.2);
        }
        const renderer = game.renderer;
        const camera = renderer.cameras[0].clone();
        const center = unit.root.position.clone().add(new unit.root.position.constructor(0, 12, 0));
        camera.position.copy(center).add(new unit.root.position.constructor(0, 1, 38));
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        const qaScene = new renderer.scene.constructor();
        qaScene.background = renderer.scene.background;
        renderer.scene.traverse((object) => {
            if (object.isLight) {
                const light = object.clone();
                if (Number.isFinite(light.intensity)) light.intensity *= 3;
                qaScene.add(light);
            }
        });
        const previousParent = unit.root.parent;
        previousParent?.remove(unit.root);
        qaScene.add(unit.root);
        try {
            renderer.renderer.render(qaScene, camera);
            return renderer.renderer.domElement.toDataURL('image/png').split(',')[1];
        } finally {
            qaScene.remove(unit.root);
            previousParent?.add(unit.root);
        }
    }, pose);
    const outputPath = testInfo.outputPath(`hydra-${pose}.png`);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(png, 'base64'));
}

test('Hydra-Tempelring starts a three-bot Hunt with independent static and animated GLBs', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await selectSessionType(page, 'single');
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)');
    await expect(page.locator('#map-select option[value="hydra_temple"]')).toHaveCount(1);
    await page.selectOption('#map-select', 'hydra_temple');
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => window.GAME_INSTANCE?.arena?.currentMapKey === 'hydra_temple'
        && window.GAME_INSTANCE?.entityManager?._mapUnitSystem?.units?.length === 1,
    null, { timeout: 120_000 });

    await expect.poll(() => page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const unit = game?.entityManager?._mapUnitSystem?.units?.[0];
        return !!unit?.root?.userData?.hydra?.model
            && (game?.arena?._glbScene?.children?.length || 0) >= 1;
    }), { timeout: 60_000 }).toBe(true);

    const state = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const unit = game.entityManager._mapUnitSystem.units[0];
        const visual = unit.root.userData.hydra;
        return {
            mode: game.activeGameMode,
            bots: game.entityManager.players.filter((player) => player.isBot).length,
            species: unit.definition.species,
            hp: unit.hp,
            sockets: visual.sockets.filter(Boolean).length,
            clips: [...visual.clips.keys()].sort(),
            fallbackVisible: visual.fallback.visible,
            mapLoadError: !!game.arena._glbLoadError,
        };
    });
    expect(state.mode).toBe('HUNT');
    expect(state.bots).toBe(3);
    expect(state.species).toBe('hydra_v3');
    expect(state.hp).toBe(600);
    expect(state.sockets).toBe(5);
    expect(state.clips).toEqual([
        'Idle', 'Snap_1', 'Snap_2', 'Snap_3', 'Snap_4', 'Snap_5',
        'Spit_1', 'Spit_2', 'Spit_3', 'Spit_4', 'Spit_5', 'Walk',
    ]);
    expect(state.fallbackVisible).toBe(false);
    expect(state.mapLoadError).toBe(false);
    await captureHydraPose(page, testInfo, 'front');
    await captureHydraPose(page, testInfo, 'bite');
});
