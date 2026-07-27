import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

test('desktop killcam renders the killed vehicle at the recorded terminal impact pose', async ({
    page,
}, testInfo) => {
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

    const setup = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const entityManager = game?.entityManager;
        const recorder = game?.recorder;
        const player = entityManager?.humanPlayers?.[0] || null;
        if (!entityManager || !recorder || !player?.position || !player?.quaternion) {
            return { ok: false, reason: 'runtime-unavailable' };
        }

        const terminal = {
            x: Number(player.position.x) || 0,
            y: Number(player.position.y) || 0,
            z: Number(player.position.z) || 0,
        };
        recorder._snapshotStore?.reset?.();

        player.position.set(terminal.x, terminal.y, terminal.z + 12);
        recorder.roundStartTime = performance.now();
        recorder.captureSnapshotNow(entityManager.players);

        player.position.set(terminal.x, terminal.y, terminal.z + 6);
        recorder.roundStartTime = performance.now() - 1000;
        recorder.captureSnapshotNow(entityManager.players);

        player.position.set(terminal.x, terminal.y, terminal.z);
        recorder.roundStartTime = performance.now() - 2000;
        entityManager._killPlayer(player, 'WALL', {
            impactPoint: player.position.clone(),
        });

        return {
            ok: entityManager._killcamSystem?.isActive?.() === true,
            reason: '',
            playerIndex: player.index,
            terminal,
            runtimeKind: window.curviosApp?.capabilities?.runtimeKind || null,
        };
    });

    expect(setup.ok, setup.reason).toBeTruthy();
    expect(setup.runtimeKind).toBe('electron');

    const midpointState = await page.evaluate((playerIndex) => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        entityManager?._lastRoundGhostSystem?.seekSourceTime?.(1, 0);
        entityManager?.renderInterpolatedTransforms?.(1, 1 / 60);
        return entityManager?.getLastRoundGhostState?.()
            ?.ghosts?.find?.((entry) => entry.idx === playerIndex) || null;
    }, setup.playerIndex);

    expect(midpointState?.visible).toBeTruthy();
    expect(midpointState?.x).toBeCloseTo(setup.terminal.x, 1);
    expect(midpointState?.y).toBeCloseTo(setup.terminal.y, 1);
    expect(midpointState?.z).toBeCloseTo(setup.terminal.z + 6, 1);

    await page.evaluate(() => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        const killcam = entityManager?._killcamSystem;
        for (let frame = 0; frame < 180 && killcam?.isActive?.() && !killcam?._explosionTriggered; frame += 1) {
            entityManager.updateLastRoundGhostPlayback(1 / 60);
        }
        entityManager?.renderInterpolatedTransforms?.(1, 1 / 60);
        entityManager?.updateCameras?.(1 / 60);
    });

    const terminalState = await page.evaluate((playerIndex) => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        const killcam = entityManager?._killcamSystem;
        const ghostState = entityManager?.getLastRoundGhostState?.();
        const replayPlayer = ghostState?.ghosts?.find?.((entry) => entry.idx === playerIndex);
        return {
            killcamActive: killcam?.isActive?.() === true,
            explosionTriggered: killcam?._explosionTriggered === true,
            replayPlayer,
            hudSuppressed: document.getElementById('hud')?.classList.contains('killcam-active') === true,
        };
    }, setup.playerIndex);

    expect(terminalState.killcamActive).toBeTruthy();
    expect(terminalState.explosionTriggered).toBeTruthy();
    expect(terminalState.replayPlayer?.visible).toBeTruthy();
    expect(terminalState.replayPlayer?.x).toBeCloseTo(setup.terminal.x, 1);
    expect(terminalState.replayPlayer?.y).toBeCloseTo(setup.terminal.y, 1);
    expect(terminalState.replayPlayer?.z).toBeCloseTo(setup.terminal.z, 1);
    expect(terminalState.hudSuppressed).toBeTruthy();

    await page.screenshot({
        path: testInfo.outputPath('desktop-killcam-terminal-impact.png'),
    });
});
