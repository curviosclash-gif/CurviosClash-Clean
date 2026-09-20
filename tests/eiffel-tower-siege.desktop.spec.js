import { writeFileSync } from 'node:fs';

import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';
import { EIFFEL_TOWER_SIEGE_MODELS } from '../src/core/config/maps/presets/eiffel_tower_siege/EiffelTowerSiegeModels.js';

// The siege map is the first one a match can take apart, and none of what makes that work can be
// argued from the preset alone. Four questions only the running app answers:
//
//   1. The four baked collapses load with the tower and stay out of the world until they are
//      triggered -- every configured model in one slot group each, four of them invisible.
//   2. A hit on the lower lattice is traceable back to a leg. The tower exports one mesh per
//      material per part, so `legs_lower_*` is all a weapon learns; the leg itself is decided by
//      where the shot landed. Both the point query and the ray have to report that name.
//   3. The machine gun really books damage on the tower, through the same fire path a player uses.
//   4. Destroying a lower leg seals the tower, swaps the intact iron for the baked fall, turns it
//      into the direction of that leg, announces it on the HUD -- and, once the clip has run, puts
//      real collision geometry on the esplanade where there was nothing but air before.
//
// Plus the mode gate: outside the hunt the very same map is intact iron.
//
// Coordinates are authored units -- the space the preset writes -- multiplied by the map scale of
// three on the way into any runtime query. The compass follows the preset: north is +Z, east +X.

const MAP_KEY = 'eiffel_tower_siege';
const MAP_SCALE = 3;
const SIEGE_GROUND_Y = 8;
// MAP_DESTRUCTIBLE_DAMAGE.MG: what one pellet takes off a segment, independent of distance.
const MG_SEGMENT_DAMAGE = 5;
// The north-west lower leg. NE and SW carry the two inclined lifts, so a ray down this diagonal
// meets tower lattice and nothing else.
const LEG_SEGMENT_ID = 'legs_lower_nw';
const LEG_SIGN_X = -1;
const LEG_SIGN_Z = 1;
// Direction is kept in one currency: a heading is atan2(x, z), the angle of a horizontal
// direction. A destroyed leg topples towards its own corner, so the heading of the break is the
// heading of that leg's authored anchor. All four Eiffel collapses are baked falling towards
// (+1, 0, -1), whose heading is three quarters of pi, and the scene slot is turned by the
// difference between the two. Nothing below hard-codes an angle: the anchor comes out of the
// running definition and the slot's own rotation says where the wreck went.
const BAKED_FALL_HEADING = (Math.PI * 3) / 4;
// Thirteen parts of the route tower, one of them swapped for the wide esplanade, four
// collapses and the curated historic grounds. Five machines animate, and each collapse
// carries one one-shot clip.
const GLB_MODEL_COUNT = EIFFEL_TOWER_SIEGE_MODELS.length;
const GLB_TRACK_COUNT = 9;
const SEGMENT_COUNT = 10;
const BREAK_SCENE_MODELS = [
    'eiffel-topple-lower',
    'eiffel-topple-mid',
    'eiffel-topple-shaft',
    'eiffel-topple-summit',
];
const INTACT_MODELS = ['eiffel-legs-lower', 'eiffel-legs-mid', 'eiffel-shaft', 'eiffel-summit'];

/**
 * Picks the siege map in the menu and starts a match on it.
 *
 * `sessionType` matters: a single session applies the map's own scenario defaults, which put the
 * map into the hunt. The classic run therefore goes through a splitscreen session, where those
 * defaults stay out of the way and the chosen mode path survives.
 */
async function startSiegeMatch(page, { modePath, sessionType }) {
    await waitForLoadedGame(page);
    await selectSessionType(page, sessionType);
    await page.locator(`#submenu-custom:not(.hidden) [data-mode-path="${modePath}"]`).click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });

    const offered = await page.locator(`#map-select option[value="${MAP_KEY}"]`).count();
    expect(
        offered,
        `the map picker has to offer "${MAP_KEY}"; it only lists what CONFIG.MAPS holds, and that `
        + 'is assembled from the key lists in src/core/config/maps/MapPresetsBase.js',
    ).toBe(1);

    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction(
        (mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey,
        MAP_KEY,
        { timeout: 10_000 },
    );
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(
        (mapKey) => (
            window.GAME_INSTANCE?.entityManager?.players?.length > 0
            && window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
        ),
        MAP_KEY,
        { timeout: 120_000 },
    );
}

