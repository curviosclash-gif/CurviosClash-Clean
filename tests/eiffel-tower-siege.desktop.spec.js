import { expect, test } from './helpers.desktop.js';
import { selectSessionType, waitForLoadedGame } from './helpers.js';

// The siege map is the first one a match can take apart, and none of what makes that work can be
// argued from the preset alone. Four questions only the running app answers:
//
//   1. The four baked collapses load with the tower and stay out of the world until they are
//      triggered -- seventeen models in one slot group each, four of them invisible.
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
// Thirteen parts of the route tower, one of them swapped for the wide esplanade, plus four
// collapses. Five machines animate, and each collapse carries one one-shot clip.
const GLB_MODEL_COUNT = 17;
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
        // Seventeen GLBs, one of them the 1.8 MB collapse of the whole tower.
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
        expect(loaded.modelCount, 'thirteen tower parts with the wide field, plus four collapses').toBe(GLB_MODEL_COUNT);
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
            // Fifty-two seconds of map time at a fixed step: the collapse clip runs 50.13 s (the
            // tower sags onto its crushed piers, shears at the galleries, and its upper half comes
            // down in pieces), so this walks the whole fall and a moment of the wreck lying still.
            const stepSeconds = 1 / 60;
            const stepCount = 52 * 60;
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
                groundBefore,
                groundAfter,
            };
        }, { mapScale: MAP_SCALE, legId: LEG_SEGMENT_ID });

        await testInfo.attach('eiffel-tower-siege-measurements.json', {
            body: Buffer.from(JSON.stringify(siege, null, 2), 'utf8'),
            contentType: 'application/json',
        });

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
        expect(siege.hudText, 'the sealed tower is announced for eight seconds').toBe('TURM STÜRZT');

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
