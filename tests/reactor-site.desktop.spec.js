import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';
import { REACTOR_SITE_MODELS } from '../src/core/config/maps/presets/reactor_site/ReactorSiteModels.js';
import { REACTOR_SITE_FUNGUS_MODELS, REACTOR_SITE_PROP_MODELS } from '../src/core/config/maps/presets/reactor_site/ReactorSiteProps.js';

// The reactor site is the second map a match can take apart, and the first with an event that
// rises instead of falling. Five questions only the running app answers:
//
//   1. The five baked scenes and curated infrastructure load with the plant and stay out of the
//      world until triggered - one slot group per contracted model, five invisible one-shot clips.
//   2. A hit on a cooling tower's shell is traceable back to *that* tower. Both towers are the
//      same file, so `cooling_tower_*` is all a weapon learns; the tower itself is decided by
//      where the shot landed. Both the point query and the ray have to report that name.
//   3. The machine gun really books damage on the tower, through the same fire path a player uses.
//   4. Destroying the west tower does not seal the site, swaps the intact shell for the baked
//      keel-over, turns it westwards, announces it on the HUD - and, once the clip has run, puts
//      real collision geometry on the apron west of the tower where there was nothing but air.
//   5. Breaching the reactor seals the site, hides the block, shows the cloud - whose ruin adds
//      colliders and whose cloud adds none - and refuses every later hit.
//
// Plus the mode gate: outside the hunt the very same map is intact concrete.
//
// Coordinates are authored units - the space the preset writes - multiplied by the map scale of
// three on the way into any runtime query. The compass follows the preset: north is +Z, east +X.

const MAP_KEY = 'reactor_site';
const MAP_SCALE = 3;
const BUILDING_SCALE = Math.cbrt(1.5);
// MAP_DESTRUCTIBLE_DAMAGE.MG: what one pellet takes off a segment, independent of distance.
const MG_SEGMENT_DAMAGE = 5;
const TOWER_SEGMENT_ID = 'cooling_tower_w';
const TOWER_AXIS_X = -63;   // ReactorSiteStructure.TOWER_X, authored
// Every topple is baked falling towards +X, heading pi/2; a tower keels towards its own anchor.
const BAKED_FALL_HEADING = Math.PI / 2;
// The product contract owns the count: six parts and eight scene models plus the curated static props.
// No infrastructure animates, so the only tracks are the four collapses and four selectable cloud clips.
const GLB_MODEL_COUNT = REACTOR_SITE_MODELS.length + REACTOR_SITE_PROP_MODELS.length + REACTOR_SITE_FUNGUS_MODELS.length;
const GLB_TRACK_COUNT = 8;
const SEGMENT_COUNT = 5;
const BREAK_SCENE_MODELS = [
    'reactor-topple-tower-west',
    'reactor-topple-tower-east',
    'reactor-topple-stack',
    'reactor-collapse-hall',
    'reactor-mushroom-cloud',
    'reactor-mushroom-cloud-2',
    'reactor-mushroom-cloud-3',
    'reactor-mushroom-cloud-4',
];
const INTACT_MODELS = [
    'reactor-turbine-hall',
    'reactor-block',
    'reactor-cooling-tower-west',
    'reactor-cooling-tower-east',
    'reactor-vent-stack',
];

async function startMatch(page, { modePath, sessionType }) {
    await waitForLoadedGame(page);
    await selectSessionType(page, sessionType);
    await page.locator(`#submenu-custom:not(.hidden) [data-mode-path="${modePath}"]`).click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 10_000 });
    const offered = await page.locator(`#map-select option[value="${MAP_KEY}"]`).count();
    expect(offered, `the map picker has to offer "${MAP_KEY}" (BASE_MAP_KEYS in MapPresetsBase.js)`).toBe(1);
    await page.selectOption('#map-select', MAP_KEY);
    await page.waitForFunction((mapKey) => window.GAME_INSTANCE?.settings?.mapKey === mapKey, MAP_KEY, { timeout: 10_000 });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction((mapKey) => (
        window.GAME_INSTANCE?.entityManager?.players?.length > 0
        && window.GAME_INSTANCE?.arena?.currentMapKey === mapKey
    ), MAP_KEY, { timeout: 120_000 });
}

