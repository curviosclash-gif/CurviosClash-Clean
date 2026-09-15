import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, startGame } from './helpers.js';

const PORTAL_TYPES = [
    'portal_ring',
    'portal_cross',
    'portal_diamond',
    'portal_hex',
    'portal_octagon',
    'portal_square',
    'portal_star',
    'portal_triangle',
    'portal_ring',
    'portal_square',
];

const PAIR_COLORS = [
    0x20e6ff,
    0xff4fcf,
    0xffd84a,
    0x6dff85,
    0xa77cff,
    0xff795c,
    0x56a8ff,
    0xeaff63,
    0xff61a4,
    0x66ffe0,
];

test('portal visual gallery keeps depth, pair identity, functional cues, and constant exit size', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await startGame(page);

    const result = await page.evaluate(({ portalTypes, pairColors }) => {
        const game = window.GAME_INSTANCE;
        const arena = game?.arena;
        const portalSystem = arena?._portalGateSystem;
        const camera = game?.renderer?.cameras?.[0];
        if (!arena || !portalSystem || !camera) throw new Error('portal gallery runtime unavailable');

        const originalCollision = arena.checkCollision;
        const originalConfig = arena.entityRuntimeConfig;
        const originalCameraPosition = camera.position.clone();
        const originalCameraQuaternion = camera.quaternion.clone();
        const originalFog = game.renderer.scene.fog;
        const originalViewportLayout = game.renderer.viewportLayout;
        const hiddenSceneObjects = [];
        game.renderer.scene.traverse((object) => {
            if ((object.isMesh || object.isLine || object.isPoints || object.isSprite) && object.visible) {
                hiddenSceneObjects.push({ object, visible: object.visible });
            }
        });
        const xSlots = [-28, -14, 0, 14, 28];
        const portals = portalTypes.map((visualType, index) => {
            const row = index < 5 ? 0 : 1;
            const x = xSlots[index % 5];
            const aY = row === 0 ? 25 : -9;
            const bY = row === 0 ? 9 : -25;
            return {
                a: [x, aY, 0],
                b: [x, bY, 0],
                color: pairColors[index],
                modelA: visualType,
                modelB: index === 0 ? 'portal_star' : visualType,
            };
        });

        try {
            for (const entry of hiddenSceneObjects) entry.object.visible = false;
            arena.portalsEnabled = true;
            arena.checkCollision = () => false;
            arena.entityRuntimeConfig = {
                ...originalConfig,
                GAMEPLAY: {
                    ...originalConfig.GAMEPLAY,
                    PLANAR_MODE: false,
                    PORTAL_COUNT: 0,
                },
            };
            portalSystem.build({
                portalMode: 'authored',
                portals,
                gates: [
                    { type: 'boost', pos: [-13, -42, 0], forward: [0, 0, 1], color: 0xffb34d },
                    { type: 'slingshot', pos: [1, -42, 0], forward: [0, 0, 1], up: [0, 1, 0], color: 0x7dfbff },
                ],
                exitPortal: { pos: [18, -42, 0], color: 0x00ff88, activateOnClear: true },
            }, 1);
            arena.checkCollision = originalCollision;
            arena.entityRuntimeConfig = originalConfig;
            game.renderer.scene.fog = null;
            game.renderer.setViewportLayout('single');

            const exitPortal = arena.exitPortals[0];
            const inactiveScale = exitPortal.mesh.scale.toArray();
            const capture = (position, target) => {
                camera.position.set(...position);
                camera.lookAt(...target);
                camera.updateMatrixWorld(true);
                game.renderer.render();
                const canvas = game.renderer.renderer.domElement;
                const gl = game.renderer.renderer.getContext();
                const pixels = new Uint8Array(canvas.width * canvas.height * 4);
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                let colorfulPixels = 0;
                for (let offset = 0; offset < pixels.length; offset += 4) {
                    const red = pixels[offset];
                    const green = pixels[offset + 1];
                    const blue = pixels[offset + 2];
                    const maximum = Math.max(red, green, blue);
                    const minimum = Math.min(red, green, blue);
                    if (maximum > 80 && maximum - minimum > 35) colorfulPixels++;
                }
                return { dataUrl: canvas.toDataURL('image/png'), colorfulPixels };
            };

            const shots = [
                {
                    name: 'portal-gallery-angled-front.png',
                    ...capture([42, 4, 108], [0, -7, 0]),
                },
                {
                    name: 'portal-gallery-angled-rear.png',
                    ...capture([-42, 4, -108], [0, -7, 0]),
                },
                {
                    name: 'portal-gallery-pair-detail.png',
                    ...capture([-14, 17, 38], [-28, 17, 0]),
                },
                {
                    name: 'portal-gallery-functional-detail.png',
                    ...capture([28, -35, 45], [2, -42, 0]),
                },
            ];

            for (const portal of arena.portals) {
                portal.visualPulseRemaining = 0;
                portal.visualPulseDestination = null;
            }
            arena.portals[2].visualPulseRemaining = 0.35;
            arena.portals[2].visualPulseDestination = 'B';
            for (const gate of arena.specialGates) gate.visualPulseRemaining = 0.35;
            portalSystem.portalRuntime.activateExitPortals();
            exitPortal.visualPulseRemaining = 0.4;
            portalSystem.update(0);
            shots.push({
                name: 'portal-gallery-active-pulse.png',
                ...capture([32, -4, 88], [0, -10, 0]),
            });

            return {
                shots,
                portalPairs: arena.portals.length,
                visualTypes: arena.portals.map((portal) => portal.meshA.userData.visualType),
                firstPairShapes: [
                    arena.portals[0].meshA.userData.visualType,
                    arena.portals[0].meshB.userData.visualType,
                ],
                firstPairIdentity: [
                    arena.portals[0].meshA.userData.pairMarkIndex,
                    arena.portals[0].meshB.userData.pairMarkIndex,
                    arena.portals[0].meshA.userData.displayColor,
                    arena.portals[0].meshB.userData.displayColor,
                ],
                pairMarks: arena.portals.map((portal) => portal.meshA.userData.pairMarkIndex),
                gateTypes: arena.specialGates.map((gate) => gate.mesh.userData.functionalType),
                exitHasCrown: !!exitPortal.mesh.userData.crown,
                exitOpeningRadius: exitPortal.mesh.userData.innerOpeningRadius,
                inactiveScale,
                activeScale: exitPortal.mesh.scale.toArray(),
                glError: game.renderer.renderer.getContext().getError(),
            };
        } finally {
            arena.checkCollision = originalCollision;
            arena.entityRuntimeConfig = originalConfig;
            game.renderer.scene.fog = originalFog;
            game.renderer.setViewportLayout(originalViewportLayout);
            for (const entry of hiddenSceneObjects) entry.object.visible = entry.visible;
            camera.position.copy(originalCameraPosition);
            camera.quaternion.copy(originalCameraQuaternion);
            camera.updateMatrixWorld(true);
        }
    }, { portalTypes: PORTAL_TYPES, pairColors: PAIR_COLORS });

    for (const shot of result.shots) {
        const screenshotPath = testInfo.outputPath(shot.name);
        await writeFile(screenshotPath, Buffer.from(shot.dataUrl.split(',')[1], 'base64'));
        await testInfo.attach(shot.name, { path: screenshotPath, contentType: 'image/png' });
        expect(shot.colorfulPixels).toBeGreaterThan(100);
    }

    expect(result.portalPairs).toBe(10);
    expect(new Set(result.visualTypes)).toEqual(new Set(PORTAL_TYPES));
    expect(result.firstPairShapes).toEqual(['portal_ring', 'portal_star']);
    expect(result.firstPairIdentity[0]).toBe(result.firstPairIdentity[1]);
    expect(result.firstPairIdentity[2]).toBe(result.firstPairIdentity[3]);
    expect(result.pairMarks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.gateTypes).toEqual(['boost', 'slingshot']);
    expect(result.exitHasCrown).toBeTruthy();
    expect(result.exitOpeningRadius).toBeCloseTo(5.18, 1);
    expect(result.inactiveScale).toEqual([1, 1, 1]);
    expect(result.activeScale).toEqual([1, 1, 1]);
    expect(result.glError).toBe(0);
    expect(errors).toEqual([]);
});
