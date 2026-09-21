import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from './helpers.desktop.js';
import { collectErrors, openCustomSubmenu, waitForLoadedGame, waitForRenderFrames } from './helpers.js';

const SHOT_DIR = path.resolve('test-results/reactor-cloud');

// What the mushroom cloud looks like from a cockpit, and whether its fireball is really over.
//
// The contract tests hold the exported clip against the runtime table row by row, and the blast
// tests hold the damage against that same table. Neither can answer the only question that matters
// to a player: from the seat, four hundred metres away and looking up, does this read as rising,
// rolling smoke - or as a grey ball? A scene can pass every measurement and still be a grey ball,
// because what a file cannot show is what the renderer, the map's fog and the tone mapping do to it.
//
// So the clip is posed here, in the real desktop renderer on the real map, at four seconds of its
// own life, and photographed from where the player actually spawns. The map clock is set rather
// than waited out - setGlbAnimationElapsedSeconds is the path a client that fell behind the host
// already takes, so posing the scene this way is the runtime's own behaviour, not a test-only
// shortcut - and forty seconds of real waiting would buy nothing but forty seconds.
const BREACH_SECONDS = [1, 4, 12, 40];
// Out of ReactorSiteDestructibles: the segment's mesh prefix, its hit points, and the second its
// fireball ends at.
const REACTOR_MESH = 'reactor_block';
const REACTOR_HP = 900;
const FIREBALL_GONE_SECONDS = 4.4;

