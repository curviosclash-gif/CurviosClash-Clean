import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('desktop killcam replays the lossless rendered framebuffer', async ({ page }, testInfo) => {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 1;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '1';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#submenu-game:not(.hidden) #btn-start');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.entityManager?.gameModeStrategy?.modeType === 'HUNT'
        && window.GAME_INSTANCE?.entityManager?.humanPlayers?.length === 1
    ), null, { timeout: 30000 });

    await page.evaluate(() => {
        const player = window.GAME_INSTANCE?.entityManager?.humanPlayers?.[0];
        if (player) player.spawnProtectionTimer = 999;
    });
    await page.waitForFunction(() => {
        const state = window.GAME_INSTANCE?.entityManager?.getKillcamPixelReplayState?.();
        return !!state?.lastCaptureError || (
            state?.supported === true
            && state?.capturedFrameCount >= 2
            && state?.capturedDuration >= 1.8
        );
    }, null, { timeout: 15000 });
    const captureState = await page.evaluate(
        () => window.GAME_INSTANCE?.entityManager?.getKillcamPixelReplayState?.()
    );
    expect(captureState?.lastCaptureError || '').toBe('');

    const scheduled = await page.evaluate(() => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        const player = entityManager?.humanPlayers?.[0];
        if (!entityManager || !player?.alive) return { ok: false };
        entityManager._killPlayer(player, 'WALL', {
            impactPoint: player.position.clone(),
        });
        const state = entityManager.getKillcamPixelReplayState();
        return {
            ok: state.pending === true,
            active: entityManager._killcamSystem?.isActive?.() === true,
            state,
        };
    });

    expect(scheduled.ok).toBeTruthy();
    expect(scheduled.active).toBeFalsy();

    await page.waitForFunction(() => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        return entityManager?._killcamSystem?.isActive?.() === true
            && entityManager?.getKillcamPixelReplayState?.()?.active === true;
    }, null, { timeout: 15000 });

    const replay = await page.evaluate(() => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        const killcam = entityManager?._killcamSystem;
        const buffer = killcam?.pixelReplayBuffer;
        const state = entityManager?.getKillcamPixelReplayState?.();
        const overlay = buffer?._overlayCanvas;
        const frame = buffer?._playbackFrames?.[buffer?._frameCursor || 0];
        if (!overlay || !frame?.imageData) return { ok: false, state };

        const expected = document.createElement('canvas');
        expected.width = overlay.width;
        expected.height = overlay.height;
        const expectedContext = expected.getContext('2d', { willReadFrequently: true });
        expectedContext.putImageData(frame.imageData, 0, 0);
        const actualPixels = overlay.getContext('2d', { willReadFrequently: true })
            .getImageData(0, 0, overlay.width, overlay.height).data;
        const expectedPixels = expectedContext
            .getImageData(0, 0, expected.width, expected.height).data;
        let exact = actualPixels.length === expectedPixels.length;
        for (let index = 0; exact && index < actualPixels.length; index++) {
            if (actualPixels[index] !== expectedPixels[index]) exact = false;
        }
        return {
            ok: true,
            exact,
            state,
            overlayVisible: overlay.hidden !== true && overlay.style.display !== 'none',
            sourceWidth: entityManager.renderer?.canvas?.width,
            sourceHeight: entityManager.renderer?.canvas?.height,
            sceneReplayActive: entityManager.getKillcamReplayState?.()?.active === true,
            hudSuppressed: document.getElementById('hud')?.classList.contains('killcam-active') === true,
        };
    });

    expect(replay.ok).toBeTruthy();
    expect(replay.exact).toBeTruthy();
    expect(replay.overlayVisible).toBeTruthy();
    expect(replay.sceneReplayActive).toBeFalsy();
    expect(replay.state?.playbackFrameCount).toBeGreaterThanOrEqual(2);
    expect(replay.state?.sourceDuration).toBeGreaterThan(1.5);
    expect(replay.state?.captureBackend).toBe('webgl-readpixels');
    expect(replay.state?.width).toBe(replay.sourceWidth);
    expect(replay.state?.height).toBe(replay.sourceHeight);
    expect(replay.hudSuppressed).toBeTruthy();

    const terminal = await page.evaluate(() => {
        const killcam = window.GAME_INSTANCE?.entityManager?._killcamSystem;
        const buffer = killcam?.pixelReplayBuffer;
        killcam._replayElapsed = killcam._replaySourceDuration;
        killcam.advanceReplayPlayback(0);
        const overlay = buffer?._overlayCanvas;
        const frame = buffer?._playbackFrames?.at?.(-1);
        if (!overlay || !frame?.imageData) return { exact: false };
        const actual = overlay.getContext('2d', { willReadFrequently: true })
            .getImageData(0, 0, overlay.width, overlay.height).data;
        const expected = frame.imageData.data;
        let exact = actual.length === expected.length;
        for (let index = 0; exact && index < actual.length; index++) {
            if (actual[index] !== expected[index]) exact = false;
        }
        return {
            exact,
            currentFrameIndex: buffer._frameCursor,
            frameCount: buffer._playbackFrames.length,
            explosionTriggered: killcam._explosionTriggered === true,
        };
    });
    expect(terminal.exact).toBeTruthy();
    expect(terminal.currentFrameIndex).toBe(terminal.frameCount - 1);
    expect(terminal.explosionTriggered).toBeTruthy();

    await page.screenshot({
        path: testInfo.outputPath('desktop-killcam-pixel-replay.png'),
    });
});
