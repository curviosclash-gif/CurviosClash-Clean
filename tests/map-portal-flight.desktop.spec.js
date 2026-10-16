import { expect, test } from './helpers.desktop.js';
import { waitForLoadedGame } from './helpers.js';
import { startMatch } from '../scripts/playtest/playtest-driver.mjs';
import { configurePilot, readEvents, step, stopPilot } from '../scripts/playtest/playtest-control.mjs';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { isArcadeSelectableVehicleId } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';

const CASES = [
    ['eclipse_foundry', [0, 1, 2, 3]], ['kinetic_tide', [0, 1, 2, 3]],
    ['notre_dame', [1, 2, 3]], ['notre_dame_fire', [1, 2, 3]],
];
const VEHICLE = 'ship5';

for (const [mapKey, pairs] of CASES) {
    test(`${mapKey} flies every affected portal in both directions with 3D aim`, async ({ page }, testInfo) => {
        test.setTimeout(720_000);
        expect(isArcadeSelectableVehicleId(VEHICLE)).toBe(true);
        await waitForLoadedGame(page);
        const session = { page };
        const flights = [];
        try {
            for (const pair of pairs) for (const end of ['a', 'b']) {
                const started = await startMatch(session, {
                    map: mapKey, mode: 'ARCADE', vehicle: VEHICLE, paused: true,
                    arcade: { enabled: true, runType: 'gauntlet', journeyStageId: '', dailyChallenge: false },
                });
                expect(started.ok).toBe(true);
                expect(started.mapKey).toBe(mapKey);
                expect(started.gameMode).toBe('ARCADE');
                expect(started.humanVehicle).toBe(VEHICLE);
                const index = pairs.indexOf(pair) * 2 + (end === 'b' ? 1 : 0);
                const yaw = 0.37 + index * Math.PI * (3 - Math.sqrt(5));
                const pitch = (index % 2 ? -1 : 1) * (0.25 + 0.08 * index);
                const aim = [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)];
                expect(aim.every(component => Math.abs(component) > 0.0001)).toBe(true);
                const initial = await page.evaluate(({ pair, end, aim, index }) => {
                    const game = window.GAME_INSTANCE, arena = game.arena;
                    const player = game.entityManager.humanPlayers[0], portal = arena.portals[pair];
                    const entry = portal[end === 'a' ? 'posA' : 'posB'];
                    const exit = portal[end === 'a' ? 'posB' : 'posA'];
                    const direction = player.position.clone().set(...aim).normalize();
                    // Vary only the initial obstacle phase through the public map-clock seam;
                    // from here on the real GameLoop advances every animation and collider.
                    arena.setGlbAnimationElapsedSeconds(index * 0.45);
                    // One initial placement per freshly created match. Remove spawn immunity so
                    // wall and damage checks are active from the very first real flight tick.
                    player.position.copy(entry).addScaledVector(direction, -12);
                    player.trail.clear();
                    player.spawnProtectionTimer = 0;
                    player.arenaCollisionGraceTimer = 0;
                    player.setLookAtWorld(...entry.toArray());
                    player.markRenderDiscontinuity('spawn');
                    return {
                        entry: entry.toArray(), exit: exit.toArray(), position: player.position.toArray(),
                        quaternion: player.quaternion.toArray(), hp: player.hp, shield: player.shieldHP,
                        collision: arena.checkCollisionFast(player.position, player.hitboxRadius),
                        signal: arena.getTraversalSignalForEntity(player.index),
                        pairCooldown: portal.cooldowns.get(player.index) || 0,
                        assets: arena.getMapAssetLoadState(), planar: game.runtimeConfig.gameplay.planarMode,
                        oriented: Boolean(portal.forwardA || portal.forwardB),
                        animationSeconds: arena.glbAnimationElapsedSeconds, ghost: player.isGhost,
                    };
                }, { pair, end, aim, index });
                expect(initial.assets.error).toBeNull();
                expect(initial.assets.warnings).toEqual([]);
                expect(initial.assets.modelCount).toBe(MAP_PRESET_CATALOG[mapKey].glbModels.length);
                expect(initial.collision).toBe(false);
                expect(initial.planar).toBe(false);
                expect(initial.ghost).toBe(false);
                expect(initial.pairCooldown).toBe(0);
                expect(initial.oriented).toBe(false); // Current authored portals preserve 3D orientation.
                await configurePilot(session, { mode: 'maneuver', input: { turn: 0, climb: 0, roll: 0 }, frames: 1000 });
                const samples = [];
                let traveled = false;
                for (let tick = 0; tick < 120; tick += 1) {
                    expect((await step(session, 1000 / 60)).completed).toBe(true);
                    const sample = await page.evaluate((pair) => {
                        const game = window.GAME_INSTANCE, player = game.entityManager.humanPlayers[0];
                        return { position: player.position.toArray(), quaternion: player.quaternion.toArray(),
                            state: game.state, hp: player.hp, shield: player.shieldHP, alive: player.alive,
                            protection: player.spawnProtectionTimer, grace: player.arenaCollisionGraceTimer,
                            wallCooldown: player.wallDamageCooldown, crashCooldown: player.crashDamageCooldown,
                            signal: game.arena.getTraversalSignalForEntity(player.index),
                            pairCooldown: game.arena.portals[pair].cooldowns.get(player.index) || 0,
                            animationSeconds: game.arena.glbAnimationElapsedSeconds };
                    }, pair);
                    samples.push(sample);
                    traveled ||= sample.signal.lastPortalTravelAtMs !== initial.signal.lastPortalTravelAtMs;
                    if (traveled && Math.hypot(...sample.position.map((value, axis) => value - initial.exit[axis])) >= 8) break;
                    if (!sample.alive || sample.state !== 'PLAYING' || sample.grace > 0 || sample.hp < initial.hp) break;
                }
                const events = await readEvents(session, 0);
                const record = { mapKey, pair, end, vehicle: VEHICLE, aim, initial, traveled, samples,
                    deaths: events.events.filter(event => event.type === 'death' && event.isHuman) };
                flights.push(record);
                console.log('PORTAL_RUNTIME_FLIGHT', JSON.stringify({ mapKey, pair, end, aim, traveled,
                    ticks: samples.length, last: samples.at(-1), deaths: record.deaths }));
                expect(traveled, `${pair}.${end} must traverse in the real simulation`).toBe(true);
                expect(record.deaths).toEqual([]);
                expect(samples.every(sample => sample.alive && sample.state === 'PLAYING' && sample.hp === initial.hp
                    && sample.shield === initial.shield && sample.protection === 0 && sample.grace === 0
                    && sample.wallCooldown === 0 && sample.crashCooldown === 0)).toBe(true);
                const firstTravel = samples.find(sample => sample.signal.lastPortalTravelAtMs !== initial.signal.lastPortalTravelAtMs);
                expect(Math.hypot(...firstTravel.position.map((value, axis) => value - initial.exit[axis]))).toBeLessThan(3);
                expect(firstTravel.signal.portalCooldownRemaining).toBeGreaterThan(0);
                expect(firstTravel.pairCooldown).toBeGreaterThan(0);
                expect(new Set(samples.filter(sample => sample.signal.lastPortalTravelAtMs !== initial.signal.lastPortalTravelAtMs)
                    .map(sample => sample.signal.lastPortalTravelAtMs)).size).toBe(1);
                const last = samples.at(-1);
                expect(Math.hypot(...last.position.map((value, axis) => value - initial.exit[axis]))).toBeGreaterThanOrEqual(8);
                expect(last.signal.portalCooldownRemaining).toBeLessThan(firstTravel.signal.portalCooldownRemaining);
                expect(last.pairCooldown).toBeLessThan(firstTravel.pairCooldown);
                expect(last.animationSeconds).toBeGreaterThan(initial.animationSeconds);
                const quaternionDot = Math.abs(last.quaternion.reduce((sum, value, axis) => sum + value * initial.quaternion[axis], 0));
                expect(quaternionDot).toBeGreaterThan(0.999);
                await stopPilot(session);
            }
        } finally {
            await stopPilot(session);
            await testInfo.attach('portal-flights.json', { body: JSON.stringify(flights), contentType: 'application/json' });
        }
        expect(flights).toHaveLength(pairs.length * 2);
    });
}