test('the reactor breach rises as a cloud from the cockpit, and its fireball ends', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);

    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', 'reactor_site');
    await page.waitForFunction(() => window.GAME_INSTANCE?.settings?.mapKey === 'reactor_site',
        null, { timeout: 5000 });
    // HUNT: the plant is only destructible there, and without bots nothing else moves the clock.
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
            && arena?._glbScene?.children?.length === arena?.currentMapDefinition?.glbModels?.length
            && !arena._glbLoadError;
    }, null, { timeout: 180_000 });
    await waitForRenderFrames(page, 20);

    const breach = await page.evaluate(({ mesh, hp }) => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        game.arena.setGlbAnimationElapsedSeconds(0);
        const result = manager.getMapDestructibleSystem().applyMeshHit(mesh, hp);
        return {
            destroyed: result?.destroyed === true,
            atSeconds: result?.event?.atSeconds ?? null,
            modeType: manager.gameModeStrategy?.modeType || null,
        };
    }, { mesh: REACTOR_MESH, hp: REACTOR_HP });

    expect(breach.modeType, 'the plant is only destructible in HUNT').toBe('HUNT');
    expect(breach.destroyed, 'the containment breaks on one full-strength hit').toBe(true);

    await mkdir(SHOT_DIR, { recursive: true });
    const poses = [];
    for (const seconds of BREACH_SECONDS) {
        // Setting the map clock only records the time; GlbAnimationDriver writes the pose on its
        // next advance, so the frames in between are what actually moves the setpiece there.
        await page.evaluate((atSeconds) => {
            window.GAME_INSTANCE.arena.setGlbAnimationElapsedSeconds(atSeconds);
        }, seconds);
        await waitForRenderFrames(page, 3);

        const pose = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const runtime = game.renderer;

            // The cloud's slot, and the fireball mesh inside it, read off the live scene.
            let slot = null;
            let fireball = null;
            runtime.matchRoot.traverse((node) => {
                if (node.visible && String(node.userData?.glbModelId || '').startsWith('reactor-mushroom-cloud')) slot = node;
            });
            if (!slot) return null;
            slot.traverse((node) => {
                if (node.isMesh && String(node.name || '').includes('_fire_fireball')) fireball = node;
            });
            slot.updateWorldMatrix(true, true);

            // Extents of everything the slot draws, in world units, without importing THREE here.
            let lo = [Infinity, Infinity, Infinity];
            let hi = [-Infinity, -Infinity, -Infinity];
            slot.traverse((node) => {
                if (!node.isMesh || !node.geometry) return;
                node.geometry.computeBoundingBox?.();
                const box = node.geometry.boundingBox;
                if (!box) return;
                for (let corner = 0; corner < 8; corner += 1) {
                    const point = {
                        x: (corner & 1 ? box.max : box.min).x,
                        y: (corner & 2 ? box.max : box.min).y,
                        z: (corner & 4 ? box.max : box.min).z,
                    };
                    const m = node.matrixWorld.elements;
                    const world = [
                        m[0] * point.x + m[4] * point.y + m[8] * point.z + m[12],
                        m[1] * point.x + m[5] * point.y + m[9] * point.z + m[13],
                        m[2] * point.x + m[6] * point.y + m[10] * point.z + m[14],
                    ];
                    lo = lo.map((value, axis) => Math.min(value, world[axis]));
                    hi = hi.map((value, axis) => Math.max(value, world[axis]));
                }
            });

            const fireScale = fireball
                ? Math.hypot(fireball.matrixWorld.elements[0], fireball.matrixWorld.elements[1],
                    fireball.matrixWorld.elements[2])
                : 0;

            const centre = [0, 1, 2].map((axis) => (lo[axis] + hi[axis]) / 2);
            // Two viewpoints, both drawn by the game's own renderer with the map's own fog and
            // tone mapping. `cockpit` is where the player actually is - the honest answer to "what
            // does a pilot see" - and `near` is close enough that the rolled rim and the shape of
            // the silhouette can be judged, which from four hundred metres through fog they cannot.
            //
            // The picture is taken off the canvas in the same task as the render. A screenshot
            // would not do: the game loop paints its own chase-camera frame before Playwright ever
            // gets to look, and what lands on disk is the cockpit as it was, not as it was framed.
            const player = game.entityManager?.players?.[0];
            const camera = runtime.cameras[0];
            const held = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
            };
            const cockpit = player?.position
                ? [player.position.x, player.position.y + 6, player.position.z]
                : [-330, 96, -330];
            // The near viewpoint is deliberately not backed off to fit the whole cloud in: the
            // map's fog closes between 240 and 600 units, so a camera far enough away to frame a
            // cloud four hundred units wide sees nothing but fog. It sits just outside the plant
            // instead and looks up at the underside, which is the vantage the roll reads from.
            const views = {
                cockpit,
                near: [centre[0] + 150, 70, centre[2] + 185],
            };
            const shots = {};
            for (const [name, eye] of Object.entries(views)) {
                camera.position.set(eye[0], eye[1], eye[2]);
                camera.lookAt(centre[0], centre[1] * (name === 'near' ? 0.7 : 1), centre[2]);
                camera.updateMatrixWorld(true);
                runtime.renderer.setRenderTarget(null);
                runtime.renderer.render(runtime.scene, camera);
                shots[name] = runtime.renderer.domElement.toDataURL('image/png');
            }
            camera.position.copy(held.position);
            camera.quaternion.copy(held.quaternion);
            camera.updateMatrixWorld(true);

            return {
                visible: slot.visible,
                clockSeconds: game.arena.glbAnimationElapsedSeconds,
                top: hi[1],
                width: Math.max(hi[0] - lo[0], hi[2] - lo[2]),
                fireScale,
                cockpit,
                shots,
            };
        });

        expect(pose, `the cloud is placed at ${seconds} s`).not.toBeNull();
        expect(pose.visible, `the cloud is shown at ${seconds} s`).toBe(true);
        const { shots, ...measured } = pose;
        poses.push({ seconds, ...measured });

        const stamp = String(seconds).padStart(2, '0');
        for (const [name, dataUrl] of Object.entries(shots)) {
            const body = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
            expect(body.length, `${name} at ${seconds} s produced a picture`).toBeGreaterThan(2000);
            const file = path.join(SHOT_DIR, `breach-${stamp}s-${name}.png`);
            await writeFile(file, body);
            await testInfo.attach(`breach-${stamp}s-${name}`, { body, contentType: 'image/png' });
        }
    }

    // It grows and it climbs, at every one of the four seconds and not only between the first two.
    for (let index = 1; index < poses.length; index += 1) {
        expect(poses[index].top, `the cloud is higher at ${poses[index].seconds} s than at ${poses[index - 1].seconds} s`)
            .toBeGreaterThan(poses[index - 1].top);
        expect(poses[index].width, `the cloud is wider at ${poses[index].seconds} s`)
            .toBeGreaterThan(poses[index - 1].width);
    }
    // The map clock really is where it was put, give or take the frames that applied the pose.
    for (const pose of poses) {
        expect(Math.abs(pose.clockSeconds - pose.seconds),
            `the clock reads ${pose.clockSeconds.toFixed(2)} where ${pose.seconds} was asked for`)
            .toBeLessThan(0.5);
    }
    // The fireball is a body early on and nothing later, which is the whole point of the hazard.
    // A second in the table puts it at 59 m, and the map draws a metre as 1.8 world units.
    expect(poses[0].fireScale, 'the fireball is a hundred units across a second in').toBeGreaterThan(80);
    expect(poses[1].fireScale, 'it has all but gone by 4 s')
        .toBeLessThan(poses[0].fireScale / 3);
    expect(poses[2].fireScale, 'and there is nothing left of it at 12 s').toBeLessThan(0.02);
    // Runtime damage and queue cleanup are covered by the blast contract tests. Here the exported
    // fireball must stay invisible for the entire smoke phase, using only the rendered scene.
    for (const pose of poses.filter((entry) => entry.seconds > FIREBALL_GONE_SECONDS)) {
        expect(pose.fireScale, `only smoke remains at ${pose.seconds}s`).toBeLessThan(0.02);
    }

    expect(errors.filter((entry) => !/WebGL|GPU stall/i.test(String(entry))), 'no page errors').toEqual([]);
});
