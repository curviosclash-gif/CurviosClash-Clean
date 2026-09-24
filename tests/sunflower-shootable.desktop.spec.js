import path from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { openCustomSubmenu, waitForLoadedGame } from './helpers.js';

const MAP_KEY = 'dandelion_sky';
const PREVIEW_DIR = path.resolve('assets/models/sunflower/blender/previews');
const GLB_PATH = path.resolve('assets/models/sunflower/sunflower_shootable.glb');

async function startSunflowerFight(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.click('#submenu-custom:not(.hidden) [data-mode-path="fight"]');
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.selectOption('#map-select', MAP_KEY);
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        game.settings.numBots = 0;
        game.runtimeFacade?.onSettingsChanged?.({ changedKeys: ['bots.count'] });
    });
    await page.click('#btn-start');
    await page.waitForFunction((mapKey) => {
        const game = window.GAME_INSTANCE;
        return game?.state === 'PLAYING'
            && game?.arena?.currentMapKey === mapKey
            && game?.arena?._sunflowerKernels?.count === 220
            && game?.entityManager?.humanPlayers?.length > 0;
    }, MAP_KEY, { timeout: 120_000 });
}

async function captureCanvas(page, filename) {
    const image = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const qa = window.__sunflowerDesktopQa;
        if (qa?.pair?.activeCameraPosition) {
            const camera = game.renderer.cameras[0];
            camera.position.fromArray(qa.pair.activeCameraPosition);
            camera.lookAt(...qa.pair.cameraTarget);
            camera.updateMatrixWorld(true);
        }
        game.renderer.render();
        return game.renderer.canvas.toDataURL('image/png').split(',')[1];
    });
    const filePath = path.join(PREVIEW_DIR, filename);
    await writeFile(filePath, Buffer.from(image, 'base64'));
    return filePath;
}

