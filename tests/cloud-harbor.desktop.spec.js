import { writeFileSync } from 'node:fs';

import { expect, test } from './helpers.desktop.js';
import { menuScreenSelector, openCustomSubmenu, openStartSetupSection, returnToMenu, waitForLoadedGame } from './helpers.js';
import {
    installControl,
    pilotStatus,
    readEvents,
    stopPilot,
} from '../scripts/playtest/playtest-control.mjs';

// Fourteen parts modelled in one shared frame only form the sky city if the loader puts each back
// on the centre it was exported from. A part that lands a few units off still passes every node
// test but closes the zeppelin's cargo bay or floats an island above its own collider, so the
// probes below sample geometry that only exists where the parts line up: solid where the layout
// builds structure, open where the route flies.

// World units are authored units times the map scale of 3.
const SCALE = 3;

test('the Cloud Harbor loads all fourteen parts with its flight channels open', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator(`${menuScreenSelector('modeChoice')} [data-mode-path="arcade"]`).click();
    // The first test of a run pays for the app's cold start; 5 s was not always enough there.
    await page.locator(menuScreenSelector('freeplay')).waitFor({ state: 'visible', timeout: 15_000 });
    await openStartSetupSection(page, 'map');
    await page.selectOption('#map-select', 'cloud_harbor');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.settings?.mapKey === 'cloud_harbor'
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
        window.GAME_INSTANCE?.arena?.currentMapKey === 'cloud_harbor'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 5
    )), {
        timeout: 150_000,
        message: 'the sky city should load and animate its five setpieces',
    }).toBeTruthy();

    const state = await page.evaluate((scale) => {
        const arena = window.GAME_INSTANCE.arena;
        const at = (x, y, z) => arena.checkCollisionFast(
            { x: x * scale, y: y * scale, z: z * scale },
            0.1,
        );
        return {
            mapKey: arena.currentMapKey,
            trackCount: arena._glbAnimation.trackCount,
            warningCount: arena._glbLoadWarnings.length,
            colliderMode: arena.currentMapDefinition?.glbColliderMode,
            glbSceneChildren: arena._glbScene?.children?.length || 0,
            // The cloud sea under everything.
            cloudSeaSolid: at(0, 2, 0),
            // The zeppelin's cargo bay is open along its axis; its hull collider wraps the bay.
            cargoBayOpen: !at(-106, 68, 100) && !at(-65, 68, 100) && !at(-24, 68, 100),
            zeppelinHullSolid: at(-65, 86, 100),
            // The island rock under the market and the weather tower's core.
            marketRockSolid: at(104, 28, 22),
            towerCoreSolid: at(120, 80, -66),
            aboveTowerOpen: !at(120, 160, -66),
            // Both market lanes and the harbor gate's opening.
            bazaarOpen: !at(110, 56, 22),
            roofLaneOpen: !at(110, 104, 22),
            harborGateOpen: !at(-128, 56, -48),
            harborRockSolid: at(-125, 50, -115),
        };
    }, SCALE);

    expect(state).toEqual({
        mapKey: 'cloud_harbor',
        trackCount: 5,
        warningCount: 0,
        colliderMode: 'scene',
        glbSceneChildren: 14,
        cloudSeaSolid: true,
        cargoBayOpen: true,
        zeppelinHullSolid: true,
        marketRockSolid: true,
        towerCoreSolid: true,
        aboveTowerOpen: true,
        bazaarOpen: true,
        roofLaneOpen: true,
        harborGateOpen: true,
        harborRockSolid: true,
    });

    // What a pilot sees from five rings, looking down the next leg.
    const views = await page.evaluate((scale) => {
        const runtime = window.GAME_INSTANCE.renderer;
        const three = runtime.renderer;
        const camera = runtime.cameras[0];
        const originalPosition = camera.position.clone();
        const originalQuaternion = camera.quaternion.clone();
        const legs = {
            'mooring-dock': [[-160, 74, 100], [-65, 68, 100]],
            'windmills': [[-10, 72, 104], [45, 80, 60]],
            'market-split': [[55, 80, 30], [110, 80, 22]],
            'weather-tower': [[175, 95, -20], [120, 120, -66]],
            'harbor-approach': [[-20, 90, -125], [-128, 56, -48]],
        };
        const captures = {};
        try {
            for (const [name, [position, target]] of Object.entries(legs)) {
                camera.position.set(...position.map((value) => value * scale));
                camera.lookAt(...target.map((value) => value * scale));
                camera.updateMatrixWorld(true);
                three.setRenderTarget(null);
                three.render(runtime.scene, camera);
                captures[name] = three.domElement.toDataURL('image/png');
            }
        } finally {
            camera.position.copy(originalPosition);
            camera.quaternion.copy(originalQuaternion);
            camera.updateMatrixWorld(true);
        }
        return captures;
    }, SCALE);
    for (const [name, image] of Object.entries(views)) {
        const outputPath = testInfo.outputPath(`cloud-harbor-${name}.png`);
        writeFileSync(outputPath, Buffer.from(image.split(',')[1], 'base64'));
        await testInfo.attach(`cloud-harbor-${name}.png`, { path: outputPath });
    }

    await page.evaluate(() => window.GAME_INSTANCE?.returnToMenu?.());
});