test.describe('Reactor site', () => {
    test('water, tunnels, reactor prizes and exit survive the map lifecycle', async ({ page }, testInfo) => {
        test.setTimeout(480_000);
        await startMatch(page, { modePath: 'fight', sessionType: 'single' });
        await expect.poll(() => page.evaluate((count) => (
            !window.GAME_INSTANCE?.arena?._glbLoadError
            && window.GAME_INSTANCE?.arena?._glbScene?.children.length === count
        ), GLB_MODEL_COUNT), { timeout: 360_000 }).toBe(true);

        const evidence = await page.evaluate((scale) => {
            const game = window.GAME_INSTANCE;
            game.state = 'PAUSED';
            const arena = game.arena;
            const em = game.entityManager;
            const player = em.humanPlayers[0];
            const point = (x, y, z = 0) => player.position.clone().set(x * scale, y * scale, z * scale);
            const capture = (position, target) => {
                const camera = game.renderer.cameras[0];
                const cameraPosition = position.clone();
                camera.parent?.worldToLocal?.(cameraPosition);
                camera.position.copy(cameraPosition);
                camera.lookAt(...target.toArray());
                camera.updateMatrixWorld(true);
                game.renderer.render();
                return game.renderer.renderer.domElement.toDataURL('image/png');
            };
            const probe = (position, radius = player.hitboxRadius) => {
                const hit = arena.getCollisionInfo(position, radius);
                return { position: position.toArray(), hit: hit?.hit === true, source: hit?.sourceName || '' };
            };
            const tunnelProbes = () => [-1, 1].flatMap((sign) => {
                const route = [[sign * 63, -30.175, 0], [-sign * 63, -30.175, 0]];
                const probes = [];
                for (let segment = 0; segment < route.length - 1; segment += 1) {
                    const from = route[segment];
                    const to = route[segment + 1];
                    const length = Math.hypot(...to.map((value, axis) => value - from[axis]));
                    const steps = Math.ceil(length / 2);
                    for (let index = 0; index <= steps; index += 1) {
                        probes.push(probe(point(...from.map((value, axis) => (
                            value + ((to[axis] - value) * index) / steps
                        ))), Math.max(player.hitboxRadius, 4.64)));
                    }
                }
                return probes;
            });
            const coreMaterials = () => {
                const entries = [];
                arena._glbScene.getObjectByName('glb-slot-reactor-site').traverse((node) => {
                    if (!['reactor_fuel_core', 'reactor_fuel_rods'].includes(node.name) || !node.isMesh) return;
                    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
                        entries.push({ name: node.name, intensity: material.emissiveIntensity });
                    }
                });
                return entries;
            };
            const ownedItems = () => em.powerupManager.items.filter((item) => item.ownerId?.startsWith('map-owned:'))
                .map((item) => ({ type: item.type, ownerId: item.ownerId, position: item.mesh.position.toArray(),
                    collision: probe(item.mesh.position) }));
            const siteConcrete = () => {
                const entries = [];
                arena._glbScene.getObjectByName('glb-slot-reactor-site').traverse((node) => {
                    if (!node.isMesh || node.name.startsWith('reactor_fuel_')) return;
                    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
                        if (material.name === 'ConcreteDark') entries.push({ name: node.name,
                            intensity: material.emissiveIntensity, emissive: material.emissive.getHex() });
                    }
                });
                return entries;
            };
            const intactGlow = coreMaterials();
            const rodsUnderwater = em._waterZoneSystem.isPositionUnderwater(point(0, -48.04));
            const concreteBefore = siteConcrete();
            const prizesBefore = ownedItems();
            const routesBefore = tunnelProbes();
            const waterPicture = capture(point(0, 18, -26), point(0, -25, 0));
            const sideBasinPicture = capture(point(-63, 24, -18), point(-63, 8, 0));
            const tunnelPicture = capture(point(28, -30.175), point(0, -30.175));
            const pools = [-63, 0, 63].map((x) => {
                const submerged = point(x, 5);
                return { submerged: em._waterZoneSystem.isPositionUnderwater(submerged),
                    dryAbove: !em._waterZoneSystem.isPositionUnderwater(point(x, 10)),
                    dryOutside: !em._waterZoneSystem.isPositionUnderwater(point(x, 5, 28)),
                    free: probe(submerged) };
            });
            player.alive = true;
            player.spawnProtectionTimer = 0;
            player.position.copy(point(-63, 5));
            em._playerLifecycleSystem.updatePlayer(player, 1 / 60, {}, 0, 1000);
            const submergedPlayer = { submerged: player.waterSubmerged, speed: player.waterSpeedMultiplier,
                visibility: player.waterVisibilityMultiplier, alive: player.alive };
            player.position.copy(point(-100, 40, -100));
            em._playerLifecycleSystem.updatePlayer(player, 1 / 60, {}, 0, 1000);
            const dryPlayer = { submerged: player.waterSubmerged, speed: player.waterSpeedMultiplier };
            const damageAt = (x) => {
                player.alive = true;
                player.hp = player.maxHp;
                player.hasShield = false;
                player.shieldHP = 0;
                player.spawnProtectionTimer = 0;
                player.position.copy(point(x, -48.04));
                const before = player.hp;
                em._mapHazardSystem.updatePlayer(player, player.position, 10, 1);
                return before - player.hp;
            };
            const radiation = { near: damageAt(6), far: damageAt(11), outside: damageAt(15) };
            const exitPair = arena.portals.find((portal) => portal.secret !== true && portal.posB.z > 100 * scale);
            const travel = exitPair ? arena.checkPortal(exitPair.posA, player.hitboxRadius, 'reactor-exit-test') : null;
            const exit = { found: !!exitPair, ok: travel?.ok === true,
                target: travel?.target?.toArray(), collision: travel?.target ? probe(travel.target) : null,
                entryRadius: exitPair ? Math.hypot(exitPair.posA.x, exitPair.posA.z) / scale : null,
                warnings: arena.portalLayoutWarnings, enabled: arena.portalsEnabled,
                mode: arena.currentMapDefinition.portalMode,
                pairs: arena.portals.map((portal) => ({ secret: portal.secret, a: portal.posA.toArray(), b: portal.posB.toArray() })) };

            const destructibles = em._mapDestructibleSystem;
            const segment = destructibles.getDefinition().segments.find((entry) => entry.id === 'reactor_dome');
            destructibles.applySegmentHit('reactor_dome', segment.hp, { cause: 'MG_BULLET' });
            // The real entity tick owns prize removal; no manual mutation of item arrays.
            em.update(0, game.input);
            const prizesAfter = ownedItems();
            const collapsedGlow = coreMaterials();
            const concreteAfter = siteConcrete();
            const routesAfter = tunnelProbes();
            arena.update(50);
            const corePicture = capture(point(0, -30.175, -10), point(0, -48.04));
            const coreOpeningPicture = capture(point(0, -20, -8), point(0, -48.04));
            em.powerupManager.clear();
            em.spawnAll();
            const reset = { prizes: ownedItems(), glow: coreMaterials(),
                water: em._waterZoneSystem.isPositionUnderwater(point(63, 5)) };
            return { pools, submergedPlayer, dryPlayer, radiation, exit, prizesBefore, prizesAfter,
                routesBefore, routesAfter, intactGlow, collapsedGlow, concreteBefore, concreteAfter,
                reset, rodsUnderwater, corePicture, waterPicture, sideBasinPicture, coreOpeningPicture, tunnelPicture };
        }, MAP_SCALE);

        const screenshot = testInfo.outputPath('reactor-core-after-collapse.png');
        await writeFile(screenshot, Buffer.from(evidence.corePicture.split(',')[1], 'base64'));
        await testInfo.attach('reactor-core-after-collapse', { path: screenshot, contentType: 'image/png' });
        delete evidence.corePicture;
        for (const [name, key] of [
            ['reactor-water-basin', 'waterPicture'],
            ['reactor-side-basin-surface', 'sideBasinPicture'],
            ['reactor-core-basin-opening', 'coreOpeningPicture'],
            ['reactor-tunnel-core', 'tunnelPicture'],
        ]) {
            const picturePath = testInfo.outputPath(`${name}.png`);
            await writeFile(picturePath, Buffer.from(evidence[key].split(',')[1], 'base64'));
            await testInfo.attach(name, { path: picturePath, contentType: 'image/png' });
            delete evidence[key];
        }
        const measurements = testInfo.outputPath('reactor-water-core-lifecycle.json');
        await writeFile(measurements, JSON.stringify(evidence, null, 2));
        await testInfo.attach('reactor-water-core-lifecycle', { path: measurements, contentType: 'application/json' });
        for (const pool of evidence.pools) {
            expect(pool.submerged).toBe(true);
            expect(pool.dryAbove && pool.dryOutside).toBe(true);
            expect(pool.free.hit, JSON.stringify(pool.free)).toBe(false);
        }
        expect(evidence.submergedPlayer.submerged && evidence.submergedPlayer.alive).toBe(true);
        expect(evidence.submergedPlayer.speed).toBeLessThan(1);
        expect(evidence.submergedPlayer.visibility).toBeLessThan(1);
        expect(evidence.rodsUnderwater).toBe(true);
        expect(evidence.dryPlayer).toEqual({ submerged: false, speed: 1 });
        expect(evidence.radiation.near).toBeGreaterThan(evidence.radiation.far);
        expect(evidence.radiation.near).toBeLessThan(3);
        expect(evidence.radiation.far).toBeGreaterThan(0);
        expect(evidence.radiation.outside).toBe(0);
        expect(evidence.exit.found && evidence.exit.ok, JSON.stringify(evidence.exit)).toBe(true);
        expect(evidence.exit.entryRadius, 'the exit starts inside the containment').toBeLessThan(15.45);
        expect(evidence.exit.target[2]).toBeGreaterThan(100 * MAP_SCALE);
        expect(evidence.exit.collision.hit).toBe(false);
        for (const route of [...evidence.routesBefore, ...evidence.routesAfter]) {
            expect(route.hit, JSON.stringify(route)).toBe(false);
        }
        expect(evidence.prizesBefore.map((item) => item.type).sort()).toEqual(['BOMBER_STRIKE', 'LIGHTNING']);
        for (const item of evidence.prizesBefore) expect(item.collision.hit, JSON.stringify(item)).toBe(false);
        expect(evidence.prizesAfter).toEqual([]);
        expect(evidence.intactGlow.length).toBeGreaterThanOrEqual(2);
        expect(evidence.concreteBefore.length).toBeGreaterThan(0);
        expect(evidence.concreteAfter, 'the core glow must not change shared pool/site concrete').toEqual(evidence.concreteBefore);
        for (let index = 0; index < evidence.intactGlow.length; index += 1) {
            expect(evidence.collapsedGlow[index].intensity).toBeGreaterThan(evidence.intactGlow[index].intensity);
            expect(evidence.reset.glow[index].intensity).toBe(evidence.intactGlow[index].intensity);
        }
        expect(evidence.reset.prizes).toHaveLength(2);
        expect(evidence.reset.water).toBe(true);
    });

    test('the plant loads shootable, a tower keels over and the reactor breach sends up the cloud', async ({ page }, testInfo) => {
        test.setTimeout(480_000);
        await startMatch(page, { modePath: 'fight', sessionType: 'single' });

        await expect.poll(() => page.evaluate((modelCount) => {
            const arena = window.GAME_INSTANCE?.arena;
            return !arena?._glbLoadError && (arena?._glbScene?.children?.length || 0) === modelCount;
        }, GLB_MODEL_COUNT), { timeout: 360_000, message: 'the plant and its five scenes have to load' }).toBe(true);

        // --- 1. What loaded ---------------------------------------------------------------
        const loaded = await page.evaluate(({ sceneModels, intactModels, propModels }) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const slotState = (modelId) => {
                const group = arena._glbScene.getObjectByName(`glb-slot-${modelId}`);
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
                infrastructure: propModels.map(slotState),
                segmentIds: game.entityManager._mapDestructibleSystem.getState().segments.map((entry) => entry.id),
                itemSpawnMode: String(arena.currentMapDefinition?.itemSpawnMode || ''),
                authoredItemCount: arena.getAuthoredItemAnchors?.().length || 0,
                blastWallMeshes: (() => {
                    let count = 0;
                    arena._glbScene.getObjectByName('glb-slot-reactor-site')?.traverse?.((node) => {
                        if (String(node?.name || '') === 'site_blastwall') count += 1;
                    });
                    return count;
                })(),
                blastWallColliders: arena.obstacles.filter(
                    (entry) => String(entry?.sourceName || '') === 'site_blastwall',
                ).length,
            };
        }, {
            sceneModels: BREAK_SCENE_MODELS,
            intactModels: INTACT_MODELS,
            propModels: REACTOR_SITE_PROP_MODELS.map(({ id }) => id),
        });

        expect(loaded.mapKey).toBe(MAP_KEY);
        expect(loaded.gameMode).toBe('HUNT');
        expect(loaded.colliderMode).toBe('scene');
        expect(loaded.loadWarnings, `GLB load warnings: ${loaded.loadWarnings.join(' | ')}`).toEqual([]);
        expect(loaded.modelCount).toBe(GLB_MODEL_COUNT);
        expect(loaded.trackCount, 'one one-shot clip per scene, no machines').toBe(GLB_TRACK_COUNT);
        expect(loaded.breakScenes).toEqual(BREAK_SCENE_MODELS.map((modelId) => ({ modelId, found: true, visible: false })));
        expect(loaded.intact).toEqual(INTACT_MODELS.map((modelId) => ({ modelId, found: true, visible: true })));
        expect(loaded.infrastructure).toEqual(
            REACTOR_SITE_PROP_MODELS.map(({ id: modelId }) => ({ modelId, found: true, visible: true })),
        );
        expect(loaded.segmentIds).toHaveLength(SEGMENT_COUNT);
        expect(loaded.segmentIds).toContain(TOWER_SEGMENT_ID);
        expect(loaded.itemSpawnMode).toBe('hybrid');
        expect(loaded.authoredItemCount).toBe(12);
        expect(loaded.blastWallMeshes, 'the complex static compound is visible').toBeGreaterThan(0);
        expect(loaded.blastWallColliders, 'the irregular walls provide real cover').toBeGreaterThan(0);

        // The south service yard concentrates trays and numbered distribution boxes. Capture it
        // through the real gameplay renderer before the destructive sequence changes the scene.
        const infrastructurePicture = await page.evaluate((controlBoxId) => {
            const game = window.GAME_INSTANCE;
            game.state = 'PAUSED';
            const camera = game.renderer.cameras?.[0];
            const slot = game.arena._glbScene.getObjectByName(`glb-slot-${controlBoxId}`);
            const target = slot.position.clone();
            slot.getWorldPosition(target);
            const cameraPosition = target.clone();
            cameraPosition.y += 4.5;
            cameraPosition.z += 10;
            camera?.parent?.worldToLocal?.(cameraPosition);
            camera?.position?.copy?.(cameraPosition);
            camera?.lookAt?.(target.x, target.y + 1.2, target.z);
            camera?.updateMatrixWorld?.(true);
            game.renderer.render();
            return game.renderer.renderer.domElement.toDataURL('image/png');
        }, 'reactor-control-box-v06');
        const infrastructureScreenshot = testInfo.outputPath('reactor-site-infrastructure.png');
        await writeFile(infrastructureScreenshot, Buffer.from(infrastructurePicture.split(',')[1], 'base64'));
        await testInfo.attach('reactor-site-infrastructure.png', {
            path: infrastructureScreenshot,
            contentType: 'image/png',
        });
        await page.evaluate(() => { window.GAME_INSTANCE.state = 'PLAYING'; });

        // --- 2 to 4, in one evaluate ------------------------------------------------------
        const siege = await page.evaluate(({ mapScale, towerId, axisX, buildingScale }) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const entityManager = game.entityManager;
            const destructibles = entityManager._mapDestructibleSystem;
            const world = (authored) => authored * mapScale;

            const authoredTower = (destructibles.getDefinition()?.segments || []).find((entry) => entry.id === towerId) || null;
            if (!authoredTower) return { failed: `the map definition has no segment "${towerId}"`, rays: [] };
            const anchor = { x: authoredTower.anchor[0], y: authoredTower.anchor[1], z: authoredTower.anchor[2] };
            const expectedHeading = Math.atan2(anchor.x, anchor.z);

            // From well west of the west tower, straight east into its shell. The shell is 31 to
            // 38 m in radius at these heights, well outside the site's fittings. The line runs a
            // few units beside the tower's own axis on purpose: the shell is drawn in sectors
            // whose seam lies exactly in the plane z = 0, and a ray in that plane can fall into
            // the crack between the two triangles that meet there. That is the one line no
            // player ever fires along; the machine gun below fires along this one.
            const inward = { x: 1, y: 0, z: 0 };
            const beside = world(4);
            const rayHeights = [24, 28, 32, 36];
            const rays = rayHeights.map((height) => {
                const origin = { x: world(axisX - 60), y: world(height), z: beside };
                const result = arena.raycast(origin, inward, world(120));
                return {
                    height,
                    hit: result?.hit === true,
                    sourceName: String(result?.sourceName || ''),
                    distance: Number(result?.distance) || 0,
                    point: result?.hit === true ? { x: result.point.x, y: result.point.y, z: result.point.z } : null,
                };
            });
            const towerRay = rays.find((entry) => entry.sourceName.startsWith('cooling_tower')) || null;
            if (!towerRay) return { failed: 'no ray into the west tower reached its shell', rays };

            const insidePoint = { x: towerRay.point.x + 0.6, y: towerRay.point.y, z: towerRay.point.z };
            const insideInfo = arena.getCollisionInfo(insidePoint, 0.1);
            const inside = { point: insidePoint, hit: insideInfo?.hit === true, sourceName: String(insideInfo?.sourceName || '') };

            // Probes along the fall line west of the tower: 47 to 113 m out from the axis - past
            // the 42 m base of the standing shell - 10 to 63 m up, a little to either side.
            // Before the break nothing stands there; after it the shell lies there on its side,
            // sixty metres tall.
            const fallDirection = (slotRotationY) => ({ x: Math.cos(slotRotationY), z: -Math.sin(slotRotationY) });
            const groundProbes = (direction) => {
                const hits = [];
                let probed = 0;
                for (const distance of [34, 42, 50, 58, 66, 74]) {
                    for (const height of [14, 18, 24, 30, 38, 46]) {
                        for (const lateral of [0, 8, -8]) {
                            probed += 1;
                            const point = {
                                x: world(axisX + direction.x * distance - direction.z * lateral),
                                y: world(height),
                                z: world(direction.z * distance + direction.x * lateral),
                            };
                            const info = arena.getCollisionInfo(point, 0.1);
                            if (info?.hit !== true) continue;
                            hits.push({ distance, height, lateral, sourceName: String(info.sourceName || '') });
                        }
                    }
                }
                return { probed, hits };
            };
            const expectedFall = { x: -1, z: 0 };
            const groundBefore = groundProbes(expectedFall);

            // --- the machine gun --------------------------------------------------------
            const shooter = entityManager.humanPlayers?.[0] || entityManager.players[0];
            const parked = [];
            for (const other of entityManager.players) {
                if (!other || other === shooter) continue;
                other.position.set(world(100), world(60 + parked.length * 6), world(120));
                parked.push(other.index);
            }
            shooter.alive = true;
            shooter.spawnProtectionTimer = 0;
            shooter.shootCooldown = 0;
            shooter.fightAimAssistTargetIndex = -1;
            shooter.fightAimAssistLockRemaining = 0;
            const standOff = 40;
            shooter.position.set(towerRay.point.x - inward.x * standOff, towerRay.point.y, towerRay.point.z);
            shooter.setLookAtWorld(towerRay.point.x, towerRay.point.y, towerRay.point.z);

            const readSegments = () => destructibles.getState().segments.map((entry) => ({
                id: entry.id, hp: entry.hp, maxHp: entry.maxHp, destroyed: entry.destroyed === true,
            }));
            const sealedBeforeShot = destructibles.getState().sealed === true;
            const beforeShot = readSegments();
            // The shot the gun would take, measured before it is taken: where the muzzle is, where
            // it aims, and what the arena answers along that line. Kept in the measurements so a
            // burst that books nothing can be read rather than guessed at.
            const aim = shooter.getAimDirection(shooter.position.clone()).normalize();
            const muzzle = shooter.position.clone().addScaledVector(aim, 2.1);
            const describeRay = (result) => ({
                hit: result?.hit === true,
                sourceName: String(result?.sourceName || ''),
                distance: Number(result?.distance) || 0,
            });
            const aimed = {
                position: { x: shooter.position.x, y: shooter.position.y, z: shooter.position.z },
                aim: { x: aim.x, y: aim.y, z: aim.z },
                muzzle: describeRay(arena.raycast(muzzle, aim, 95)),
                muzzleLong: describeRay(arena.raycast(muzzle, aim, 360)),
                obstacleCount: arena.obstacles.length,
            };
            const shot = entityManager._shootHuntGun(shooter);
            const afterShot = readSegments();

            // --- the tower ------------------------------------------------------------
            const standing = afterShot.find((entry) => entry.id === towerId) || null;
            const breakDamage = standing ? standing.hp : 0;
            const damageResult = destructibles.applyMeshHit(towerRay.sourceName, breakDamage, {
                hitPoint: towerRay.point, hitDirection: inward, sourcePlayer: shooter, cause: 'MG_BULLET',
            });
            // The state object is live and the reactor breach below mutates it, so what has to
            // be reported about this moment is copied out now.
            const stateAfterBreak = destructibles.getState();
            const sealedAfterTower = stateAfterBreak.sealed === true;
            const event = stateAfterBreak.events[stateAfterBreak.events.length - 1] || null;
            const toppleSlot = arena._glbScene.getObjectByName('glb-slot-reactor-topple-tower-west');
            const intactSlot = arena._glbScene.getObjectByName('glb-slot-reactor-cooling-tower-west');
            const eastSlot = arena._glbScene.getObjectByName('glb-slot-reactor-cooling-tower-east');
            game.hudRuntimeSystem.updatePlayingHudTick(0.2);
            const hudElement = document.querySelector('#p1-hud .map-destructible-status');
            const hudAfterTower = String(hudElement?.textContent || '').trim();

            // The enlarged tower's baked keel-over runs 26.13 seconds.
            const clockAtBreak = Number(arena.glbAnimationElapsedSeconds) || 0;
            const stepSeconds = 1 / 60;
            for (let index = 0; index < 28 * 60; index += 1) arena.update(stepSeconds);
            const clockAfterFall = Number(arena.glbAnimationElapsedSeconds) || 0;
            const slotFall = fallDirection(Number(toppleSlot?.rotation?.y) || 0);
            const groundAfter = groundProbes(slotFall);

            // --- the reactor ----------------------------------------------------------
            const colliderCount = (prefix) => arena.obstacles.filter(
                (entry) => String(entry?.sourceName || '').toLowerCase().startsWith(prefix),
            ).length;
            const blockCollidersBefore = colliderCount('reactor_block');
            const ruinCollidersBefore = colliderCount('piece_reactor');
            const domeOrigin = { x: world(30), y: world(8 + 33 * buildingScale * 0.6), z: world(2) };
            const domeInfo = arena.raycast(domeOrigin, { x: -1, y: 0, z: 0 }, world(20));
            const domePoint = domeInfo?.point || domeOrigin;
            const domeName = String(domeInfo?.sourceName || '');
            const reactor = (destructibles.getDefinition()?.segments || []).find((entry) => entry.id === 'reactor_dome');
            const breach = destructibles.applyMeshHit(domeName, reactor ? reactor.hp : 0, {
                hitPoint: domePoint, hitDirection: { x: 0, y: -1, z: 0 }, sourcePlayer: shooter, cause: 'MG_BULLET',
            });
            const stateAfterBreach = destructibles.getState();
            const cloudSlot = arena._glbScene.children.find((node) => node.visible
                && String(node.userData.glbModelId).startsWith('reactor-mushroom-cloud'));
            const blockSlot = arena._glbScene.getObjectByName('glb-slot-reactor-block');
            game.hudRuntimeSystem.updatePlayingHudTick(0.2);
            const hudAfterBreach = String(hudElement?.textContent || '').trim();
            // Ten seconds in: the cap is far up, and a probe inside it must find nothing at all,
            // while the ruin's wall answers with a collider of its own.
            for (let index = 0; index < 10 * 60; index += 1) arena.update(stepSeconds);
            const capProbe = arena.getCollisionInfo({ x: 0, y: world(8 + 130 * 0.6), z: 0 }, 0.1);
            // The middle of the first wall sector of the ruin, 23.4 m out at six metres up.
            const wallAngle = Math.PI / 2 + Math.PI / 28;
            const ruinProbe = arena.getCollisionInfo({
                x: world(23.4 * buildingScale * 0.6 * Math.cos(wallAngle)),
                y: world(8 + 6 * 0.6),
                z: -world(23.4 * buildingScale * 0.6 * Math.sin(wallAngle)),
            }, 2.0);
            const refused = destructibles.applyMeshHit('cooling_tower_concrete', 50, {
                hitPoint: { x: world(63 + 21), y: world(26), z: 0 }, hitDirection: { x: -1, y: 0, z: 0 },
            });
            const cloudColliders = arena.obstacles.filter((entry) => /cloud|fire|dust/.test(String(entry?.sourceName || '').toLowerCase())).length;

            // Freeze a genuine exterior overview for the attached visual proof. The gameplay
            // camera used to remain in the west tower's fall line and photographed the wreck
            // from inside, which could not prove either the cloud or the wider facility.
            game.state = 'PAUSED';
            const overviewCamera = game.renderer.cameras?.[0];
            overviewCamera?.position?.set?.(0, 300, -430);
            overviewCamera?.lookAt?.(0, 70, 0);
            overviewCamera?.updateMatrixWorld?.(true);
            game.renderer.render();

            return {
                failed: '',
                rays,
                towerRay,
                inside,
                anchor,
                expectedHeading,
                slotFall,
                shooterIndex: shooter.index,
                sealedBeforeShot,
                aimed,
                shot: {
                    ok: shot?.ok === true,
                    code: String(shot?.code || ''),
                    message: String(shot?.message || ''),
                    hitCount: Number(shot?.hitCount) || 0,
                    projectileCount: Number(shot?.projectileCount) || 0,
                },
                shotDeltas: beforeShot.map((entry, index) => ({ id: entry.id, before: entry.hp, after: afterShot[index].hp, delta: entry.hp - afterShot[index].hp })),
                breakDamage,
                breakApplied: damageResult?.applied === true,
                breakDestroyed: damageResult?.destroyed === true,
                sealedAfterTower,
                event: event ? { segmentId: event.segmentId, kind: event.kind, yaw: event.yaw, atSeconds: event.atSeconds } : null,
                toppleVisible: toppleSlot?.visible === true,
                toppleYaw: Number(toppleSlot?.rotation?.y),
                intactVisible: intactSlot?.visible === true,
                eastVisible: eastSlot?.visible === true,
                hudAfterTower,
                clockAtBreak,
                clockAfterFall,
                groundBefore,
                groundAfter,
                domeName,
                breachApplied: breach?.applied === true,
                breachDestroyed: breach?.destroyed === true,
                sealedAfterBreach: stateAfterBreach.sealed === true,
                eventCount: stateAfterBreach.events.length,
                cloudVisible: cloudSlot?.visible === true,
                cloudYaw: Number(cloudSlot?.rotation?.y),
                blockVisible: blockSlot?.visible === true,
                hudAfterBreach,
                blockCollidersBefore,
                blockCollidersAfter: colliderCount('reactor_block'),
                ruinCollidersBefore,
                ruinCollidersAfter: colliderCount('piece_reactor'),
                cloudColliders,
                capProbeHit: capProbe?.hit === true,
                ruinProbe: { hit: ruinProbe?.hit === true, sourceName: String(ruinProbe?.sourceName || '') },
                refused: refused === null,
            };
        }, { mapScale: MAP_SCALE, towerId: TOWER_SEGMENT_ID, axisX: TOWER_AXIS_X, buildingScale: BUILDING_SCALE });

        const measurements = testInfo.outputPath('reactor-site-measurements.json');
        await writeFile(measurements, JSON.stringify(siege, null, 2), 'utf8');
        await testInfo.attach('reactor-site-measurements.json', { path: measurements, contentType: 'application/json' });
        const screenshot = testInfo.outputPath('reactor-site-after-breach.png');
        await page.screenshot({ path: screenshot });
        await testInfo.attach('reactor-site-after-breach.png', { path: screenshot, contentType: 'image/png' });

        expect(siege.failed, `ray sweep into the west tower: ${JSON.stringify(siege.rays)}`).toBe('');

        // --- 2. A hit on the shell names the cooling tower ---------------------------------
        expect(siege.towerRay.sourceName, `ray stopped after ${siege.towerRay.distance.toFixed(2)} on "${siege.towerRay.sourceName}"`).toMatch(/^cooling_tower/);
        expect(siege.inside.hit, `point query at ${JSON.stringify(siege.inside.point)}`).toBe(true);
        expect(siege.inside.sourceName).toMatch(/^cooling_tower/);

        // --- 3. The machine gun really damages the tower ----------------------------------
        expect(siege.shooterIndex, 'the first human flies the p1 HUD').toBe(0);
        expect(siege.sealedBeforeShot).toBe(false);
        expect(siege.shot.ok, `${siege.shot.code} ${siege.shot.message}`).toBe(true);
        expect(
            siege.shot.hitCount,
            `every pellet stopped at the shell; the muzzle line from ${JSON.stringify(siege.aimed)}`,
        ).toBeGreaterThan(0);
        const towerDelta = siege.shotDeltas.find((entry) => entry.id === TOWER_SEGMENT_ID);
        expect(towerDelta, `segment deltas: ${JSON.stringify(siege.shotDeltas)}`).toBeTruthy();
        expect(towerDelta.delta, `${TOWER_SEGMENT_ID} lost ${towerDelta.delta} hp on ${siege.shot.hitCount} pellets`).toBe(MG_SEGMENT_DAMAGE * siege.shot.hitCount);
        expect(siege.shotDeltas.filter((entry) => entry.id !== TOWER_SEGMENT_ID && entry.delta !== 0), 'only the west tower may lose hit points').toEqual([]);

        // --- 4. The tower keels over westwards, and does not seal the site ------------------
        expect(siege.breakApplied).toBe(true);
        expect(siege.breakDestroyed, `${siege.breakDamage} hp were left`).toBe(true);
        expect(siege.sealedAfterTower, 'a cooling tower does not seal the site').toBe(false);
        expect(siege.event.segmentId).toBe(TOWER_SEGMENT_ID);
        expect(siege.event.kind).toBe('leg_mid');
        expect(siege.event.yaw, 'the break heading is the heading of the tower anchor').toBeCloseTo(siege.expectedHeading, 6);
        expect(siege.toppleVisible, 'the baked keel-over takes over in the same frame').toBe(true);
        expect(siege.intactVisible, 'and the intact west tower leaves the world').toBe(false);
        expect(siege.eastVisible, 'the east tower stays').toBe(true);
        expect(siege.toppleYaw).toBeCloseTo(
            ((siege.event.yaw - BAKED_FALL_HEADING) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), 6,
        );
        expect(siege.slotFall.x, `the wreck runs towards (${siege.slotFall.x.toFixed(3)}, ${siege.slotFall.z.toFixed(3)})`).toBeCloseTo(-1, 5);
        expect(siege.hudAfterTower, 'a break that does not seal names its structure').toBe('KÜHLTURM WEST BRICHT');
        expect(siege.clockAfterFall - siege.clockAtBreak).toBeCloseTo(28, 1);
        const isPiece = (entry) => entry.sourceName.toLowerCase().startsWith('piece_tower_w');
        expect(siege.groundBefore.hits.filter(isPiece), `${siege.groundBefore.probed} probes before the break reported no wreck`).toEqual([]);
        expect(siege.groundBefore.hits, 'west of the tower there is only air before the break').toEqual([]);
        expect(siege.groundBefore.probed).toBe(6 * 6 * 3);
        expect(siege.groundAfter.hits.filter(isPiece).length, `${siege.groundAfter.probed} probes on the fall line reported ${JSON.stringify(siege.groundAfter.hits)}`).toBeGreaterThan(0);

        // --- 5. The reactor breach ends it ------------------------------------------------
        expect(siege.domeName, 'the point query on the containment names the block').toMatch(/^reactor_block/);
        expect(siege.breachApplied).toBe(true);
        expect(siege.breachDestroyed).toBe(true);
        expect(siege.sealedAfterBreach, 'the reactor seals the site').toBe(true);
        expect(siege.eventCount).toBe(2);
        expect(siege.cloudVisible, 'the cloud appears').toBe(true);
        expect(siege.cloudYaw, 'a cloud is never turned').toBeCloseTo(0, 6);
        expect(siege.blockVisible, 'the intact block leaves the world').toBe(false);
        expect(siege.hudAfterBreach).toBe('REAKTOR ZERSTÖRT');
        expect(siege.blockCollidersBefore).toBeGreaterThan(0);
        expect(siege.blockCollidersAfter, 'the block\'s colliders go with it').toBe(0);
        expect(siege.ruinCollidersBefore, 'the ruin collides only once it is there').toBe(0);
        expect(siege.ruinCollidersAfter, 'the ruin brings its own colliders').toBeGreaterThan(0);
        expect(siege.cloudColliders, 'nothing in the cloud collides').toBe(0);
        expect(siege.capProbeHit, 'a ship inside the cap flies through smoke').toBe(false);
        expect(siege.ruinProbe.sourceName, `the ruin's wall answered "${siege.ruinProbe.sourceName}"`).toMatch(/^piece_reactor_ruin/);
        expect(siege.refused, 'after the breach no hit books anywhere').toBe(true);
    });

    test('the east tower, stack and turbine hall each run their own collapse scene', async ({ page }, testInfo) => {
        test.setTimeout(480_000);
        await startMatch(page, { modePath: 'fight', sessionType: 'single' });

        await expect.poll(() => page.evaluate((modelCount) => {
            const arena = window.GAME_INSTANCE?.arena;
            return !arena?._glbLoadError && (arena?._glbScene?.children?.length || 0) === modelCount;
        }, GLB_MODEL_COUNT), { timeout: 360_000, message: 'the complete reactor pack has to load' }).toBe(true);

        const collapses = await page.evaluate((mapScale) => {
            const game = window.GAME_INSTANCE;
            const arena = game.arena;
            const system = game.entityManager._mapDestructibleSystem;
            const definition = system.getDefinition();
            const colliderCount = (prefix) => arena.obstacles.filter(
                (entry) => String(entry?.sourceName || '').toLowerCase().startsWith(prefix),
            ).length;
            const steps = [
                {
                    segmentId: 'cooling_tower_e', meshName: 'cooling_tower_concrete',
                    intactId: 'reactor-cooling-tower-east', sceneId: 'reactor-topple-tower-east',
                    piecePrefix: 'piece_tower_e', seconds: 28,
                },
                {
                    segmentId: 'vent_stack', meshName: 'vent_stack_concrete',
                    intactId: 'reactor-vent-stack', sceneId: 'reactor-topple-stack',
                    piecePrefix: 'piece_stack', seconds: 15,
                },
                {
                    segmentId: 'turbine_hall', meshName: 'turbine_hall_concrete',
                    intactId: 'reactor-turbine-hall', sceneId: 'reactor-collapse-hall',
                    piecePrefix: 'piece_hall', seconds: 11,
                },
            ];
            const results = [];
            for (const step of steps) {
                const segment = definition.segments.find((entry) => entry.id === step.segmentId);
                const intact = arena._glbScene.getObjectByName(`glb-slot-${step.intactId}`);
                const scene = arena._glbScene.getObjectByName(`glb-slot-${step.sceneId}`);
                const intactCollidersBefore = colliderCount(step.meshName.replace('_concrete', ''));
                const result = system.applyMeshHit(step.meshName, segment.hp, {
                    hitPoint: {
                        x: segment.anchor[0] * mapScale,
                        y: segment.anchor[1] * mapScale,
                        z: segment.anchor[2] * mapScale,
                    },
                    hitDirection: { x: 1, y: 0, z: -0.25 },
                    cause: 'MG_BULLET',
                });
                const visibleAtBreak = scene?.visible === true;
                const intactVisibleAtBreak = intact?.visible === true;
                for (let frame = 0; frame < step.seconds * 60; frame += 1) arena.update(1 / 60);
                results.push({
                    segmentId: step.segmentId,
                    applied: result?.applied === true,
                    destroyed: result?.destroyed === true,
                    sealed: system.getState().sealed === true,
                    visibleAtBreak,
                    visibleAfterRest: scene?.visible === true,
                    intactVisibleAtBreak,
                    intactVisibleAfterRest: intact?.visible === true,
                    intactCollidersBefore,
                    intactCollidersAfter: colliderCount(step.meshName.replace('_concrete', '')),
                    pieceCollidersAfter: colliderCount(step.piecePrefix),
                });
            }

            game.state = 'PAUSED';
            const overviewCamera = game.renderer.cameras?.[0];
            overviewCamera?.position?.set?.(0, 300, -430);
            overviewCamera?.lookAt?.(0, 70, 0);
            overviewCamera?.updateMatrixWorld?.(true);
            game.renderer.render();
            return {
                events: system.getState().events.map((entry) => entry.segmentId),
                results,
            };
        }, MAP_SCALE);

        const measurements = testInfo.outputPath('reactor-site-secondary-collapses.json');
        await writeFile(measurements, JSON.stringify(collapses, null, 2), 'utf8');
        await testInfo.attach('reactor-site-secondary-collapses.json', { path: measurements, contentType: 'application/json' });
        const screenshot = testInfo.outputPath('reactor-site-secondary-collapses.png');
        await page.screenshot({ path: screenshot });
        await testInfo.attach('reactor-site-secondary-collapses.png', { path: screenshot, contentType: 'image/png' });

        expect(collapses.events).toEqual(['cooling_tower_e', 'vent_stack', 'turbine_hall']);
        for (const result of collapses.results) {
            expect(result.applied, `${result.segmentId} accepts its break`).toBe(true);
            expect(result.destroyed, `${result.segmentId} reaches zero hp`).toBe(true);
            expect(result.sealed, `${result.segmentId} must not seal the reactor site`).toBe(false);
            expect(result.visibleAtBreak, `${result.segmentId} scene appears immediately`).toBe(true);
            expect(result.visibleAfterRest, `${result.segmentId} scene remains at rest`).toBe(true);
            expect(result.intactVisibleAtBreak, `${result.segmentId} intact model leaves immediately`).toBe(false);
            expect(result.intactVisibleAfterRest, `${result.segmentId} intact model stays hidden`).toBe(false);
            expect(result.intactCollidersBefore, `${result.segmentId} starts collidable`).toBeGreaterThan(0);
            expect(result.intactCollidersAfter, `${result.segmentId} drops its own intact colliders`)
                .toBeLessThan(result.intactCollidersBefore);
            expect(result.pieceCollidersAfter, `${result.segmentId} wreck remains collidable`).toBeGreaterThan(0);
        }
    });

    test('outside the hunt the same plant is intact concrete', async ({ page }) => {
        test.setTimeout(480_000);
        await startMatch(page, { modePath: 'normal', sessionType: 'splitscreen' });
        const classic = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const destructibles = game.entityManager._mapDestructibleSystem;
            const state = destructibles.getState();
            return {
                mapKey: String(game.arena.currentMapKey || ''),
                gameMode: String(game.activeGameMode || ''),
                definition: destructibles.getDefinition(),
                segmentCount: state.segments.length,
                hudActive: destructibles.getHudState().active === true,
            };
        });
        expect(classic.mapKey).toBe(MAP_KEY);
        expect(classic.gameMode).toBe('CLASSIC');
        expect(classic.definition).toBeNull();
        expect(classic.segmentCount).toBe(0);
        expect(classic.hudActive).toBe(false);
    });
});