test('desktop MG shots remove two adjacent sunflower kernels and leave visible gaps', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await startSunflowerFight(page);

    const metrics = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const arena = game.arena;
        const controller = arena._sunflowerKernels;
        const renderer = game.renderer;
        const Vector3 = controller.kernels[0].node.position.constructor;
        const Quaternion = controller.kernels[0].node.quaternion.constructor;
        const head = controller.heads[0].node.getWorldPosition(new Vector3());
        const headRotation = controller.heads[0].node.getWorldQuaternion(new Quaternion());
        const viewNormal = new Vector3(0, 0, 1).applyQuaternion(headRotation).normalize();
        let pair = null;
        const makeRay = (kernel) => {
            const center = kernel.node.getWorldPosition(new Vector3());
            const normal = viewNormal.clone();
            return {
                center,
                normal,
                origin: center.clone().addScaledVector(normal, 22),
                direction: normal.clone().negate(),
            };
        };
        for (let index = 0; index < controller.kernels.length - 1; index += 1) {
            const firstRay = makeRay(controller.kernels[index]);
            const secondRay = makeRay(controller.kernels[index + 1]);
            const firstHit = controller.raycast(firstRay.origin, firstRay.direction, 60);
            const secondHit = controller.raycast(secondRay.origin, secondRay.direction, 60);
            if (firstHit?.kernelIndex === index + 1 && secondHit?.kernelIndex === index + 2) {
                pair = { firstRay, secondRay, firstHit, secondHit };
                break;
            }
        }
        if (!pair) throw new Error('Loaded sunflower has no directly aimable adjacent kernel pair.');

        const plantRoot = (() => {
            let root = controller.kernels[0].node;
            while (root.parent && root.parent !== arena._glbScene) root = root.parent;
            return root;
        })();
        const geometryArrays = new Set();
        const materials = new Set();
        plantRoot.traverse((node) => {
            if (node.geometry) {
                for (const attribute of Object.values(node.geometry.attributes || {})) {
                    if (attribute?.array) geometryArrays.add(attribute.array);
                }
                if (node.geometry.index?.array) geometryArrays.add(node.geometry.index.array);
            }
            for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
                if (material) materials.add(material);
            }
        });
        let sunflowerBytes = [...geometryArrays].reduce((total, array) => total + array.byteLength, 0);
        arena._glbScene.traverse((node) => {
            if (node.userData?.role === 'sunflower_kernel_render_batch' && node.instanceMatrix?.array) {
                sunflowerBytes += node.instanceMatrix.array.byteLength;
                if (node.instanceColor?.array) sunflowerBytes += node.instanceColor.array.byteLength;
            }
        });

        const camera = renderer.cameras[0];
        const makeCameraPosition = (ray) => {
            const side = new Vector3().crossVectors(new Vector3(0, 1, 0), ray.normal);
            if (side.lengthSq() < 0.0001) side.set(1, 0, 0);
            side.normalize();
            return ray.center.clone().addScaledVector(ray.normal, 13)
                .addScaledVector(side, 3).add(new Vector3(0, 2, 0));
        };
        const firstCameraPosition = makeCameraPosition(pair.firstRay);
        const secondCameraPosition = makeCameraPosition(pair.secondRay);
        camera.position.copy(firstCameraPosition);
        camera.lookAt(head);
        camera.updateMatrixWorld(true);
        const samples = [];
        for (let index = 0; index < 36; index += 1) {
            const started = performance.now();
            renderer.render();
            renderer.renderer.getContext().finish();
            if (index >= 8) samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);

        window.__sunflowerDesktopQa = {
            pair: {
                firstIndex: pair.firstHit.kernelIndex,
                firstName: pair.firstHit.sourceName,
                firstOrigin: pair.firstRay.origin.toArray(),
                firstDirection: pair.firstRay.direction.toArray(),
                firstTarget: pair.firstRay.center.toArray(),
                secondIndex: pair.secondHit.kernelIndex,
                secondName: pair.secondHit.sourceName,
                secondOrigin: pair.secondRay.origin.toArray(),
                secondDirection: pair.secondRay.direction.toArray(),
                secondTarget: pair.secondRay.center.toArray(),
                firstCameraPosition: firstCameraPosition.toArray(),
                secondCameraPosition: secondCameraPosition.toArray(),
                activeCameraPosition: firstCameraPosition.toArray(),
                cameraTarget: head.toArray(),
            },
        };

        return {
            kernelCount: controller.count,
            renderBatch: controller.getRenderBatchMetrics(),
            glbBytes: null,
            sunflowerGeometryAndInstancesBytes: sunflowerBytes,
            sunflowerMaterials: materials.size,
            drawCalls: renderer.renderer.info.render.calls,
            triangles: renderer.renderer.info.render.triangles,
            rendererGeometries: renderer.renderer.info.memory.geometries,
            rendererTextures: renderer.renderer.info.memory.textures,
            p95FrameMs: samples[Math.floor(samples.length * 0.95)],
            adjacentIndices: [pair.firstHit.kernelIndex, pair.secondHit.kernelIndex],
        };
    });
    metrics.glbBytes = (await stat(GLB_PATH)).size;
    expect(metrics.kernelCount).toBe(220);
    expect(metrics.renderBatch.enabled).toBe(true);
    expect(metrics.renderBatch.instances).toBe(220);
    expect(metrics.renderBatch.estimatedDrawCalls).toBeLessThanOrEqual(12);
    expect(metrics.adjacentIndices[1]).toBe(metrics.adjacentIndices[0] + 1);
    const initialView = await captureCanvas(page, 'sunflower_desktop_game_camera.png');
    await testInfo.attach('game-camera-at-map-spawn', { path: initialView, contentType: 'image/png' });

    const firstShot = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const player = game.entityManager.humanPlayers[0];
        const qa = window.__sunflowerDesktopQa;
        const direction = new player.position.constructor(...qa.pair.firstDirection);
        const origin = new player.position.constructor(...qa.pair.firstOrigin);
        player.position.copy(origin).addScaledVector(direction, -2.1);
        player.velocity.set(0, 0, 0);
        player.quaternion.setFromUnitVectors(new player.position.constructor(0, 0, -1), direction);
        player.shootCooldown = 0;
        const result = game.entityManager._overheatGunSystem.tryFire(player);
        const events = game.arena.serializeSunflowerKernels();
        const event = events.at(-1) || null;
        if (!event) throw new Error('The first real MG shot did not release a sunflower kernel.');
        game.arena.setGlbAnimationElapsedSeconds(event[1] / 1000 + 0.24);
        const kernel = game.arena._sunflowerKernels.byIndex.get(qa.pair.firstIndex);
        const original = new player.position.constructor(...qa.pair.firstTarget);
        const current = kernel.node.getWorldPosition(new player.position.constructor());
        const camera = game.renderer.cameras[0];
        camera.position.fromArray(qa.pair.firstCameraPosition);
        camera.lookAt(...qa.pair.cameraTarget);
        camera.updateMatrixWorld(true);
        game.renderer.render();
        return {
            result: { ok: result.ok, hitCount: result.hitCount, projectileCount: result.projectileCount },
            event,
            expectedIndex: qa.pair.firstIndex,
            parentRole: kernel.node.parent?.userData?.role || '',
            gapTravel: current.distanceTo(original),
            image: game.renderer.canvas.toDataURL('image/png').split(',')[1],
        };
    });
    expect(firstShot.result.ok).toBe(true);
    expect(firstShot.result.hitCount).toBe(1);
    expect(firstShot.result.projectileCount).toBe(1);
    expect(firstShot.event[0]).toBe(firstShot.expectedIndex);
    expect(firstShot.parentRole).toBe('sunflower_kernel_flight_root');
    expect(firstShot.gapTravel).toBeGreaterThan(0.5);
    const firstView = path.join(PREVIEW_DIR, 'sunflower_desktop_one_kernel_removed.png');
    await writeFile(firstView, Buffer.from(firstShot.image, 'base64'));
    await testInfo.attach('one-kernel-in-flight-gap-open', { path: firstView, contentType: 'image/png' });

    await page.waitForTimeout(180);
    const secondShot = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const player = game.entityManager.humanPlayers[0];
        const qa = window.__sunflowerDesktopQa;
        const direction = new player.position.constructor(...qa.pair.secondDirection);
        const origin = new player.position.constructor(...qa.pair.secondOrigin);
        player.position.copy(origin).addScaledVector(direction, -2.1);
        player.velocity.set(0, 0, 0);
        player.quaternion.setFromUnitVectors(new player.position.constructor(0, 0, -1), direction);
        player.shootCooldown = 0;
        const result = game.entityManager._overheatGunSystem.tryFire(player);
        const events = game.arena.serializeSunflowerKernels();
        const event = events.at(-1) || null;
        const kernel = game.arena._sunflowerKernels.byIndex.get(qa.pair.secondIndex);
        const original = new player.position.constructor(...qa.pair.secondTarget);
        game.arena.setGlbAnimationElapsedSeconds(game.arena.glbAnimationElapsedSeconds + 0.24);
        const current = kernel.node.getWorldPosition(new player.position.constructor());
        const camera = game.renderer.cameras[0];
        qa.pair.activeCameraPosition = qa.pair.secondCameraPosition;
        camera.position.fromArray(qa.pair.secondCameraPosition);
        camera.lookAt(...qa.pair.cameraTarget);
        camera.updateMatrixWorld(true);
        game.renderer.render();
        return {
            result: { ok: result.ok, hitCount: result.hitCount, projectileCount: result.projectileCount },
            event,
            expectedIndex: qa.pair.secondIndex,
            parentRole: kernel.node.parent?.userData?.role || '',
            gapTravel: current.distanceTo(original),
            releasedIndices: events.map((entry) => entry[0]),
            image: game.renderer.canvas.toDataURL('image/png').split(',')[1],
        };
    });
    expect(secondShot.result.ok).toBe(true);
    expect(secondShot.result.hitCount).toBe(1);
    expect(secondShot.result.projectileCount).toBe(1);
    expect(secondShot.event[0]).toBe(secondShot.expectedIndex);
    expect(secondShot.parentRole).toBe('sunflower_kernel_flight_root');
    expect(secondShot.gapTravel).toBeGreaterThan(0.5);
    expect(secondShot.releasedIndices).toEqual(metrics.adjacentIndices);
    const secondView = path.join(PREVIEW_DIR, 'sunflower_desktop_two_kernels_removed.png');
    await writeFile(secondView, Buffer.from(secondShot.image, 'base64'));
    await testInfo.attach('two-adjacent-kernel-gaps-open', { path: secondView, contentType: 'image/png' });
    console.log(JSON.stringify({ sunflowerDesktopMetrics: metrics,
        firstShot: { ...firstShot, image: '[attached png]' },
        secondShot: { ...secondShot, image: '[attached png]' } }));
    await testInfo.attach('sunflower-desktop-metrics', {
        body: JSON.stringify({ metrics, firstShot: { ...firstShot, image: '[attached png]' },
            secondShot: { ...secondShot, image: '[attached png]' } }),
        contentType: 'application/json',
    });
});
