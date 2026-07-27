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
        const replayProjectile = {
            id: 'killcam-projectile',
            type: 'ROCKET_MEDIUM',
            owner: player,
            position: player.position.clone(),
            velocity: player.position.clone().set(0, 0, -20),
            radius: 0.4,
        };
        const replayPowerup = {
            networkId: 'killcam-powerup',
            type: 'SPEED_UP',
            baseY: terminal.y,
            mesh: {
                visible: true,
                position: player.position.clone().set(terminal.x + 3, terminal.y, terminal.z + 4),
            },
        };
        const replayParticles = {
            count: 1,
            positions: new Float32Array([terminal.x + 1, terminal.y, terminal.z + 3]),
            velocities: new Float32Array([0, 1, 0]),
            lifetimes: new Float32Array([1]),
            maxLifetimes: new Float32Array([1]),
            gravities: new Float32Array([-5]),
            scales: new Float32Array([0.4]),
            colors: new Float32Array([1, 0.4, 0.1]),
        };
        const replayScene = {
            players: entityManager.players,
            projectiles: [replayProjectile],
            powerupManager: { items: [replayPowerup] },
            particles: replayParticles,
            entityRuntimeConfig: entityManager.entityRuntimeConfig,
        };

        player.position.set(terminal.x, terminal.y, terminal.z + 12);
        replayProjectile.position.set(terminal.x, terminal.y, terminal.z + 10);
        recorder.roundStartTime = performance.now();
        recorder.captureSnapshotNow(replayScene);

        player.position.set(terminal.x, terminal.y, terminal.z + 6);
        replayProjectile.position.set(terminal.x, terminal.y, terminal.z + 5);
        recorder.roundStartTime = performance.now() - 1000;
        recorder.captureSnapshotNow(replayScene);

        player.position.set(terminal.x, terminal.y, terminal.z);
        recorder.roundStartTime = performance.now() - 2000;
        entityManager._killPlayer(player, 'WALL', {
            impactPoint: player.position.clone(),
        });

        return {
            ok: entityManager._killcamSystem?.isActive?.() === true,
            reason: '',
            playerIndex: player.index,
            playerColor: player.color,
            initialReplayFocus: {
                x: entityManager._killcamSystem?._focusPoint?.x,
                y: entityManager._killcamSystem?._focusPoint?.y,
                z: entityManager._killcamSystem?._focusPoint?.z,
            },
            terminal,
            runtimeKind: window.curviosApp?.capabilities?.runtimeKind || null,
        };
    });

    expect(setup.ok, setup.reason).toBeTruthy();
    expect(setup.runtimeKind).toBe('electron');
    expect(setup.initialReplayFocus?.z).toBeCloseTo(setup.terminal.z + 12, 1);

    const midpointState = await page.evaluate((playerIndex) => {
        const entityManager = window.GAME_INSTANCE?.entityManager;
        const killcam = entityManager?._killcamSystem;
        killcam._replayElapsed = 1;
        killcam.advanceReplayPlayback(0);
        entityManager?.renderInterpolatedTransforms?.(1, 1 / 60);
        const replayState = entityManager?.getKillcamReplayState?.();
        return {
            player: replayState?.ghosts?.find?.((entry) => entry.idx === playerIndex) || null,
            cameraFocus: {
                x: killcam?._focusPoint?.x,
                y: killcam?._focusPoint?.y,
                z: killcam?._focusPoint?.z,
            },
            otherPlayersVisible: replayState?.ghosts?.filter?.(
                (entry) => entry.idx !== playerIndex && entry.visible === true
            )?.length || 0,
            projectileCount: replayState?.projectileCount || 0,
            powerupCount: replayState?.powerupCount || 0,
            particleCount: replayState?.particleCount || 0,
        };
    }, setup.playerIndex);

    expect(midpointState?.player?.visible).toBeTruthy();
    expect(midpointState?.player?.x).toBeCloseTo(setup.terminal.x, 1);
    expect(midpointState?.player?.y).toBeCloseTo(setup.terminal.y, 1);
    expect(midpointState?.player?.z).toBeCloseTo(setup.terminal.z + 6, 1);
    expect(midpointState?.cameraFocus?.x).toBeCloseTo(midpointState?.player?.x, 1);
    expect(midpointState?.cameraFocus?.y).toBeCloseTo(midpointState?.player?.y, 1);
    expect(midpointState?.cameraFocus?.z).toBeCloseTo(midpointState?.player?.z, 1);
    expect(midpointState?.player?.trailColor).toBe(setup.playerColor);
    expect(midpointState?.otherPlayersVisible).toBeGreaterThan(0);
    expect(midpointState?.projectileCount).toBe(1);
    expect(midpointState?.powerupCount).toBe(1);
    expect(midpointState?.particleCount).toBe(1);
    await page.screenshot({
        path: testInfo.outputPath('desktop-killcam-scene-midpoint.png'),
    });

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
        const replayState = entityManager?.getKillcamReplayState?.();
        const replayPlayer = replayState?.ghosts?.find?.((entry) => entry.idx === playerIndex);
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
