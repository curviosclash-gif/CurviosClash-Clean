import { test, expect } from './helpers.desktop.js';
import { loadGame, startGameWithBots, startHuntGameWithBots, returnToMenu } from './helpers.js';

test.describe('Physics Policy (Tests 65-82)', () => {
    test.describe.configure({ timeout: 120000 });

    test('T66: Bot-Input bleibt stabil wenn Policy-Update abstuerzt', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((p) => p?.isBot);
            if (!entityManager || !bot) {
                return { error: 'missing-bot' };
            }

            const policy = entityManager.botByPlayer.get(bot);
            if (!policy) {
                return { error: 'missing-policy' };
            }

            const originalUpdate = policy.update;
            let crashed = false;
            let action = null;
            try {
                policy.update = () => {
                    throw new Error('simulated-bot-failure');
                };
                action = entityManager._playerInputSystem.resolvePlayerInput(bot, 1 / 60, null);
            } catch (error) {
                crashed = true;
            } finally {
                policy.update = originalUpdate;
            }

            return { error: null, crashed, action };
        });

        expect(result.error).toBeNull();
        expect(result.crashed).toBeFalsy();
        expect(result.action.shootItem).toBeFalsy();
        expect(result.action.shootMG).toBeFalsy();
        expect(result.action.shootItemIndex).toBe(-1);
        expect(result.action.useItem).toBe(-1);
    });

    test('T70: Observation-System extrahiert normalisierte Runtime-Features', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const observation = window.CURVIOS_TEST_API?.ObservationSystem;

            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            if (!entityManager || !bot) {
                return { error: 'missing-bot' };
            }

            const context = observation.createObservationContext({
                arena: entityManager.arena,
                players: entityManager.players,
                projectiles: entityManager.projectiles,
                mode: game?.activeGameMode || 'classic',
                planarMode: !!game?.config?.GAMEPLAY?.PLANAR_MODE,
            });
            const vector = observation.buildObservation(bot, context);
            const itemSlots = vector.slice(schema.ITEM_SLOT_00, schema.ITEM_SLOT_19 + 1);
            const ratioIndices = [
                schema.SPEED_RATIO,
                schema.HEALTH_RATIO,
                schema.SHIELD_RATIO,
                schema.WALL_DISTANCE_FRONT,
                schema.WALL_DISTANCE_LEFT,
                schema.WALL_DISTANCE_RIGHT,
                schema.WALL_DISTANCE_UP,
                schema.WALL_DISTANCE_DOWN,
                schema.TARGET_DISTANCE_RATIO,
                schema.PRESSURE_LEVEL,
                schema.LOCAL_OPENNESS_RATIO,
                schema.INVENTORY_COUNT_RATIO,
            ];
            const ratiosInRange = ratioIndices.every((index) => {
                const value = Number(vector[index]);
                return Number.isFinite(value) && value >= 0 && value <= 1;
            });
            const signedAlignment = Number(vector[schema.TARGET_ALIGNMENT]);
            const selectedSlot = Number(vector[schema.SELECTED_ITEM_SLOT]);

            return {
                error: null,
                length: vector.length,
                ratiosInRange,
                signedAlignmentInRange: Number.isFinite(signedAlignment) && signedAlignment >= -1 && signedAlignment <= 1,
                selectedSlotInRange: selectedSlot >= -1 && selectedSlot <= 19,
                itemSlotCount: itemSlots.length,
                itemSlotsValid: itemSlots.every((value) => value === 0 || value === 1),
            };
        });

        expect(result.error).toBeNull();
        expect(result.length).toBe(40);
        expect(result.ratiosInRange).toBeTruthy();
        expect(result.signedAlignmentInRange).toBeTruthy();
        expect(result.selectedSlotInRange).toBeTruthy();
        expect(result.itemSlotCount).toBe(20);
        expect(result.itemSlotsValid).toBeTruthy();
    });

    test('T71: Runtime-Context-Signatur uebergibt Kontext inkl. Observation an Policies', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            if (!entityManager || !bot) {
                return { error: 'missing-bot' };
            }

            const policy = entityManager.botByPlayer.get(bot);
            if (!policy) {
                return { error: 'missing-policy' };
            }

            const originalUpdate = policy.update;
            const originalFlag = policy.usesRuntimeContext;
            let observed = null;
            try {
                policy.usesRuntimeContext = true;
                policy.update = function runtimeContextUpdate(dt, player, context) {
                    observed = {
                        argCount: arguments.length,
                        hasArena: !!context?.arena,
                        hasPlayers: Array.isArray(context?.players),
                        hasProjectiles: Array.isArray(context?.projectiles),
                        hasRules: !!context?.rules,
                        hasObservation: Number(context?.observation?.length) === 40,
                        modeType: typeof context?.mode,
                    };
                    return { yawLeft: true };
                };
                const action = entityManager._playerInputSystem.resolvePlayerInput(bot, 1 / 60, null);
                return { error: null, observed, actionYawLeft: !!action?.yawLeft };
            } finally {
                policy.update = originalUpdate;
                policy.usesRuntimeContext = originalFlag;
            }
        });

        expect(result.error).toBeNull();
        expect(result.observed.argCount).toBe(3);
        expect(result.observed.hasArena).toBeTruthy();
        expect(result.observed.hasPlayers).toBeTruthy();
        expect(result.observed.hasProjectiles).toBeTruthy();
        expect(result.observed.hasRules).toBeTruthy();
        expect(result.observed.hasObservation).toBeTruthy();
        expect(result.observed.modeType).toBe('string');
        expect(result.actionYawLeft).toBeTruthy();
    });

    test('T71b: Observation-Buffer wird pro Bot-Tick wiederverwendet', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            if (!entityManager || !bot) {
                return { error: 'missing-bot' };
            }

            const policy = entityManager.botByPlayer.get(bot);
            if (!policy) {
                return { error: 'missing-policy' };
            }

            const originalUpdate = policy.update;
            const originalFlag = policy.usesRuntimeContext;
            const observedRefs = [];
            const bufferMatches = [];
            try {
                policy.usesRuntimeContext = true;
                policy.update = function observationReuseProbe(dt, player, context) {
                    observedRefs.push(context?.observation || null);
                    bufferMatches.push(context?.observationBuffer === context?.observation);
                    return { yawLeft: false };
                };
                entityManager._playerInputSystem.resolvePlayerInput(bot, 1 / 60, null);
                entityManager._playerInputSystem.resolvePlayerInput(bot, 1 / 60, null);
                return {
                    error: null,
                    tickCount: observedRefs.length,
                    sameObservationReference: observedRefs[0] === observedRefs[1],
                    observationLength: Number(observedRefs[0]?.length || 0),
                    bufferMatches,
                };
            } finally {
                policy.update = originalUpdate;
                policy.usesRuntimeContext = originalFlag;
            }
        });

        expect(result.error).toBeNull();
        expect(result.tickCount).toBe(2);
        expect(result.sameObservationReference).toBeTruthy();
        expect(result.observationLength).toBe(40);
        expect(result.bufferMatches.every((entry) => entry === true)).toBeTruthy();
    });

    test('T72: Legacy-Policy-Signatur bleibt kompatibel', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            if (!entityManager || !bot) {
                return { error: 'missing-bot' };
            }

            const policy = entityManager.botByPlayer.get(bot);
            if (!policy) {
                return { error: 'missing-policy' };
            }

            const originalUpdate = policy.update;
            const originalFlag = policy.usesRuntimeContext;
            let observed = null;
            try {
                policy.usesRuntimeContext = false;
                policy.update = function legacyUpdate(dt, player, arena, allPlayers, projectiles) {
                    observed = {
                        argCount: arguments.length,
                        hasArena: !!arena?.checkCollision,
                        playersLength: Array.isArray(allPlayers) ? allPlayers.length : -1,
                        hasProjectileArray: Array.isArray(projectiles),
                    };
                    return { yawRight: true };
                };
                const action = entityManager._playerInputSystem.resolvePlayerInput(bot, 1 / 60, null);
                return { error: null, observed, actionYawRight: !!action?.yawRight };
            } finally {
                policy.update = originalUpdate;
                policy.usesRuntimeContext = originalFlag;
            }
        });

        expect(result.error).toBeNull();
        expect(result.observed.argCount).toBe(5);
        expect(result.observed.hasArena).toBeTruthy();
        expect(result.observed.playersLength).toBeGreaterThan(0);
        expect(result.observed.hasProjectileArray).toBeTruthy();
        expect(result.actionYawRight).toBeTruthy();
    });

    test('T77: HuntBridgePolicy setzt MG-Druck auf Basis von Observation + Gegnernaehe', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const { HuntBridgePolicy } = window.CURVIOS_TEST_API || {};
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            const enemy = entityManager?.players?.find((player) => !player?.isBot);
            if (!entityManager || !bot || !enemy) {
                return { error: 'missing-hunt-state' };
            }

            bot.hp = Math.max(1, bot.maxHp || 1);
            bot.inventory = [];
            bot.position.set(0, 50, 0);
            bot.setLookAtWorld?.(0, 50, -100);
            enemy.position.set(0, 50, -18);

            entityManager._lockOnCache?.clear?.();
            const context = entityManager.createBotRuntimeContext(bot, 1 / 60);
            context.huntTarget = entityManager._checkLockOn(bot);
            context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
            context.observation[schema.TARGET_DISTANCE_RATIO] = 0.12;
            context.observation[schema.TARGET_IN_FRONT] = 1;
            context.observation[schema.PRESSURE_LEVEL] = 0.35;
            context.observation[schema.PROJECTILE_THREAT] = 0;

            const policy = new HuntBridgePolicy();
            const action = policy.update(1 / 60, bot, context);
            return {
                error: null,
                type: policy.type,
                shootMG: !!action?.shootMG,
                shootItem: !!action?.shootItem,
                shootItemIndex: Number(action?.shootItemIndex),
            };
        });

        expect(result.error).toBeNull();
        expect(result.type).toBe('hunt-bridge');
        expect(result.shootMG).toBeTruthy();
        expect(result.shootItem).toBeFalsy();
        expect(result.shootItemIndex).toBe(-1);
    });

    test('T78: HuntBridgePolicy priorisiert Rocket + Boost bei niedrigem HP-Druck', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const { HuntBridgePolicy } = window.CURVIOS_TEST_API || {};
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            const enemy = entityManager?.players?.find((player) => !player?.isBot);
            if (!entityManager || !bot || !enemy) {
                return { error: 'missing-hunt-state' };
            }

            bot.maxHp = Math.max(1, Number(bot.maxHp) || 1);
            bot.hp = Math.max(1, bot.maxHp * 0.2);
            bot.inventory = [];
            bot.rocketInventory = ['ROCKET_WEAK', 'ROCKET_HEAVY'];
            bot.selectedItemIndex = 0;
            bot.position.set(0, 50, 0);
            bot.setLookAtWorld?.(0, 50, -100);
            enemy.position.set(2, 50, -14);

            const context = entityManager.createBotRuntimeContext(bot, 1 / 60);
            context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
            context.observation[schema.TARGET_DISTANCE_RATIO] = 0.55;
            context.observation[schema.TARGET_IN_FRONT] = 1;
            context.observation[schema.PRESSURE_LEVEL] = 0.92;
            context.observation[schema.PROJECTILE_THREAT] = 1;

            const policy = new HuntBridgePolicy();
            const action = policy.update(1 / 60, bot, context);
            return {
                error: null,
                shootItem: !!action?.shootItem,
                shootRocket: !!action?.shootRocket,
                boost: !!action?.boost,
                yawCommand: !!action?.yawLeft || !!action?.yawRight,
                pitchCommand: !!action?.pitchUp || !!action?.pitchDown,
            };
        });

        expect(result.error).toBeNull();
        expect(result.shootRocket).toBeTruthy();
        expect(result.shootItem).toBeFalsy();
        expect(result.boost).toBeTruthy();
        expect(result.yawCommand || result.pitchCommand).toBeTruthy();
    });

    test('T78b: HuntBotPolicy behandelt gueltige Trail-Ziele als MG-/Rocket-Freigabe auch bei negativem Sensor-Frontflag', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const { HuntBotPolicy } = window.CURVIOS_TEST_API || {};
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            const enemy = entityManager?.players?.find((player) => !player?.isBot);
            if (!entityManager || !bot || !enemy) {
                return { error: 'missing-state' };
            }

            bot.trail?.clear?.();
            enemy.trail?.clear?.();
            bot.position.set(0, 50, 0);
            bot.setLookAtWorld?.(0, 50, -120);
            bot.hp = Math.max(1, Number(bot.maxHp) || 100);
            bot.inventory = ['ROCKET_HEAVY'];
            bot.selectedItemIndex = 0;

            enemy.position.set(8, 50, -24);
            enemy.hp = Math.max(1, Number(enemy.maxHp) || 100);
            enemy.spawnProtectionTimer = 0;

            const aim = bot.position.clone().set(0, 0, 0);
            bot.getAimDirection(aim).normalize();
            const from = bot.position.clone().addScaledVector(aim, 18);
            const to = bot.position.clone().addScaledVector(aim, 20);
            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.5)) % maxSegments;
            const radius = Math.max(0.2, (Number(enemy?.trail?.width) || 0.6) * 0.5);
            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: from.x,
                fromY: from.y,
                fromZ: from.z,
                toX: to.x,
                toY: to.y,
                toZ: to.z,
                midX: (from.x + to.x) * 0.5,
                midZ: (from.z + to.z) * 0.5,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const policy = new HuntBotPolicy();
            policy._fallbackPolicy.getSensorSnapshot = () => ({
                targetInFront: false,
                targetDistanceSq: 999999,
                pressure: 0,
                projectileThreat: false,
                targetYaw: 0,
                targetPitch: 0,
                targetPlayer: null,
            });

            const context = entityManager.createBotRuntimeContext(bot, 1 / 60);
            context.huntTarget = {
                kind: 'trail',
                playerIndex: enemy.index,
                segmentIdx,
                distance: bot.position.distanceTo(from),
                point: {
                    x: (from.x + to.x) * 0.5,
                    y: (from.y + to.y) * 0.5,
                    z: (from.z + to.z) * 0.5,
                },
                position: {
                    x: (from.x + to.x) * 0.5,
                    y: (from.y + to.y) * 0.5,
                    z: (from.z + to.z) * 0.5,
                },
                alive: true,
            };
            const action = policy.update(1 / 60, bot, context);

            if (trailRef?.key && trailRef?.entry && !trailRef.entry.destroyed) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }

            return {
                error: null,
                huntTargetKind: String(context?.huntTarget?.kind || ''),
                huntTargetPlayerIndex: Number(context?.huntTarget?.playerIndex ?? -1),
                shootMG: !!action?.shootMG,
                shootItem: !!action?.shootItem,
                shootItemIndex: Number(action?.shootItemIndex),
            };
        });

        expect(result.error).toBeNull();
        expect(result.huntTargetKind).toBe('trail');
        expect(result.huntTargetPlayerIndex).toBeGreaterThanOrEqual(0);
        expect(result.shootMG).toBeTruthy();
        expect(result.shootItem).toBeTruthy();
        expect(result.shootItemIndex).toBe(0);
    });

    test('T78c: HuntBridgePolicy priorisiert gueltige Trail-Ziele auch wenn Observation kein Frontziel meldet', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const { HuntBridgePolicy } = window.CURVIOS_TEST_API || {};
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            const enemy = entityManager?.players?.find((player) => !player?.isBot);
            if (!entityManager || !bot || !enemy) {
                return { error: 'missing-state' };
            }

            bot.trail?.clear?.();
            enemy.trail?.clear?.();
            bot.position.set(0, 50, 0);
            bot.setLookAtWorld?.(0, 50, -120);
            bot.hp = Math.max(1, Number(bot.maxHp) || 100);
            bot.inventory = [];
            bot.rocketInventory = ['ROCKET_HEAVY'];
            bot.selectedItemIndex = 0;

            enemy.position.set(9, 50, -26);
            enemy.hp = Math.max(1, Number(enemy.maxHp) || 100);
            enemy.spawnProtectionTimer = 0;

            const aim = bot.position.clone().set(0, 0, 0);
            bot.getAimDirection(aim).normalize();
            const from = bot.position.clone().addScaledVector(aim, 18);
            const to = bot.position.clone().addScaledVector(aim, 20);
            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.45)) % maxSegments;
            const radius = Math.max(0.2, (Number(enemy?.trail?.width) || 0.6) * 0.5);
            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: from.x,
                fromY: from.y,
                fromZ: from.z,
                toX: to.x,
                toY: to.y,
                toZ: to.z,
                midX: (from.x + to.x) * 0.5,
                midZ: (from.z + to.z) * 0.5,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const context = entityManager.createBotRuntimeContext(bot, 1 / 60);
            context.huntTarget = {
                kind: 'trail',
                playerIndex: enemy.index,
                segmentIdx,
                distance: bot.position.distanceTo(from),
                point: {
                    x: (from.x + to.x) * 0.5,
                    y: (from.y + to.y) * 0.5,
                    z: (from.z + to.z) * 0.5,
                },
                position: {
                    x: (from.x + to.x) * 0.5,
                    y: (from.y + to.y) * 0.5,
                    z: (from.z + to.z) * 0.5,
                },
                alive: true,
            };
            context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
            context.observation[schema.TARGET_DISTANCE_RATIO] = 0.95;
            context.observation[schema.TARGET_IN_FRONT] = 0;
            context.observation[schema.PRESSURE_LEVEL] = 0.2;
            context.observation[schema.PROJECTILE_THREAT] = 0;

            const policy = new HuntBridgePolicy();
            const action = policy.update(1 / 60, bot, context);

            if (trailRef?.key && trailRef?.entry && !trailRef.entry.destroyed) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }

            return {
                error: null,
                huntTargetKind: String(context?.huntTarget?.kind || ''),
                shootMG: !!action?.shootMG,
                shootItem: !!action?.shootItem,
                shootRocket: !!action?.shootRocket,
            };
        });

        expect(result.error).toBeNull();
        expect(result.huntTargetKind).toBe('trail');
        expect(result.shootMG).toBeTruthy();
        expect(result.shootRocket).toBeTruthy();
        expect(result.shootItem).toBeFalsy();
    });

    test('T78d: HuntBotPolicy haelt MG-Druck bei niedrigem HP mit stabilem Shield aufrecht', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const { HuntBotPolicy } = window.CURVIOS_TEST_API || {};
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            const enemy = entityManager?.players?.find((player) => !player?.isBot);
            if (!entityManager || !bot || !enemy) {
                return { error: 'missing-hunt-state' };
            }

            bot.position.set(0, 50, 0);
            bot.setLookAtWorld?.(0, 50, -120);
            bot.maxHp = Math.max(1, Number(bot.maxHp) || 100);
            bot.hp = Math.max(1, bot.maxHp * 0.22);
            bot.maxShieldHp = Math.max(10, Number(bot.maxShieldHp) || 40);
            bot.shieldHP = bot.maxShieldHp * 0.7;
            bot.hasShield = true;
            bot.inventory = [];

            enemy.position.set(0, 50, -16);
            enemy.maxHp = Math.max(1, Number(enemy.maxHp) || 100);
            enemy.hp = Math.max(1, enemy.maxHp * 0.16);
            enemy.maxShieldHp = Math.max(10, Number(enemy.maxShieldHp) || 40);
            enemy.shieldHP = 0;
            enemy.hasShield = false;

            const policy = new HuntBotPolicy();
            policy._fallbackPolicy.update = () => ({
                shootMG: false,
                shootItem: false,
                shootItemIndex: -1,
                boost: false,
            });
            policy._fallbackPolicy.getSensorSnapshot = () => ({
                targetInFront: true,
                targetDistanceSq: 16 * 16,
                pressure: 0.24,
                projectileThreat: false,
                targetYaw: 0,
                targetPitch: 0,
                targetPlayer: enemy,
            });

            const context = entityManager.createBotRuntimeContext(bot, 1 / 60);
            const action = policy.update(1 / 60, bot, context);
            return {
                error: null,
                shootMG: !!action?.shootMG,
                shootItem: !!action?.shootItem,
                boost: !!action?.boost,
            };
        });

        expect(result.error).toBeNull();
        expect(result.shootMG).toBeTruthy();
        expect(result.shootItem).toBeFalsy();
        expect(result.boost).toBeFalsy();
    });

    test('T78e: HuntBridgePolicy priorisiert Retreat bei kritischer Vitalitaet und behaelt Rocket-Shot bei', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const { HuntBridgePolicy } = window.CURVIOS_TEST_API || {};
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const bot = entityManager?.players?.find((player) => player?.isBot);
            const enemy = entityManager?.players?.find((player) => !player?.isBot);
            if (!entityManager || !bot || !enemy) {
                return { error: 'missing-hunt-state' };
            }

            bot.position.set(0, 50, 0);
            bot.setLookAtWorld?.(0, 50, -120);
            bot.maxHp = Math.max(1, Number(bot.maxHp) || 100);
            bot.hp = Math.max(1, bot.maxHp * 0.28);
            bot.maxShieldHp = Math.max(10, Number(bot.maxShieldHp) || 40);
            bot.shieldHP = bot.maxShieldHp * 0.04;
            bot.hasShield = true;
            bot.inventory = [];
            bot.rocketInventory = ['ROCKET_HEAVY'];
            bot.selectedItemIndex = 0;

            enemy.position.set(10, 50, -20);
            enemy.maxHp = Math.max(1, Number(enemy.maxHp) || 100);
            enemy.hp = Math.max(1, enemy.maxHp * 0.75);
            enemy.maxShieldHp = Math.max(10, Number(enemy.maxShieldHp) || 40);
            enemy.shieldHP = enemy.maxShieldHp * 0.1;
            enemy.hasShield = true;

            const context = entityManager.createBotRuntimeContext(bot, 1 / 60);
            context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
            context.observation[schema.TARGET_DISTANCE_RATIO] = 0.2;
            context.observation[schema.TARGET_IN_FRONT] = 1;
            context.observation[schema.PRESSURE_LEVEL] = 0.82;
            context.observation[schema.PROJECTILE_THREAT] = 0;

            const policy = new HuntBridgePolicy();
            const action = policy.update(1 / 60, bot, context);
            return {
                error: null,
                shootMG: !!action?.shootMG,
                shootItem: !!action?.shootItem,
                shootRocket: !!action?.shootRocket,
                boost: !!action?.boost,
                yawCommand: !!action?.yawLeft || !!action?.yawRight,
            };
        });

        expect(result.error).toBeNull();
        expect(result.shootMG).toBeFalsy();
        expect(result.shootRocket).toBeTruthy();
        expect(result.shootItem).toBeFalsy();
        expect(result.boost).toBeTruthy();
        expect(result.yawCommand).toBeTruthy();
    });

    test('T80e: Matchpfad liefert fuer Bridge-Bot ueber Zeit Steering-Inputs (kein Dauer-Geradeaus)', async ({ page }) => {
        await startGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            if (!game?._returnToMenu) {
                return { error: 'missing-game-hooks' };
            }

            const entityManager = game.entityManager;
            const botPlayer = entityManager?.players?.find((player) => player?.isBot) || null;
            const policy = botPlayer ? entityManager?.botByPlayer?.get(botPlayer) : null;
            if (!botPlayer || !policy || !entityManager?._playerInputSystem) {
                game._returnToMenu();
                return { error: 'missing-bot-policy' };
            }

            const bounds = entityManager?.arena?.bounds;
            if (bounds && botPlayer?.position?.set) {
                const centerY = ((Number(bounds.minY) || 0) + (Number(bounds.maxY) || 0)) * 0.5;
                botPlayer.position.set((Number(bounds.maxX) || 0) - 120, centerY, 0);
                botPlayer.velocity?.set?.(0, 0, 0);
                botPlayer.setLookAtWorld?.((Number(bounds.maxX) || 0) + 80, centerY, 0);
            }

            let steeringCount = 0;
            let sampleCount = 0;
            const sampleTarget = 160;
            for (let i = 0; i < sampleTarget; i += 1) {
                if (!botPlayer?.alive) break;
                const input = entityManager._playerInputSystem.resolvePlayerInput(botPlayer, 1 / 60, null);
                const hasSteering = !!(
                    input?.yawLeft
                    || input?.yawRight
                    || input?.pitchUp
                    || input?.pitchDown
                    || input?.rollLeft
                    || input?.rollRight
                );
                if (hasSteering) {
                    steeringCount += 1;
                }
                sampleCount += 1;
            }

            const steeringRatio = sampleCount > 0 ? steeringCount / sampleCount : 0;
            const policyType = String(policy?.type || '');
            game._returnToMenu();
            return {
                error: null,
                policyType,
                sampleCount,
                steeringCount,
                steeringRatio,
            };
        });

        expect(result.error).toBeNull();
        expect(result.policyType.includes('classic')).toBeTruthy();
        expect(result.sampleCount).toBeGreaterThan(40);
        expect(result.steeringRatio).toBeGreaterThan(0.02);
    });

    test('T82: Session-Wiring uebergibt aufgeloeste Bot-Policy an EntityManager', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            if (!game?.startMatch || !game?._returnToMenu) {
                return { error: 'missing-game-hooks' };
            }

            game.settings.mode = '1p';
            game.settings.numBots = 2;
            if (!game.settings.gameplay || typeof game.settings.gameplay !== 'object') {
                game.settings.gameplay = {};
            }

            const waitForScenarioStart = async (expectedBotCount, timeoutMs = 5000) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeoutMs) {
                    const entityManager = game.entityManager;
                    const botPlayers = entityManager?.players?.filter((player) => player?.isBot) || [];
                    const hasPolicyBindings = botPlayers.length >= expectedBotCount
                        && botPlayers.every((player) => !!entityManager?.botByPlayer?.get(player));
                    if (entityManager && hasPolicyBindings) {
                        return entityManager;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 16));
                }
                return game.entityManager || null;
            };

            const runScenario = async (gameMode, planarMode, strategy = 'auto') => {
                game.settings.gameMode = gameMode;
                game.settings.botPolicyStrategy = strategy;
                game.settings.gameplay.planarMode = !!planarMode;
                if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
                    game.settings.localSettings = {};
                }
                game.settings.localSettings.modePath = String(gameMode || '').toUpperCase() === 'HUNT' ? 'fight' : 'normal';
                game.runtimeCoordinator.onSettingsChanged();
                const startResult = game.startMatch();
                if (startResult && typeof startResult.then === 'function') {
                    await startResult;
                }

                const entityManager = await waitForScenarioStart(2);
                const botPlayers = entityManager?.players?.filter((player) => player?.isBot) || [];
                const botPolicyTypes = botPlayers.map((player) => String(entityManager?.botByPlayer?.get(player)?.type || ''));
                const uniqueBotPolicyTypes = Array.from(new Set(botPolicyTypes.filter((type) => !!type)));
                const snapshot = {
                    mode: String(game.runtimeConfig?.session?.activeGameMode || ''),
                    planarMode: !!game.runtimeConfig?.gameplay?.planarMode,
                    strategy: String(game.runtimeConfig?.bot?.policyStrategy || ''),
                    runtimePolicyType: String(game.runtimeConfig?.bot?.policyType || ''),
                    entityPolicyType: String(entityManager?.botPolicyType || ''),
                    botPolicyTypes,
                    uniqueBotPolicyTypes,
                    botCount: botPlayers.length,
                };
                game._returnToMenu();
                return snapshot;
            };

            return {
                error: null,
                classic3d: await runScenario('CLASSIC', false),
                classic2d: await runScenario('CLASSIC', true),
                hunt3d: await runScenario('HUNT', false),
                hunt2d: await runScenario('HUNT', true),
            };
        });

        expect(result.error).toBeNull();
        expect(result.classic3d.runtimePolicyType).toBe('classic-3d');
        expect(result.classic3d.entityPolicyType).toBe('classic-3d');
        expect(result.classic3d.uniqueBotPolicyTypes).toEqual(['classic-3d']);
        expect(result.classic3d.botCount).toBe(2);
        expect(result.classic2d.runtimePolicyType).toBe('classic-2d');
        expect(result.classic2d.entityPolicyType).toBe('classic-2d');
        expect(result.classic2d.uniqueBotPolicyTypes).toEqual(['classic-2d']);
        expect(result.classic2d.botCount).toBe(2);
        expect(result.hunt3d.runtimePolicyType).toBe('hunt-3d');
        expect(result.hunt3d.entityPolicyType).toBe('hunt-3d');
        expect(result.hunt3d.uniqueBotPolicyTypes).toEqual(['hunt-3d']);
        expect(result.hunt3d.botCount).toBe(2);
        expect(result.hunt2d.runtimePolicyType).toBe('hunt-2d');
        expect(result.hunt2d.entityPolicyType).toBe('hunt-2d');
        expect(result.hunt2d.uniqueBotPolicyTypes).toEqual(['hunt-2d']);
        expect(result.hunt2d.botCount).toBe(2);
    });

    test('T82b: Rule-Based-Bot-Perception bleibt ueber Facade lauffaehig', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            if (!game?.startMatch || !game?._returnToMenu) {
                return { error: 'missing-game-hooks' };
            }

            game.settings.mode = '1p';
            game.settings.numBots = 2;
            game.settings.gameMode = 'CLASSIC';
            game.settings.botPolicyStrategy = 'rule-based';
            if (!game.settings.gameplay || typeof game.settings.gameplay !== 'object') {
                game.settings.gameplay = {};
            }
            if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
                game.settings.localSettings = {};
            }
            game.settings.localSettings.modePath = 'normal';
            game.settings.gameplay.planarMode = false;
            game.runtimeCoordinator.onSettingsChanged();
            const startResult = game.startMatch();
            if (startResult && typeof startResult.then === 'function') {
                await startResult;
            }

            const startedAt = Date.now();
            let entityManager = game.entityManager;
            let botPlayer = entityManager?.players?.find((player) => player?.isBot) || null;
            let policy = botPlayer ? entityManager?.botByPlayer?.get(botPlayer) : null;
            while ((!botPlayer || !policy) && Date.now() - startedAt < 5000) {
                await new Promise((resolve) => setTimeout(resolve, 16));
                entityManager = game.entityManager;
                botPlayer = entityManager?.players?.find((player) => player?.isBot) || null;
                policy = botPlayer ? entityManager?.botByPlayer?.get(botPlayer) : null;
            }
            if (!botPlayer || !policy) {
                game._returnToMenu();
                return { error: 'missing-bot-policy' };
            }

            try {
                const action = policy.update(1 / 60, botPlayer, game.arena, entityManager.players, entityManager.projectiles);
                const sensorSnapshot = typeof policy.getSensorSnapshot === 'function'
                    ? policy.getSensorSnapshot()
                    : null;
                game._returnToMenu();
                return {
                    error: null,
                    policyType: String(policy.type || ''),
                    hasAction: !!action,
                    forwardRisk: Number(sensorSnapshot?.forwardRisk),
                    lookAhead: Number(sensorSnapshot?.lookAhead),
                };
            } catch (error) {
                game._returnToMenu();
                return {
                    error: error instanceof Error ? error.message : String(error),
                    policyType: String(policy.type || ''),
                };
            }
        });

        expect(result.error).toBeNull();
        expect(result.policyType).toBe('rule-based');
        expect(result.hasAction).toBeTruthy();
        expect(Number.isFinite(result.forwardRisk)).toBeTruthy();
        expect(result.lookAhead).toBeGreaterThan(0);
    });

});