async function startCloudHarborArcadeMatch(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator(`${menuScreenSelector('modeChoice')} [data-mode-path="arcade"]`).click();
    await page.locator(menuScreenSelector('freeplay')).waitFor({ state: 'visible', timeout: 15_000 });
    await openStartSetupSection(page, 'map');
    await page.selectOption('#map-select', 'cloud_harbor');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'cloud_harbor', null, { timeout: 5000 });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        const slider = document.getElementById('bot-count');
        if (slider) slider.value = '0';
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction(() => (
        window.GAME_INSTANCE?.state === 'PLAYING'
        && window.GAME_INSTANCE?.settings?.gameMode === 'ARCADE'
        && window.GAME_INSTANCE?.arena?.currentMapKey === 'cloud_harbor'
        && window.GAME_INSTANCE?.arena?._glbScene
        && !window.GAME_INSTANCE?.arena?._glbLoadError
        && window.GAME_INSTANCE?.arena?._glbAnimation?.trackCount === 5
    ), null, { timeout: 150_000 });
}

async function flyCloudHarborBranch(page, branchId) {
    const session = { page };
    await installControl(session);
    const initial = await page.evaluate((branch) => {
        const game = window.GAME_INSTANCE;
        const manager = game?.entityManager;
        const route = manager?.getParcoursRouteSnapshot?.();
        const progress = manager?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(0);
        return {
            mapKey: game?.arena?.currentMapKey,
            gameMode: game?.settings?.gameMode,
            routeId: route?.routeId,
            totalCheckpoints: route?.totalCheckpoints,
            checkpointIds: route?.checkpoints?.map((entry) => entry.id) || [],
            flightPoints: [...(route?.checkpoints || []).filter(entry =>
                entry.id !== (branch === 'BAZAAR' ? 'CP08_ROOF' : 'CP08_BAZAAR')),
                route?.finish].filter(Boolean).map(entry => ({ id: entry.id, point: entry.pos.map((value, axis) =>
                    ['CP15', 'CP16'].includes(entry.id) && axis === 2 ? -366
                        : value + (entry.forward?.[axis] || 0) * 3 + (axis === 1 ? 6 : 0)) })),
            branchNextIds: route?.checkpoints?.find((entry) => entry.id === 'CP07')?.nextCheckpointIds || [],
            bazaarNextIds: route?.checkpoints?.find((entry) => entry.id === 'CP08_BAZAAR')?.nextCheckpointIds || [],
            roofNextIds: route?.checkpoints?.find((entry) => entry.id === 'CP08_ROOF')?.nextCheckpointIds || [],
            finishId: route?.finish?.id,
            maxSegmentTimeMs: route?.rules?.maxSegmentTimeMs,
            progress,
            playerAlive: manager?.players?.[0]?.alive,
            playerHp: manager?.players?.[0]?.hp,
            animationSeconds: Number(game?.arena?._glbAnimation?.elapsedSeconds) || 0,
        };
    }, branchId);
    expect(initial.mapKey).toBe('cloud_harbor');
    expect(initial.gameMode).toBe('ARCADE');
    expect(initial.routeId).toBe('cloud_harbor_v1');
    expect(initial.totalCheckpoints).toBe(17);
    expect(initial.totalCheckpoints + 1).toBe(18); // spawn -> CP01, all checkpoint edges, CP17 -> FINISH
    expect(initial.checkpointIds).toContain('CP08_BAZAAR');
    expect(initial.checkpointIds).toContain('CP08_ROOF');
    expect(initial.branchNextIds).toEqual(['CP08_BAZAAR', 'CP08_ROOF']);
    expect(initial.bazaarNextIds).toContain('CP09');
    expect(initial.roofNextIds).toContain('CP09');
    expect(initial.finishId).toBe('FINISH');
    expect(initial.maxSegmentTimeMs).toBe(30_000);
    expect(initial.progress?.expectedCheckpointIds).toContain('CP01');
    expect(initial.playerAlive).toBe(true);
    expect(initial.playerHp).toBeGreaterThan(0);

    const eventSequenceStart = (await readEvents(session, 0)).lastSeq;
    await stopPilot(session, 'deterministic native map traversal');
    await page.evaluate((points) => {
        // This map-geometry gate steers orientation through the public player API, like
        // the portal-chain flight. Translation, collision, hazards, bots, checkpoint
        // consumption and the animation clock continue through the real GameLoop.
        // The six-unit parallel line avoids following the racing bot's damaging trail.
        const watcher = window.__cloudHarborFlightWatcher = { frame: null, checkpoint: null, approachIndex: 0 };
        // Circle outside the moving gyroscopes before entering their west-side ring.
        // Coordinates are world-space; the authored 30-second segment deadlines remain active.
        const approaches = {
            CP11: [[480, 342, -315], [360, 342, -315]],
            CP12: [[240, 405, -315], [240, 396, -228]],
            CP13: [[240, 450, -198], [360, 450, -198]],
            CP15: [[207, 400, -330], [207, 400, -375], [75, 306, -375]],
            CP17: [[-93, 210, -375]],
        };
        const observe = () => {
            const manager = window.GAME_INSTANCE?.entityManager;
            const progress = manager?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(0);
            if (!progress || progress.completed) return;
            const target = points.find(point => progress.expectedCheckpointIds?.includes(point.id))
                || (progress.nextCheckpointIndex === progress.totalCheckpoints ? points.at(-1) : null);
            if (target) {
                const player = manager?.players?.[0];
                if (watcher.checkpoint !== target.id) {
                    watcher.checkpoint = target.id;
                    watcher.approachIndex = 0;
                }
                const approach = approaches[target.id] || [];
                let steeringPoint = approach[watcher.approachIndex];
                if (steeringPoint && Math.hypot(...steeringPoint.map((value, axis) =>
                    value - player.position[['x', 'y', 'z'][axis]])) <= player.hitboxRadius * 2) {
                    watcher.approachIndex++;
                    steeringPoint = approach[watcher.approachIndex];
                }
                player?.setLookAtWorld?.(...(steeringPoint || target.point));
            }
            watcher.frame = requestAnimationFrame(observe);
        };
        watcher.frame = requestAnimationFrame(observe);
    }, initial.flightPoints);

    const branchCheckpointId = `CP08_${branchId}`;
    const deadline = Date.now() + 300_000;
    let latest = initial;
    try {
        while (Date.now() < deadline) {
            latest = await page.evaluate(() => {
                const game = window.GAME_INSTANCE;
                const manager = game?.entityManager;
                const progress = manager?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(0);
                return {
                    state: game?.state,
                    mapKey: game?.arena?.currentMapKey,
                    progress,
                    animationSeconds: Number(game?.arena?._glbAnimation?.elapsedSeconds) || 0,
                    simFrame: window.__playtest?.simFrame || 0,
                };
            });
            expect(latest.mapKey).toBe('cloud_harbor');
            expect(latest.progress).toBeTruthy();
            expect(latest.progress.resetCount, `${branchId}: no segment timeout/reset; ${JSON.stringify(latest.progress)}`).toBe(0);
            expect(latest.progress.checkpointRespawnsUsed, `${branchId}: no checkpoint respawn; ${JSON.stringify(latest.progress)}`).toBe(0);
            expect(latest.progress.wrongOrderCount, `${branchId}: no wrong-order checkpoint; ${JSON.stringify(latest.progress)}`).toBe(0);
            expect(latest.progress.segmentElapsedMs, `${branchId}: authored segment limit remains 30000 ms`).toBeLessThan(30_000);
            if (latest.progress.completed) break;
            if (latest.state !== 'PLAYING') {
                throw new Error(`${branchId}: run left PLAYING before FINISH; ${JSON.stringify(latest)}`);
            }
            await page.waitForFunction((frame) => (
                window.__playtest?.simFrame >= frame + 30
                || window.GAME_INSTANCE?.state !== 'PLAYING'
                || window.GAME_INSTANCE?.entityManager?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(0)?.completed === true
            ), latest.simFrame, { timeout: 10_000 });
        }
        expect(latest.progress?.completed, `${branchId}: did not reach FINISH within five minutes; ${JSON.stringify(latest)}`).toBe(true);
    } catch (error) {
        const diagnostic = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const player = game?.entityManager?.players?.[0];
            return { position: player?.position?.toArray(), quaternion: player?.quaternion?.toArray(),
                velocity: player?.velocity?.toArray(), hp: player?.hp, alive: player?.alive,
                deathCause: player?.lastDeathCause, pilot: window.__playtestPilotRuntime?.describe() };
        });
        console.info(`CLOUD_FLIGHT_FAILURE ${JSON.stringify({ branchId, latest, diagnostic,
            events: await readEvents(session, eventSequenceStart) })}`);
        throw error;
    } finally {
        if (!page.isClosed()) await page.evaluate(() => {
            cancelAnimationFrame(window.__cloudHarborFlightWatcher?.frame);
            delete window.__cloudHarborFlightWatcher;
        });
        await stopPilot(session, `${branchId} branch traversal finished`);
    }

    const events = await readEvents(session, eventSequenceStart);
    expect(events.events.length, 'the complete flight event log must remain available')
        .toBe(events.lastSeq - eventSequenceStart);
    const humanDeaths = events.events.filter((entry) => entry.type === 'death' && entry.isHuman);
    const passed = latest.progress.passedCheckpointIds;
    const expectedPassedSequence = [
        'CP01', 'CP02', 'CP03', 'CP04', 'CP05', 'CP06', 'CP07', branchCheckpointId,
        'CP09', 'CP10', 'CP11', 'CP12', 'CP13', 'CP14', 'CP15', 'CP16', 'CP17',
    ];
    expect(passed).toEqual(expectedPassedSequence);
    expect(passed).not.toContain(branchId === 'BAZAAR' ? 'CP08_ROOF' : 'CP08_BAZAAR');
    expect(passed).toHaveLength(initial.totalCheckpoints);
    expect(latest.progress.nextCheckpointIndex).toBe(initial.totalCheckpoints);
    expect(latest.progress.completed).toBe(true);
    expect(humanDeaths, `${branchId}: real human pilot should not die during the route`).toHaveLength(0);
    expect(latest.animationSeconds).toBeGreaterThan(initial.animationSeconds);
    expect((await pilotStatus(session)).mode).toBe('off');

    return {
        branchId,
        routeId: initial.routeId,
        legs: initial.totalCheckpoints + 1,
        passed,
        finish: latest.progress.completed,
        deaths: humanDeaths.length,
        resets: latest.progress.resetCount,
        respawns: latest.progress.checkpointRespawnsUsed,
        wrongOrder: latest.progress.wrongOrderCount,
        animationSeconds: latest.animationSeconds - initial.animationSeconds,
    };
}

test('the live Cloud Harbor pilot completes both market branches through FINISH', async ({ page }) => {
    test.setTimeout(960_000);
    const results = [];
    for (const branchId of ['BAZAAR', 'ROOF']) {
        await startCloudHarborArcadeMatch(page);
        results.push(await flyCloudHarborBranch(page, branchId));
        if (branchId !== 'ROOF') await returnToMenu(page);
    }
    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.branchId)).toEqual(['BAZAAR', 'ROOF']);
    for (const result of results) {
        expect(result.routeId).toBe('cloud_harbor_v1');
        expect(result.legs).toBe(18);
        expect(result.finish).toBe(true);
        expect(result.deaths).toBe(0);
        expect(result.resets).toBe(0);
        expect(result.respawns).toBe(0);
        expect(result.wrongOrder).toBe(0);
        expect(result.animationSeconds).toBeGreaterThan(0);
    }
});