test.describe('Eiffel tower siege', () => {
    test('the tower loads shootable, takes machine-gun fire and topples onto the esplanade', async ({ page }, testInfo) => {
        // The complete configured collection, including the 1.8 MB whole-tower collapse.
        test.setTimeout(480_000);
        await startSiegeMatch(page, { modePath: 'fight', sessionType: 'single' });

        await expect.poll(() => page.evaluate((modelCount) => {
            const arena = window.GAME_INSTANCE?.arena;
            return !arena?._glbLoadError
                && (arena?._glbScene?.children?.length || 0) === modelCount;
        }, GLB_MODEL_COUNT), {
            timeout: 360_000,
            message: 'the intact tower, the wide Champ-de-Mars and the four collapses have to load',
        }).toBe(true);

        // --- 1. What loaded ---------------------------------------------------------------
        const loaded = await page.evaluate(({ sceneModels, intactModels }) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const entityManager = game.entityManager;
            const slot = (modelId) => arena._glbScene.getObjectByName(`glb-slot-${modelId}`);
            const slotState = (modelId) => {
                const group = slot(modelId);
                return { modelId, found: !!group, visible: group?.visible === true };
            };
            return {
                mapKey: String(arena.currentMapKey || ''),
                gameMode: String(game.activeGameMode || ''),
                modelCount: arena._glbScene.children.length,
                trackCount: arena._glbAnimation.trackCount,
                loadWarnings: [...arena._glbLoadWarnings],
                colliderMode: String(arena.currentMapDefinition?.glbColliderMode || ''),
                breakScenes: sceneModels.map(slotState),
                intact: intactModels.map(slotState),
                segmentIds: entityManager._mapDestructibleSystem.getState().segments.map((entry) => entry.id),
                playerCount: entityManager.players.length,
            };
        }, { sceneModels: BREAK_SCENE_MODELS, intactModels: INTACT_MODELS });

        expect(loaded.mapKey).toBe(MAP_KEY);
        expect(loaded.gameMode).toBe('HUNT');
        expect(loaded.colliderMode).toBe('scene');
        expect(loaded.loadWarnings, `GLB load warnings: ${loaded.loadWarnings.join(' | ')}`).toEqual([]);
        expect(loaded.modelCount, 'tower, wide field, collapses and curated grounds').toBe(GLB_MODEL_COUNT);
        expect(loaded.trackCount, 'five machines plus one one-shot clip per collapse').toBe(GLB_TRACK_COUNT);
        // The collapses exist in the world from the first frame and are switched off, which is
        // what keeps their colliders out of the airspace the standing tower occupies.
        expect(loaded.breakScenes).toEqual(BREAK_SCENE_MODELS.map((modelId) => ({
            modelId,
            found: true,
            visible: false,
        })));
        expect(loaded.intact).toEqual(INTACT_MODELS.map((modelId) => ({
            modelId,
            found: true,
            visible: true,
        })));
        expect(loaded.segmentIds).toHaveLength(SEGMENT_COUNT);
        expect(loaded.segmentIds).toContain(LEG_SEGMENT_ID);

        const approachViews = await page.evaluate((scale) => {
            const runtime = window.GAME_INSTANCE.renderer;
            const three = runtime.renderer;
            const camera = runtime.cameras[0];
            const originalPosition = camera.position.clone();
            const originalQuaternion = camera.quaternion.clone();
            const originalFar = camera.far;
            const originalFog = runtime.scene.fog;
            const views = {
                west: [[-145, 28, 0], [0, 42, 0]],
                east: [[145, 28, 0], [0, 42, 0]],
                north: [[0, 28, 145], [0, 42, 0]],
                south: [[0, 28, -145], [0, 42, 0]],
            };
            const captures = {};
            try {
                runtime.scene.fog = null;
                camera.far = 1_000;
                camera.updateProjectionMatrix();
                for (const [name, [position, target]] of Object.entries(views)) {
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
                camera.far = originalFar;
                camera.updateProjectionMatrix();
                runtime.scene.fog = originalFog;
            }
            return captures;
        }, MAP_SCALE);
        for (const [name, image] of Object.entries(approachViews)) {
            const outputPath = testInfo.outputPath(`eiffel-siege-historic-${name}-approach.png`);
            writeFileSync(outputPath, Buffer.from(image.split(',')[1], 'base64'));
            await testInfo.attach(`eiffel-siege-historic-${name}-approach.png`, { path: outputPath });
        }

        // --- 2 to 4, in one evaluate ------------------------------------------------------
        // The match keeps running between two evaluates, and five bots are shooting at the same
        // tower. Measuring the leg, firing at it, breaking it and stepping the fall out inside a
        // single synchronous block is what keeps the numbers below comparable to each other.
        const siege = await page.evaluate(({ mapScale, legId }) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const entityManager = game.entityManager;
            const destructibles = entityManager._mapDestructibleSystem;
            const world = (authored) => authored * mapScale;
            const DIAGONAL = Math.SQRT1_2;

            // The corner this leg stands on, straight out of the running map definition.
            const authoredLeg = (destructibles.getDefinition()?.segments || []).find(
                (entry) => entry.id === legId,
            ) || null;
            if (!authoredLeg) {
                return { failed: `the map definition has no segment "${legId}"`, rays: [] };
            }
            const anchor = { x: authoredLeg.anchor[0], y: authoredLeg.anchor[1], z: authoredLeg.anchor[2] };
            const legSignX = Math.sign(anchor.x);
            const legSignZ = Math.sign(anchor.z);
            const expectedHeading = Math.atan2(anchor.x, anchor.z);

            // Down the leg's own diagonal, from outside the tower towards its axis.
            const inward = { x: -legSignX * DIAGONAL, y: 0, z: -legSignZ * DIAGONAL };
            // Heights in authored units, chosen to leave only leg lattice in the way: the pier
            // lamps on the esplanade end at 11.6 and the decorative arches spring at 23.6.
            const rayHeights = [13, 15, 17, 19, 21];
            const rays = rayHeights.map((height) => {
                const origin = {
                    x: world(legSignX * 60),
                    y: world(height),
                    z: world(legSignZ * 60),
                };
                const result = arena.raycast(origin, inward, world(120));
                // The arena answers with one reused object, so everything is copied out here.
                return {
                    height,
                    hit: result?.hit === true,
                    sourceName: String(result?.sourceName || ''),
                    distance: Number(result?.distance) || 0,
                    point: result?.hit === true
                        ? { x: result.point.x, y: result.point.y, z: result.point.z }
                        : null,
                };
            });
            const legRay = rays.find((entry) => entry.sourceName.startsWith('legs_lower')) || null;
            if (!legRay) {
                return { failed: 'no ray down the leg diagonal reached lower-leg lattice', rays };
            }

            // The same spot as a point query, half a unit further into the iron.
            const insidePoint = {
                x: legRay.point.x + inward.x * 0.6,
                y: legRay.point.y,
                z: legRay.point.z + inward.z * 0.6,
            };
            const insideInfo = arena.getCollisionInfo(insidePoint, 0.1);
            const inside = {
                point: insidePoint,
                hit: insideInfo?.hit === true,
                sourceName: String(insideInfo?.sourceName || ''),
            };

            // Where the wreck has to end up. The clips are baked falling towards world (+X, -Z);
            // turning that direction by the scene slot's own rotation about Y is where the fall
            // actually points, whatever angle the runtime chose to store.
            const fallDirection = (slotRotationY) => {
                const cosine = Math.cos(slotRotationY);
                const sine = Math.sin(slotRotationY);
                return {
                    x: DIAGONAL * cosine + (-DIAGONAL) * sine,
                    z: -DIAGONAL * sine + (-DIAGONAL) * cosine,
                };
            };
            // A grid over the ground the tower is supposed to come down on, in authored units:
            // 24 to 72 out along the fall axis, a few units up, and a little to either side of
            // the axis so a gap in the lattice does not decide the answer. The baked collapse
            // rests its pieces at 16 (mid), 60 (summit) and 65 (shaft) units from the axis, so
            // the grid also covers the footprint of the intact lower legs: before the break those
            // legs answer here, which is why the checks below look for `piece_` names rather than
            // for an empty ground. The heights start above the pier tops and the lamp standards
            // of the esplanade (up to 12.4 units), which stay after the fall.
            const groundProbes = (direction) => {
                const hits = [];
                let probed = 0;
                for (const distance of [24, 32, 40, 48, 56, 64, 72]) {
                    for (const height of [13, 15, 18, 22, 27, 34]) {
                        for (const lateral of [0, 6, -6]) {
                            probed += 1;
                            const point = {
                                x: world(direction.x * distance - direction.z * lateral),
                                y: world(height),
                                z: world(direction.z * distance + direction.x * lateral),
                            };
                            const info = arena.getCollisionInfo(point, 0.1);
                            if (info?.hit !== true) continue;
                            hits.push({
                                distance,
                                height,
                                lateral,
                                sourceName: String(info.sourceName || ''),
                            });
                        }
                    }
                }
                return { probed, hits };
            };
            // Before the break the fall line is only a claim: the leg's own corner.
            const expectedFall = { x: legSignX * DIAGONAL, z: legSignZ * DIAGONAL };
            const groundBefore = groundProbes(expectedFall);

            // --- the machine gun --------------------------------------------------------
            const shooter = entityManager.humanPlayers?.[0] || entityManager.players[0];
            // Parked well out of the way: the human machine gun assists aim inside a twelve degree
            // cone, and a bot drifting into it would bend this shot off the leg.
            const parked = [];
            for (const other of entityManager.players) {
                if (!other || other === shooter) continue;
                other.position.set(world(70), world(40 + parked.length * 6), world(-70));
                parked.push(other.index);
            }
            shooter.alive = true;
            shooter.spawnProtectionTimer = 0;
            shooter.shootCooldown = 0;
            shooter.fightAimAssistTargetIndex = -1;
            shooter.fightAimAssistLockRemaining = 0;
            // Forty world units back along the ray: inside the weapon's range, outside its muzzle.
            const standOff = 40;
            shooter.position.set(
                legRay.point.x - inward.x * standOff,
                legRay.point.y - inward.y * standOff,
                legRay.point.z - inward.z * standOff,
            );
            shooter.setLookAtWorld(legRay.point.x, legRay.point.y, legRay.point.z);

            const readSegments = () => destructibles.getState().segments.map((entry) => ({
                id: entry.id,
                hp: entry.hp,
                maxHp: entry.maxHp,
                destroyed: entry.destroyed === true,
            }));
            const sealedBeforeShot = destructibles.getState().sealed === true;
            const beforeShot = readSegments();
            const shot = entityManager._shootHuntGun(shooter);
            const afterShot = readSegments();

            // --- the break --------------------------------------------------------------
            // Proof of the chain, not of the weapon: the leg starts with six hundred hit points
            // and firing them off five at a time would cost thousands of frames. The rest goes in
            // through the very same applyMeshHit the machine gun calls above, with the mesh name
            // and the impact point the ray measured.
            const standing = afterShot.find((entry) => entry.id === legId) || null;
            const breakDamage = standing ? standing.hp : 0;
            const damageResult = destructibles.applyMeshHit(legRay.sourceName, breakDamage, {
                hitPoint: legRay.point,
                hitDirection: inward,
                sourcePlayer: shooter,
                cause: 'MG_BULLET',
            });
            const stateAfterBreak = destructibles.getState();
            const event = stateAfterBreak.events[stateAfterBreak.events.length - 1] || null;
            const toppleSlot = arena._glbScene.getObjectByName('glb-slot-eiffel-topple-lower');
            const intactSlot = arena._glbScene.getObjectByName('glb-slot-eiffel-legs-lower');

            game.hudRuntimeSystem.updatePlayingHudTick(0.2);
            const hudElement = document.querySelector('#p1-hud .map-destructible-status');

            const clockAtBreak = Number(arena.glbAnimationElapsedSeconds) || 0;
            const fracture = toppleSlot?.getObjectByName('piece_lower_fracture_1_nocol_noshadow');
            const dust = toppleSlot?.getObjectByName('piece_lower_dust_veil_nocol_noshadow');
            const transformOf = (node) => node ? {
                position: [node.matrixWorld.elements[12], node.matrixWorld.elements[13], node.matrixWorld.elements[14]],
                scale: node.scale.toArray(),
            } : null;
            const screenPresenceOf = (node) => {
                const camera = game.renderer?.cameras?.[0];
                const canvas = document.querySelector('canvas');
                if (!node?.geometry || !camera || !canvas) return null;
                camera.updateMatrixWorld(true);
                camera.updateProjectionMatrix();
                node.geometry.computeBoundingSphere();
                const sphere = node.geometry.boundingSphere;
                const centre = sphere.center.clone().applyMatrix4(node.matrixWorld);
                const cameraPosition = camera.getWorldPosition(camera.position.clone());
                const ndc = centre.clone().project(camera);
                const matrix = node.matrixWorld.elements;
                const worldScale = Math.max(
                    Math.hypot(matrix[0], matrix[1], matrix[2]),
                    Math.hypot(matrix[4], matrix[5], matrix[6]),
                    Math.hypot(matrix[8], matrix[9], matrix[10]),
                );
                const distance = Math.max(0.001, centre.distanceTo(cameraPosition));
                const verticalFov = Number(camera.fov) * Math.PI / 180;
                const diameterPixels = sphere.radius * worldScale * canvas.height
                    / (distance * Math.tan(verticalFov / 2));
                return {
                    ndc: ndc.toArray(),
                    diameterPixels,
                    inFrame: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1,
                };
            };
            toppleSlot?.updateMatrixWorld(true);
            const fractureAtBreak = transformOf(fracture);
            const dustAtBreak = transformOf(dust);
            // The dust is deliberately delayed behind the instant metal burst. Capture its
            // expanded early phase separately before continuing to the established fracture shot.
            const stepSeconds = 1 / 60;
            for (let index = 0; index < 4 * 60; index += 1) arena.update(stepSeconds);
            toppleSlot?.updateMatrixWorld(true);
            const dustProofCamera = game.renderer?.cameras?.[0];
            if (dust && dustProofCamera) {
                dust.geometry.computeBoundingSphere();
                const sphere = dust.geometry.boundingSphere;
                const dustWorld = sphere.center.clone().applyMatrix4(dust.matrixWorld);
                const radialLength = Math.max(0.001, Math.hypot(dustWorld.x, dustWorld.z));
                dustProofCamera.position.set(
                    dustWorld.x + dustWorld.x / radialLength * world(38),
                    dustWorld.y + world(10),
                    dustWorld.z + dustWorld.z / radialLength * world(38),
                );
                dustProofCamera.lookAt(dustWorld);
                dustProofCamera.updateMatrixWorld(true);
                dustProofCamera.updateProjectionMatrix();
            }
            game.renderer.render();
            const dustEarly = transformOf(dust);
            const dustScreenPresence = screenPresenceOf(dust);
            const dustScreenshot = document.querySelector('canvas')?.toDataURL('image/png') || '';
            // Stop at a readable point during the fall: the render-only cluster must animate, but
            // a ray through its current world position must never name it as collision geometry.
            for (let index = 0; index < 20 * 60; index += 1) arena.update(stepSeconds);
            toppleSlot?.updateMatrixWorld(true);
            // The fixed-step loop above advances the map synchronously while the normal camera
            // smoothing has no rendered frames to follow. Put the game's actual perspective
            // camera at a reproducible inspection point, aimed at the animated fragment, and draw
            // that exact mid-collapse pose. This makes the attachment a visual proof rather than
            // a stale pre-collapse canvas.
            const proofCamera = game.renderer?.cameras?.[0];
            if (fracture && proofCamera) {
                fracture.geometry.computeBoundingSphere();
                const sphere = fracture.geometry.boundingSphere;
                const fractureWorld = sphere.center.clone().applyMatrix4(fracture.matrixWorld);
                const radialLength = Math.max(0.001, Math.hypot(fractureWorld.x, fractureWorld.z));
                const radialX = fractureWorld.x / radialLength;
                const radialZ = fractureWorld.z / radialLength;
                proofCamera.position.set(
                    fractureWorld.x + radialX * world(32),
                    fractureWorld.y + world(12),
                    fractureWorld.z + radialZ * world(32),
                );
                proofCamera.lookAt(fractureWorld);
                proofCamera.updateMatrixWorld(true);
                proofCamera.updateProjectionMatrix();
            }
            game.renderer.render();
            const fractureMid = transformOf(fracture);
            const fractureScreenPresence = screenPresenceOf(fracture);
            const proofCameraPosition = proofCamera?.getWorldPosition(proofCamera.position.clone()) || null;
            const fractureCentre = fracture?.geometry?.boundingSphere?.center.clone().applyMatrix4(fracture.matrixWorld) || null;
            const sightDirection = proofCameraPosition && fractureCentre
                ? fractureCentre.clone().sub(proofCameraPosition)
                : null;
            const sightDistance = sightDirection?.length() || 0;
            if (sightDirection) sightDirection.normalize();
            const fractureSightLine = sightDirection && sightDistance > 1
                ? arena.raycast(proofCameraPosition, sightDirection, sightDistance - world(2))
                : null;
            // This is the loader's authoritative list, not a ray heuristic: it contains every
            // GLB collider the map built (including hidden break scenes) while `obstacles` is the
            // active query index after the lower scene has been enabled.
            const allGlbColliderSources = (arena._glbDynamicObstacles || []).map(
                (collider) => String(collider?.sourceName || ''),
            );
            const activeColliderSources = (arena.obstacles || []).map(
                (collider) => String(collider?.sourceName || ''),
            );
            const midCollapseScreenshot = document.querySelector('canvas')?.toDataURL('image/png') || '';
            // Fifty-two seconds of map time at a fixed step: the collapse clip runs 50.13 s (the
            // tower sags onto its crushed piers, shears at the galleries, and its upper half comes
            // down in pieces), so this walks the whole fall and a moment of the wreck lying still.
            const stepCount = 28 * 60;
            for (let index = 0; index < stepCount; index += 1) arena.update(stepSeconds);
            const clockAfterFall = Number(arena.glbAnimationElapsedSeconds) || 0;
            const slotFall = fallDirection(Number(toppleSlot?.rotation?.y) || 0);
            const groundAfter = groundProbes(slotFall);

            return {
                failed: '',
                rays,
                legRay,
                inside,
                anchor,
                expectedHeading,
                expectedFall,
                slotFall,
                shooterIndex: shooter.index,
                parkedPlayers: parked,
                sealedBeforeShot,
                shot: {
                    ok: shot?.ok === true,
                    hitCount: Number(shot?.hitCount) || 0,
                    projectileCount: Number(shot?.projectileCount) || 0,
                },
                shotDeltas: beforeShot.map((entry, index) => ({
                    id: entry.id,
                    before: entry.hp,
                    after: afterShot[index].hp,
                    delta: entry.hp - afterShot[index].hp,
                })),
                breakDamage,
                breakApplied: damageResult?.applied === true,
                breakDestroyed: damageResult?.destroyed === true,
                sealed: stateAfterBreak.sealed === true,
                eventCount: stateAfterBreak.events.length,
                event: event
                    ? {
                        segmentId: event.segmentId,
                        kind: event.kind,
                        yaw: event.yaw,
                        atSeconds: event.atSeconds,
                    }
                    : null,
                toppleFound: !!toppleSlot,
                toppleVisible: toppleSlot?.visible === true,
                toppleYaw: Number(toppleSlot?.rotation?.y),
                intactVisible: intactSlot?.visible === true,
                hudText: String(hudElement?.textContent || '').trim(),
                hudHidden: hudElement?.classList.contains('hidden') !== false,
                clockAtBreak,
                clockAfterFall,
                fractureAtBreak,
                fractureMid,
                fractureScreenPresence,
                dustAtBreak,
                dustEarly,
                dustScreenPresence,
                dustScreenshot,
                fractureSightLine: fractureSightLine ? {
                    hit: fractureSightLine.hit === true,
                    sourceName: String(fractureSightLine.sourceName || ''),
                    distance: Number(fractureSightLine.distance) || 0,
                } : null,
                allGlbColliderSources,
                activeColliderSources,
                midCollapseScreenshot,
                groundBefore,
                groundAfter,
            };
        }, { mapScale: MAP_SCALE, legId: LEG_SEGMENT_ID });

        await testInfo.attach('eiffel-tower-siege-measurements.json', {
            body: Buffer.from(JSON.stringify(siege, null, 2), 'utf8'),
            contentType: 'application/json',
        });
        expect(siege.dustScreenshot, 'the early dust canvas capture is mandatory')
            .toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
        await testInfo.attach('eiffel-tower-siege-break-dust.png', {
            body: Buffer.from(siege.dustScreenshot.split(',', 2)[1], 'base64'),
            contentType: 'image/png',
        });
        writeFileSync(
            testInfo.outputPath('eiffel-tower-siege-break-dust-canvas.png'),
            Buffer.from(siege.dustScreenshot.split(',', 2)[1], 'base64'),
        );
        expect(siege.midCollapseScreenshot, 'the mid-collapse canvas capture is mandatory')
            .toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
        await testInfo.attach('eiffel-tower-siege-mid-collapse.png', {
            body: Buffer.from(siege.midCollapseScreenshot.split(',', 2)[1], 'base64'),
            contentType: 'image/png',
        });
        writeFileSync(
            testInfo.outputPath('eiffel-tower-siege-mid-collapse-canvas.png'),
            Buffer.from(siege.midCollapseScreenshot.split(',', 2)[1], 'base64'),
        );

        expect(
            siege.failed,
            `ray sweep down the north-west diagonal: ${JSON.stringify(siege.rays)}`,
        ).toBe('');

        // --- 2. A hit on the lower lattice names the lower legs ---------------------------
        expect(
            siege.legRay.sourceName,
            `ray from authored (${LEG_SIGN_X * 60}, ${siege.legRay.height}, ${LEG_SIGN_Z * 60}) `
            + `stopped after ${siege.legRay.distance.toFixed(2)} world units at `
            + `(${siege.legRay.point.x.toFixed(2)}, ${siege.legRay.point.y.toFixed(2)}, `
            + `${siege.legRay.point.z.toFixed(2)}) on "${siege.legRay.sourceName}"`,
        ).toMatch(/^legs_lower/);
        expect(siege.inside.hit, `point query at ${JSON.stringify(siege.inside.point)}`).toBe(true);
        expect(
            siege.inside.sourceName,
            `point query inside the iron reported "${siege.inside.sourceName}"`,
        ).toMatch(/^legs_lower/);

        // --- 3. The machine gun really damages the tower ----------------------------------
        expect(siege.shooterIndex, 'the first human flies the p1 HUD').toBe(0);
        expect(siege.sealedBeforeShot, 'no bot may have brought the tower down before the shot').toBe(false);
        expect(siege.shot.ok).toBe(true);
        expect(siege.shot.hitCount, 'every pellet stopped at the leg').toBeGreaterThan(0);
        const legShotDelta = siege.shotDeltas.find((entry) => entry.id === LEG_SEGMENT_ID);
        expect(
            legShotDelta,
            `segment deltas after one burst: ${JSON.stringify(siege.shotDeltas)}`,
        ).toBeTruthy();
        expect(
            legShotDelta.delta,
            `${LEG_SEGMENT_ID} went from ${legShotDelta.before} to ${legShotDelta.after} hp on `
            + `${siege.shot.hitCount} of ${siege.shot.projectileCount} pellets`,
        ).toBe(MG_SEGMENT_DAMAGE * siege.shot.hitCount);
        const strayDeltas = siege.shotDeltas.filter(
            (entry) => entry.id !== LEG_SEGMENT_ID && entry.delta !== 0,
        );
        expect(strayDeltas, 'only the leg that was aimed at may lose hit points').toEqual([]);

        // --- 4. Break, topple, and geometry on the ground ---------------------------------
        expect(siege.breakApplied).toBe(true);
        expect(siege.breakDestroyed, `${siege.breakDamage} hp were left on the leg`).toBe(true);
        expect(siege.sealed, 'a lower leg takes the whole tower with it').toBe(true);
        expect(siege.eventCount).toBe(1);
        expect(siege.event.segmentId).toBe(LEG_SEGMENT_ID);
        expect(siege.event.kind).toBe('leg_lower');
        expect(
            [Math.sign(siege.anchor.x), Math.sign(siege.anchor.z)],
            `the north-west leg stands at authored (${siege.anchor.x}, ${siege.anchor.y}, ${siege.anchor.z})`,
        ).toEqual([LEG_SIGN_X, LEG_SIGN_Z]);
        // The heading of the break is the heading of the leg's own corner.
        expect(
            siege.event.yaw,
            `break heading ${siege.event.yaw} for an anchor at `
            + `(${siege.anchor.x}, ${siege.anchor.y}, ${siege.anchor.z})`,
        ).toBeCloseTo(siege.expectedHeading, 6);
        expect(siege.toppleFound).toBe(true);
        expect(siege.toppleVisible, 'the baked fall takes over in the same frame').toBe(true);
        expect(siege.intactVisible, 'and the intact legs leave the world with it').toBe(false);
        // The slot is turned by heading minus the baked heading, so the baked direction comes out
        // of that rotation pointing into the quadrant of the leg that was shot away.
        expect(
            siege.toppleYaw,
            `collapse slot turned to ${siege.toppleYaw} for a break heading of ${siege.event.yaw} `
            + `against a baked heading of ${BAKED_FALL_HEADING}`,
        ).toBeCloseTo(
            ((siege.event.yaw - BAKED_FALL_HEADING) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2),
            6,
        );
        expect(
            [Math.sign(siege.slotFall.x), Math.sign(siege.slotFall.z)],
            `the wreck runs towards (${siege.slotFall.x.toFixed(4)}, ${siege.slotFall.z.toFixed(4)})`,
        ).toEqual([LEG_SIGN_X, LEG_SIGN_Z]);
        expect(
            siege.slotFall.x * siege.expectedFall.x + siege.slotFall.z * siege.expectedFall.z,
            'the fall line the slot produces is the diagonal of the destroyed leg',
        ).toBeCloseTo(1, 5);
        expect(siege.hudHidden).toBe(false);
        expect(siege.hudText, 'the segment that seals the tower is named for eight seconds').toBe('BEIN NW ZERSTÖRT');
        expect(siege.fractureAtBreak, 'the lower break owns a render fracture cluster').toBeTruthy();
        expect(siege.fractureMid, 'the cluster remains under the visible collapse').toBeTruthy();
        expect(siege.dustAtBreak, 'the lower break owns a render-only dust veil').toBeTruthy();
        expect(siege.dustAtBreak.scale, 'the dust waits behind the initial spark burst').toEqual([0, 0, 0]);
        expect(siege.dustEarly?.scale?.[0], 'the delayed dust veil expands after the break').toBeGreaterThan(0.5);
        expect(siege.dustScreenPresence?.inFrame,
            `the dust veil must be on screen: ${JSON.stringify(siege.dustScreenPresence)}`).toBe(true);
        expect(siege.dustScreenPresence?.diameterPixels,
            'the dust veil must read from the gameplay camera').toBeGreaterThanOrEqual(24);
        expect(siege.fractureScreenPresence?.inFrame,
            `the fracture cluster must be on screen: ${JSON.stringify(siege.fractureScreenPresence)}`).toBe(true);
        expect(siege.fractureScreenPresence?.diameterPixels,
            'the fracture cluster must be large enough to read from the gameplay camera').toBeGreaterThanOrEqual(24);
        expect(siege.fractureSightLine?.hit,
            `no physical tower mesh may hide the fracture group: ${JSON.stringify(siege.fractureSightLine)}`).toBe(false);
        expect(
            siege.fractureMid.position.some((value, index) => Math.abs(value - siege.fractureAtBreak.position[index]) > 0.01)
                || siege.fractureMid.scale.some((value, index) => Math.abs(value - siege.fractureAtBreak.scale[index]) > 0.01),
            'the visual fracture changes transform during the collapse',
        ).toBe(true);
        expect(
            siege.allGlbColliderSources.filter((name) => /fracture|dust_veil/.test(name)),
            'the loader never creates a collider for render-only break effects',
        ).toEqual([]);
        expect(
            siege.activeColliderSources.filter((name) => /fracture|dust_veil/.test(name)),
            'the active collision index cannot acquire a visual break effect',
        ).toEqual([]);

        expect(
            siege.clockAfterFall - siege.clockAtBreak,
            'fifty-two seconds of map time were stepped through arena.update',
        ).toBeCloseTo(52, 1);
        const isPiece = (entry) => entry.sourceName.toLowerCase().startsWith('piece_');
        expect(
            siege.groundBefore.hits.filter(isPiece),
            `${siege.groundBefore.probed} probes before the break reported no wreck`,
        ).toEqual([]);
        const fallenPieces = siege.groundAfter.hits.filter(isPiece);
        expect(
            fallenPieces.length,
            `${siege.groundAfter.probed} probes on the fall line reported `
            + `${JSON.stringify(siege.groundAfter.hits)}`,
        ).toBeGreaterThan(0);
    });

    test('the patrol tanks use the authored body and stay on the esplanade', async ({ page }) => {
        test.setTimeout(480_000);
        await startSiegeMatch(page, { modePath: 'fight', sessionType: 'single' });

        await expect.poll(() => page.evaluate(() => {
            const system = window.GAME_INSTANCE?.entityManager?._mapUnitSystem;
            const tanks = (system?.units || []).filter((unit) => unit.kind === 'tank');
            return {
                count: tanks.length,
                requested: system?._modelLibraryRequested === true,
                loaded: system?._modelLibrary?.parts?.size || 0,
                authored: tanks.map((unit) => unit.root?.userData?.authoredBody === true),
            };
        }), { timeout: 30_000 }).toEqual({
            count: 2,
            requested: true,
            loaded: 6,
            authored: [true, true],
        });

        await expect.poll(() => page.evaluate(() => {
            const units = window.GAME_INSTANCE?.entityManager?._mapUnitSystem?.units || [];
            return units.filter((unit) => unit.kind === 'tank').map((unit) => unit.groundPosition.y);
        }), { timeout: 10_000 }).toEqual([
            SIEGE_GROUND_Y * MAP_SCALE,
            SIEGE_GROUND_Y * MAP_SCALE,
        ]);

        const tanks = await page.evaluate(() => (
            window.GAME_INSTANCE.entityManager._mapUnitSystem.units
                .filter((unit) => unit.kind === 'tank')
                .map((unit) => ({
                    id: unit.id,
                    bodyParts: unit.root.children
                        .filter((child) => child.userData?.mapUnitPart)
                        .map((child) => child.userData.mapUnitPart)
                        .sort(),
                    headParts: unit.root.userData.headPivot.children
                        .filter((child) => child.userData?.mapUnitPart)
                        .map((child) => child.userData.mapUnitPart)
                        .sort(),
                    chaseEnabled: unit.definition.drive?.chase === true,
                    driveMode: unit.driveMode,
                    authoredBody: unit.root.userData.authoredBody === true,
                }))
        ));

        expect(tanks.map(({ id }) => id).sort()).toEqual([
            'eiffel_siege_tank_north',
            'eiffel_siege_tank_south',
        ]);
        for (const tank of tanks) {
            expect(tank.authoredBody, `${tank.id} replaced the box fallback`).toBe(true);
            expect(tank.bodyParts).toEqual(['tank_hull', 'tank_track_left', 'tank_track_right']);
            expect(tank.headParts).toEqual(['tank_barrel', 'tank_turret']);
            expect(tank.chaseEnabled, `${tank.id} received the map's chase setting`).toBe(true);
            expect(['patrol', 'chase', 'return']).toContain(tank.driveMode);
        }
    });

    test('outside the hunt the same tower is intact iron', async ({ page }) => {
        test.setTimeout(480_000);
        // A splitscreen session, because a single session would apply the map's own scenario and
        // put the match back into the hunt before it starts.
        await startSiegeMatch(page, { modePath: 'normal', sessionType: 'splitscreen' });

        const classic = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const destructibles = game.entityManager._mapDestructibleSystem;
            const state = destructibles.getState();
            return {
                mapKey: String(game.arena.currentMapKey || ''),
                gameMode: String(game.activeGameMode || ''),
                definition: destructibles.getDefinition(),
                segmentCount: state.segments.length,
                eventCount: state.events.length,
                sealed: state.sealed === true,
                hudActive: destructibles.getHudState().active === true,
            };
        });

        expect(classic.mapKey).toBe(MAP_KEY);
        expect(classic.gameMode, 'the classic mode path runs the classic game mode').toBe('CLASSIC');
        expect(classic.definition, 'nothing destructible is installed outside the hunt').toBeNull();
        expect(classic.segmentCount).toBe(0);
        expect(classic.eventCount).toBe(0);
        expect(classic.sealed).toBe(false);
        expect(classic.hudActive).toBe(false);
    });
});
