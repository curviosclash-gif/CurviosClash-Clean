import * as THREE from 'three';
import { EndlessParcoursRuntime } from '../../src/entities/endless/EndlessParcoursRuntime.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../../src/shared/contracts/EntityRuntimeConfig.js';
import { PlayerController } from '../../src/entities/player/PlayerController.js';
import { updatePlayerMotion } from '../../src/entities/player/PlayerMotionOps.js';
import { ClassicBridgePolicy } from '../../src/entities/ai/ClassicBridgePolicy.js';
import { HuntBridgePolicy } from '../../src/entities/ai/HuntBridgePolicy.js';
import { createBotRuntimeContext } from '../../src/entities/ai/BotRuntimeContextFactory.js';
import { sphereIntersectsStaticMeshCollider } from '../../src/entities/arena/StaticMeshCollider.js';
import { CollisionResponseSystem } from '../../src/entities/systems/CollisionResponseSystem.js';
import { HuntModeStrategy } from '../../src/modes/HuntModeStrategy.js';
import { applyShieldAndHpDamage } from '../../src/hunt/HealthSystem.js';

function actor(index, isBot) {
    return { index, isBot, alive: true, entitySlotActive: true, hp: 100, maxHp: 100, shieldHP: 0,
        maxShieldHp: 100, inventory: [], rocketInventory: [], scenarioRole: 'pursuer', hitboxRadius: 1.2,
        entityRuntimeConfig: DEFAULT_ENTITY_RUNTIME_CONFIG, baseSpeed: 35, speed: 35, turnSpeed: 2.5,
        pitchTurnSpeed: 2.5, rollSpeed: 2.5, boostCharge: 0, boostTimer: 0, boostCooldown: 1,
        boostPortalTimer: 0, slingshotTimer: 0, currentPlanarY: 0,
        position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
        _tmpEuler: new THREE.Euler(0, 0, 0, 'YXZ'), _tmpEuler2: new THREE.Euler(0, 0, 0, 'YXZ'),
        _tmpQuat: new THREE.Quaternion(), _tmpVec: new THREE.Vector3(),
        boostPortalDir: new THREE.Vector3(), slingshotForward: new THREE.Vector3(), slingshotUp: new THREE.Vector3(),
        trail: { forceGap() {} },
        getDirection(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quaternion); },
        getAimDirection(out) { return this.getDirection(out); } };
}

/** Controlled navigation comparison, not a full-match or rendering benchmark.
 * Both arms share seed, tube triangles, speed, health and Hunt wall damage/recovery.
 * Only the pre-P5 Classic policy/forward entry and P5 Hunt policy/course route/backward
 * ahead-entry differ. Weapons, pickups, regeneration and authored obstacle deaths
 * are excluded so the result counts wall losses rather than combat losses.
 */
export function runEndlessHunterFlight({ seed = 1, ahead = false, guided = true, seconds = 12 } = {}) {
    const human = actor(0, false), bot = actor(1, true), normal = new THREE.Vector3();
    let wallContacts = 0;
    const manager = { players: [human, bot], humanPlayers: [human], bots: [{ player: bot }], projectiles: [],
        combatModeType: 'HUNT', runtimeConfig: { bot: {} }, _simulationClockMs: 0,
        _tmpVec: new THREE.Vector3(), _tmpVec2: new THREE.Vector3(), _tmpDir: new THREE.Vector3(),
        botByPlayer: new Map(), deactivateBotSlot() { bot.alive = false; },
        getParcoursRouteSnapshot(index) { return guided ? runtime.getBotRouteSnapshot(index) : null; },
        _applyModeDamage(player, damage) {
            const result = applyShieldAndHpDamage(player, damage);
            if (result.isDead) player.alive = false;
            return result;
        } };
    const arena = { bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000, minZ: -1000, maxZ: 1e6 },
        checkCollision(position, radius = 1.2) {
            for (const i of runtime.activeModules.values()) {
                if (sphereIntersectsStaticMeshCollider(i.staticColliders[0].meshCollider, position, radius)) return true;
            }
            return false;
        } };
    arena.checkCollisionFast = arena.checkCollision;
    manager.arena = arena;
    const runtime = new EndlessParcoursRuntime({ baseSeed: seed, entityManager: manager, arena });
    const policy = guided ? new HuntBridgePolicy({ autoLoadCheckpoint: false, type: 'hunt-3d', random: () => 0.5 })
        : new ClassicBridgePolicy({ autoLoadCheckpoint: false, type: 'classic-3d', random: () => 0.5 });
    manager.botByPlayer.set(bot, policy);
    const response = new CollisionResponseSystem(manager);
    manager._bounceBot = (player, n, source, options) => {
        // Actual collision recovery with a deterministic random source in both arms.
        response.pushPlayerOutOfCollision(player, n, 2);
        response.bounceBot(player, n, source, { ...options, random: () => 0.5 });
    };
    const strategy = new HuntModeStrategy({ seed });
    const controller = new PlayerController(), metric = runtime.getPathMetric();
    runtime._syncModules(8, 4);
    const start = metric.getStationAtProgress(8, 0.3);
    const botFrame = metric.sampleAtS(start), direction = new THREE.Vector3().copy(botFrame.tangent);
    bot.position.copy(botFrame.position).addScaledVector(botFrame.right, ahead ? 10 : -10);
    if (ahead && guided) direction.negate();
    bot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    bot.endlessRunId = runtime.runId; runtime._botSlots[0].state = 'active';
    let ticks = 0, routeTicks = 0;
    const dt = 1 / 60;
    for (; ticks < seconds / dt && bot.alive; ticks++) {
        const station = start + (ahead ? -80 : 100) + ticks * dt * 35;
        const frame = metric.sampleAtS(station);
        human.position.copy(frame.position);
        human.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3().copy(frame.tangent));
        runtime.currentProgressMeters = station;
        runtime._syncModules(frame.moduleIndex, 4);
        manager._simulationClockMs = ticks * dt * 1000;
        const context = createBotRuntimeContext(manager, bot, dt);
        const input = policy.update(dt, bot, context);
        if (bot.botObjectiveType === 'ENDLESS_ROUTE') routeTicks++;
        updatePlayerMotion(bot, dt, controller.resolveControlState(bot, input, false, dt), 1, dt);
        bot.wallDamageCooldown = Math.max(0, (bot.wallDamageCooldown || 0) - dt);
        bot.arenaCollisionGraceTimer = Math.max(0, (bot.arenaCollisionGraceTimer || 0) - dt);
        if (bot.arenaCollisionGraceTimer > 0) continue;
        for (const i of runtime.activeModules.values()) {
            if (!sphereIntersectsStaticMeshCollider(i.staticColliders[0].meshCollider, bot.position, bot.hitboxRadius, normal)) continue;
            wallContacts++;
            strategy.handleWallCollision(bot, { normal, kind: 'wall', isWall: true }, manager);
            break;
        }
    }
    const result = { seed, ahead, guided, wallContacts, wallDeath: bot.hp <= 0, retired: !bot.alive && bot.hp > 0, ticks, routeTicks, hp: bot.hp };
    runtime.dispose();
    return result;
}
