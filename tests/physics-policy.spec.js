import { test, expect } from '@playwright/test';
import { loadGame, startGameWithBots, startHuntGameWithBots, returnToMenu } from './helpers.js';

test.describe('Physics Policy (Tests 65-82)', () => {
    test.describe.configure({ timeout: 120000 });

    test('T65: Bot-Action-Contract sanitizt invalide Payloads robust', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const sanitizeBotAction = window.CURVIOS_TEST_API?.sanitizeBotAction;
            const warnings = [];
            const sanitized = sanitizeBotAction({
                yawLeft: 'true',
                boost: 1,
                shootItem: 'yes',
                shootItemIndex: 99,
                useItem: -5,
            }, {
                inventoryLength: 3,
                onInvalid: (message) => warnings.push(String(message || '')),
            });
            const invalidPayload = sanitizeBotAction(null, {
                inventoryLength: 3,
                onInvalid: (message) => warnings.push(String(message || '')),
            });
            return { sanitized, invalidPayload, warnings };
        });

        expect(result.sanitized.yawLeft).toBeTruthy();
        expect(result.sanitized.boost).toBeTruthy();
        expect(result.sanitized.shootItem).toBeTruthy();
        expect(result.sanitized.shootItemIndex).toBe(2);
        expect(result.sanitized.useItem).toBe(-1);
        expect(result.invalidPayload.shootItem).toBeFalsy();
        expect(result.invalidPayload.shootItemIndex).toBe(-1);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

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

    test('T67: Item-Slot-Encoding erzeugt stabiles 20-Slot-One-Hot-Array', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const mod = window.CURVIOS_TEST_API?.ItemSlotEncoder;
            const encoded = new Array(mod.ITEM_SLOT_COUNT).fill(-1);
            mod.encodeItemSlots(['SPEED_UP', 'ROCKET_MEDIUM', 'UNKNOWN_ITEM', 'ROCKET_MEDIUM'], encoded);
            return {
                encoded,
                slotCount: mod.ITEM_SLOT_COUNT,
                speedUpSlot: mod.ITEM_SLOT_BY_TYPE.SPEED_UP,
                rocketMediumSlot: mod.ITEM_SLOT_BY_TYPE.ROCKET_MEDIUM,
                unknownSlot: mod.ITEM_SLOT_UNKNOWN_INDEX,
            };
        });

        expect(result.encoded.length).toBe(result.slotCount);
        expect(result.encoded[result.speedUpSlot]).toBe(1);
        expect(result.encoded[result.rocketMediumSlot]).toBe(1);
        expect(result.encoded[result.unknownSlot]).toBe(1);
        expect(result.encoded.every((value) => value === 0 || value === 1)).toBeTruthy();
    });

    test('T68: Mode-Feature-Encoding mappt classic/hunt deterministisch', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const mod = window.CURVIOS_TEST_API?.ModeFeatureEncoder;
            const classic = mod.writeModeFeatures('classic', [0, 0, 0]);
            const hunt = mod.writeModeFeatures('HUNT', [0, 0, 0]);
            const fallback = mod.writeModeFeatures('unknown-mode', [0, 0, 0]);
            return { classic, hunt, fallback };
        });

        expect(result.classic).toEqual([0, 1, 0]);
        expect(result.hunt).toEqual([1, 0, 1]);
        expect(result.fallback).toEqual([0, 1, 0]);
    });

    test('T69: Observation-Schema V1 hat feste Laenge und eindeutige Indizes', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const semantics = window.CURVIOS_TEST_API?.ObservationSemantics;
            const indexValues = Object.values(schema.OBSERVATION_INDEX)
                .filter((value) => Number.isInteger(value))
                .sort((a, b) => a - b);
            const uniqueIndices = new Set(indexValues);
            const semanticsIndices = semantics.OBSERVATION_SEMANTICS_V1.map((entry) => entry.index);
            const uniqueSemanticIndices = new Set(semanticsIndices);

            return {
                version: schema.OBSERVATION_SCHEMA_VERSION,
                length: schema.OBSERVATION_LENGTH_V1,
                indexCount: indexValues.length,
                uniqueIndexCount: uniqueIndices.size,
                minIndex: indexValues[0],
                maxIndex: indexValues[indexValues.length - 1],
                itemSlot00: schema.ITEM_SLOT_00,
                itemSlot19: schema.ITEM_SLOT_19,
                semanticsLength: semantics.OBSERVATION_SEMANTICS_V1.length,
                uniqueSemanticsIndexCount: uniqueSemanticIndices.size,
                hasUniqueSemanticsIndices: semantics.hasUniqueObservationSemanticIndices(),
                hasExpectedSemanticsLength: semantics.hasExpectedObservationSemanticLength(schema.OBSERVATION_LENGTH_V1),
            };
        });

        expect(result.version).toBe('v1');
        expect(result.length).toBe(40);
        expect(result.indexCount).toBe(40);
        expect(result.uniqueIndexCount).toBe(40);
        expect(result.minIndex).toBe(0);
        expect(result.maxIndex).toBe(39);
        expect(result.itemSlot00).toBe(20);
        expect(result.itemSlot19).toBe(39);
        expect(result.semanticsLength).toBe(40);
        expect(result.uniqueSemanticsIndexCount).toBe(40);
        expect(result.hasUniqueSemanticsIndices).toBeTruthy();
        expect(result.hasExpectedSemanticsLength).toBeTruthy();
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

    test('T73: BotPolicyRegistry registriert Legacy- und Match-Bot-Typen', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { BotPolicyRegistry, BOT_POLICY_TYPES } = window.CURVIOS_TEST_API || {};

            const registry = new BotPolicyRegistry();
            const classicBridge = registry.create(BOT_POLICY_TYPES.CLASSIC_BRIDGE);
            const huntBridge = registry.create(BOT_POLICY_TYPES.HUNT_BRIDGE);
            const classic3d = registry.create(BOT_POLICY_TYPES.CLASSIC_3D);
            const classic2d = registry.create(BOT_POLICY_TYPES.CLASSIC_2D);
            const hunt3d = registry.create(BOT_POLICY_TYPES.HUNT_3D);
            const hunt2d = registry.create(BOT_POLICY_TYPES.HUNT_2D);

            return {
                classicType: classicBridge?.type,
                huntType: huntBridge?.type,
                classic3dType: classic3d?.type,
                classic2dType: classic2d?.type,
                hunt3dType: hunt3d?.type,
                hunt2dType: hunt2d?.type,
                classicUsesRuntimeContext: classicBridge?.usesRuntimeContext === true,
                huntUsesRuntimeContext: huntBridge?.usesRuntimeContext === true,
                matchUsesRuntimeContext: [classic3d, classic2d, hunt3d, hunt2d]
                    .every((policy) => policy?.usesRuntimeContext === true),
                classicHasUpdate: typeof classicBridge?.update === 'function',
                huntHasUpdate: typeof huntBridge?.update === 'function',
                matchHasUpdate: [classic3d, classic2d, hunt3d, hunt2d]
                    .every((policy) => typeof policy?.update === 'function'),
            };
        });

        expect(result.classicType).toBe('classic-bridge');
        expect(result.huntType).toBe('hunt-bridge');
        expect(result.classic3dType).toBe('classic-3d');
        expect(result.classic2dType).toBe('classic-2d');
        expect(result.hunt3dType).toBe('hunt-3d');
        expect(result.hunt2dType).toBe('hunt-2d');
        expect(result.classicUsesRuntimeContext).toBeTruthy();
        expect(result.huntUsesRuntimeContext).toBeTruthy();
        expect(result.matchUsesRuntimeContext).toBeTruthy();
        expect(result.classicHasUpdate).toBeTruthy();
        expect(result.huntHasUpdate).toBeTruthy();
        expect(result.matchHasUpdate).toBeTruthy();
    });

    test('T74: BotPolicyRegistry faellt bei Fehlkonfiguration kontrolliert auf rule-based zurueck', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { BotPolicyRegistry, BOT_POLICY_TYPES } = window.CURVIOS_TEST_API || {};

            const registry = new BotPolicyRegistry();
            registry.register('broken-bridge', () => {
                throw new Error('simulated-registry-factory-error');
            });

            const unknown = registry.create('unknown-policy-type');
            const broken = registry.create('broken-bridge');
            const disabledBridge = registry.create(BOT_POLICY_TYPES.CLASSIC_BRIDGE, { bridgeEnabled: false });
            const disabledMatchBot = registry.create(BOT_POLICY_TYPES.HUNT_2D, { bridgeEnabled: false });

            return {
                unknownType: unknown?.type,
                brokenType: broken?.type,
                disabledBridgeType: disabledBridge?.type,
                disabledMatchBotType: disabledMatchBot?.type,
                unknownHasUpdate: typeof unknown?.update === 'function',
                brokenHasUpdate: typeof broken?.update === 'function',
            };
        });

        expect(result.unknownType).toBe('rule-based');
        expect(result.brokenType).toBe('rule-based');
        expect(result.disabledBridgeType).toBe('classic-bridge');
        expect(result.disabledMatchBotType).toBe('hunt-2d');
        expect(result.unknownHasUpdate).toBeTruthy();
        expect(result.brokenHasUpdate).toBeTruthy();
    });

    test('T75: ClassicBridgePolicy leitet Kern-Action aus Observation-Vektor ab', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { ClassicBridgePolicy } = window.CURVIOS_TEST_API || {};
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const bot = {
                index: 0,
                inventory: ['SHIELD'],
                selectedItemIndex: 0,
            };
            const context = {
                players: [],
                projectiles: [],
                observation: null,
            };
            context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
            context.observation[schema.WALL_DISTANCE_FRONT] = 0.18;
            context.observation[schema.WALL_DISTANCE_LEFT] = 0.14;
            context.observation[schema.WALL_DISTANCE_RIGHT] = 0.9;
            context.observation[schema.TARGET_DISTANCE_RATIO] = 0.2;
            context.observation[schema.TARGET_ALIGNMENT] = 0.94;
            context.observation[schema.TARGET_IN_FRONT] = 1;
            context.observation[schema.PRESSURE_LEVEL] = 0.84;
            context.observation[schema.PROJECTILE_THREAT] = 1;
            context.observation[schema.LOCAL_OPENNESS_RATIO] = 0.7;
            context.observation[schema.INVENTORY_COUNT_RATIO] = 0.1;
            context.observation[schema.SELECTED_ITEM_SLOT] = 0;

            const policy = new ClassicBridgePolicy();
            const action = policy.update(1 / 60, bot, context);

            return {
                error: null,
                type: policy.type,
                yawRight: !!action?.yawRight,
                shootMG: !!action?.shootMG,
                shootItem: !!action?.shootItem,
                shootItemIndex: Number(action?.shootItemIndex),
                boost: !!action?.boost,
            };
        });

        expect(result.error).toBeNull();
        expect(result.type).toBe('classic-bridge');
        expect(result.yawRight).toBeTruthy();
        expect(result.shootMG).toBeTruthy();
        expect(result.shootItem).toBeTruthy();
        expect(result.shootItemIndex).toBe(0);
        expect(result.boost).toBeTruthy();
    });

    test('T76: ClassicBridgePolicy routed Action-Failures kontrolliert auf RuleBased-Fallback', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const { ClassicBridgePolicy } = window.CURVIOS_TEST_API || {};
            const schema = window.CURVIOS_TEST_API?.ObservationSchemaV1;
            const bot = {
                index: 0,
                inventory: [],
                selectedItemIndex: 0,
            };
            const context = {
                players: [],
                projectiles: [],
                observation: null,
            };
            context.observation = new Array(schema.OBSERVATION_LENGTH_V1).fill(0);
            context.observation[schema.WALL_DISTANCE_FRONT] = 0.65;

            const policy = new ClassicBridgePolicy({
                resolveAction: () => {
                    throw new Error('simulated-classic-bridge-action-failure');
                },
            });

            const fallbackType = policy._fallbackPolicy?.type;
            const originalFallbackUpdate = policy._fallbackPolicy?.update;
            let fallbackCalled = false;
            let action = null;
            try {
                policy._fallbackPolicy.update = function fallbackUpdate() {
                    fallbackCalled = true;
                    return { yawLeft: true };
                };
                action = policy.update(1 / 60, bot, context);
            } finally {
                policy._fallbackPolicy.update = originalFallbackUpdate;
            }

            return {
                error: null,
                fallbackType,
                fallbackCalled,
                yawLeft: !!action?.yawLeft,
            };
        });

        expect(result.error).toBeNull();
        expect(result.fallbackType).toBe('rule-based');
        expect(result.fallbackCalled).toBeTruthy();
        expect(result.yawLeft).toBeTruthy();
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
            bot.inventory = ['ROCKET_WEAK', 'ROCKET_HEAVY'];
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
                shootItemIndex: Number(action?.shootItemIndex),
                boost: !!action?.boost,
                yawCommand: !!action?.yawLeft || !!action?.yawRight,
                pitchCommand: !!action?.pitchUp || !!action?.pitchDown,
            };
        });

        expect(result.error).toBeNull();
        expect(result.shootItem).toBeTruthy();
        expect(result.shootItemIndex).toBe(1);
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
            bot.inventory = ['ROCKET_HEAVY'];
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
                shootItemIndex: Number(action?.shootItemIndex),
            };
        });

        expect(result.error).toBeNull();
        expect(result.huntTargetKind).toBe('trail');
        expect(result.shootMG).toBeTruthy();
        expect(result.shootItem).toBeTruthy();
        expect(result.shootItemIndex).toBe(0);
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
            bot.inventory = ['ROCKET_HEAVY'];
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
                shootItemIndex: Number(action?.shootItemIndex),
                boost: !!action?.boost,
                yawCommand: !!action?.yawLeft || !!action?.yawRight,
            };
        });

        expect(result.error).toBeNull();
        expect(result.shootMG).toBeFalsy();
        expect(result.shootItem).toBeTruthy();
        expect(result.shootItemIndex).toBe(0);
        expect(result.boost).toBeTruthy();
        expect(result.yawCommand).toBeTruthy();
    });

    test('T78f: BotDecisionOps trennt Shield-Selbstnutzung von Rocket-Offensivfenster ueber Shield-Ratio', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const decideItemUsage = window.CURVIOS_TEST_API?.decideItemUsage;

            function createBot(senseOverrides = {}) {
                return {
                    profile: {
                        aggression: 0.4,
                        itemContextWeight: 0.6,
                        itemUseCooldown: 1.0,
                        itemShootCooldown: 0.5,
                    },
                    sense: {
                        pressure: 0.2,
                        mapAggressionBias: 0,
                        targetInFront: true,
                        targetDistanceSq: 400,
                        immediateDanger: false,
                        forwardRisk: 0.1,
                        ...senseOverrides,
                    },
                    state: {
                        itemUseCooldown: 0,
                        itemShootCooldown: 0,
                    },
                    _decision: {
                        useItem: -1,
                        shootItem: false,
                        shootItemIndex: -1,
                    },
                };
            }

            const itemRules = {
                SHIELD: { self: 0.72, offense: 0.02, defensiveScale: 0.28, emergencyScale: 0.52, combatSelf: 0.2 },
                ROCKET_HEAVY: { self: 0.06, offense: 0.48, defensiveScale: 0.02, emergencyScale: 0.06, combatSelf: 0 },
            };

            const saturatedBot = createBot({
                pressure: 0.24,
                targetDistanceSq: 420,
                immediateDanger: false,
                forwardRisk: 0.12,
            });
            const saturatedPlayer = {
                maxHp: 100,
                hp: 92,
                maxShieldHp: 40,
                shieldHP: 40,
                inventory: ['SHIELD', 'ROCKET_HEAVY'],
            };
            decideItemUsage(saturatedBot, saturatedPlayer, itemRules);

            const depletedBot = createBot({
                pressure: 0.9,
                targetDistanceSq: 64,
                immediateDanger: true,
                forwardRisk: 0.92,
            });
            const depletedPlayer = {
                maxHp: 100,
                hp: 24,
                maxShieldHp: 40,
                shieldHP: 0,
                inventory: ['SHIELD', 'ROCKET_HEAVY'],
            };
            decideItemUsage(depletedBot, depletedPlayer, itemRules);

            return {
                saturated: {
                    useItem: Number(saturatedBot._decision.useItem),
                    shootItem: !!saturatedBot._decision.shootItem,
                    shootItemIndex: Number(saturatedBot._decision.shootItemIndex),
                },
                depleted: {
                    useItem: Number(depletedBot._decision.useItem),
                    shootItem: !!depletedBot._decision.shootItem,
                    shootItemIndex: Number(depletedBot._decision.shootItemIndex),
                },
            };
        });

        expect(result.saturated.useItem).toBe(-1);
        expect(result.saturated.shootItem).toBeTruthy();
        expect(result.saturated.shootItemIndex).toBe(1);

        expect(result.depleted.useItem).toBe(0);
        expect(result.depleted.shootItem).toBeFalsy();
        expect(result.depleted.shootItemIndex).toBe(-1);
    });

    test('T79: RuntimeConfig setzt Trainer-WebSocket-Flag standardmaessig auf false', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.createRuntimeConfigSnapshot) {
                throw new Error('CURVIOS_TEST_API.createRuntimeConfigSnapshot missing');
            }
            const { createRuntimeConfigSnapshot } = api;
            const snapshot = createRuntimeConfigSnapshot({});
            return {
                policyStrategy: String(snapshot?.bot?.policyStrategy || ''),
                policyType: String(snapshot?.bot?.policyType || ''),
                trainerBridgeEnabled: !!snapshot?.bot?.trainerBridgeEnabled,
                trainerBridgeUrl: String(snapshot?.bot?.trainerBridgeUrl || ''),
                trainerBridgeTimeoutMs: Number(snapshot?.bot?.trainerBridgeTimeoutMs || 0),
                trainerBridgeMaxRetries: Number(snapshot?.bot?.trainerBridgeMaxRetries || 0),
                trainerBridgeRetryDelayMs: Number(snapshot?.bot?.trainerBridgeRetryDelayMs || 0),
                trainerCheckpointResumeToken: String(snapshot?.bot?.trainerCheckpointResumeToken || ''),
                trainerCheckpointResumeStrict: !!snapshot?.bot?.trainerCheckpointResumeStrict,
            };
        });

        expect(result.policyStrategy).toBe('auto');
        expect(result.policyType).toBe('classic-3d');
        expect(result.trainerBridgeEnabled).toBeFalsy();
        expect(result.trainerBridgeUrl.startsWith('ws://')).toBeTruthy();
        expect(result.trainerBridgeTimeoutMs).toBeGreaterThanOrEqual(20);
        expect(result.trainerBridgeMaxRetries).toBeGreaterThanOrEqual(0);
        expect(result.trainerBridgeRetryDelayMs).toBeGreaterThanOrEqual(0);
        expect(result.trainerCheckpointResumeToken).toBe('');
        expect(result.trainerCheckpointResumeStrict).toBeFalsy();
    });

    test('T79b: RuntimeConfig uebernimmt botBridge Resume- und Retry-Settings reproduzierbar', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.createRuntimeConfigSnapshot) {
                throw new Error('CURVIOS_TEST_API.createRuntimeConfigSnapshot missing');
            }
            const { createRuntimeConfigSnapshot } = api;
            const snapshot = createRuntimeConfigSnapshot({
                botBridge: {
                    enabled: true,
                    url: 'ws://127.0.0.1:9001',
                    timeoutMs: 180,
                    maxRetries: 3,
                    retryDelayMs: 40,
                    resumeCheckpoint: 'latest',
                    resumeStrict: true,
                },
            });
            return {
                enabled: !!snapshot?.bot?.trainerBridgeEnabled,
                url: String(snapshot?.bot?.trainerBridgeUrl || ''),
                timeoutMs: Number(snapshot?.bot?.trainerBridgeTimeoutMs || 0),
                maxRetries: Number(snapshot?.bot?.trainerBridgeMaxRetries || 0),
                retryDelayMs: Number(snapshot?.bot?.trainerBridgeRetryDelayMs || 0),
                resumeToken: String(snapshot?.bot?.trainerCheckpointResumeToken || ''),
                resumeStrict: !!snapshot?.bot?.trainerCheckpointResumeStrict,
            };
        });

        expect(result.enabled).toBeTruthy();
        expect(result.url).toBe('ws://127.0.0.1:9001');
        expect(result.timeoutMs).toBe(180);
        expect(result.maxRetries).toBe(3);
        expect(result.retryDelayMs).toBe(40);
        expect(result.resumeToken).toBe('latest');
        expect(result.resumeStrict).toBeTruthy();
    });

    test('T80: ObservationBridgePolicy faellt bei Trainer-Timeout auf lokale Policy zurueck', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.ObservationBridgePolicy) {
                throw new Error('CURVIOS_TEST_API.ObservationBridgePolicy missing');
            }
            const { ObservationBridgePolicy } = api;
            const originalWebSocket = globalThis.WebSocket;
            let fallbackCalls = 0;

            class MockWebSocket {
                static CONNECTING = 0;
                static OPEN = 1;
                static CLOSING = 2;
                static CLOSED = 3;

                constructor() {
                    this.readyState = MockWebSocket.OPEN;
                    this._listeners = new Map();
                    setTimeout(() => this._emit('open', {}), 0);
                }

                addEventListener(type, handler) {
                    if (!this._listeners.has(type)) {
                        this._listeners.set(type, []);
                    }
                    this._listeners.get(type).push(handler);
                }

                removeEventListener(type, handler) {
                    const handlers = this._listeners.get(type) || [];
                    this._listeners.set(type, handlers.filter((entry) => entry !== handler));
                }

                _emit(type, event) {
                    const handlers = this._listeners.get(type) || [];
                    handlers.forEach((handler) => handler(event));
                }

                send() {
                    // intentionally no response to trigger timeout path
                }

                close() {
                    this.readyState = MockWebSocket.CLOSED;
                    this._emit('close', {});
                }
            }

            globalThis.WebSocket = MockWebSocket;
            try {
                const fallbackPolicy = {
                    type: 'rule-based',
                    update() {
                        fallbackCalls++;
                        return { yawLeft: true };
                    },
                };
                const policy = new ObservationBridgePolicy({
                    type: 'classic-bridge',
                    fallbackPolicy,
                    trainerBridgeEnabled: true,
                    trainerBridgeTimeoutMs: 8,
                    trainerBridgeUrl: 'ws://127.0.0.1:8765',
                });
                const bot = { index: 0, inventory: [] };
                const context = {
                    mode: 'classic',
                    dt: 1 / 60,
                    players: [],
                    projectiles: [],
                    observation: new Array(40).fill(0),
                };

                const firstAction = policy.update(1 / 60, bot, context);
                await new Promise((resolve) => setTimeout(resolve, 20));
                const secondAction = policy.update(1 / 60, bot, context);

                policy.reset();
                return {
                    firstYawLeft: !!firstAction?.yawLeft,
                    secondYawLeft: !!secondAction?.yawLeft,
                    fallbackCalls,
                };
            } finally {
                globalThis.WebSocket = originalWebSocket;
            }
        });

        expect(result.firstYawLeft).toBeTruthy();
        expect(result.secondYawLeft).toBeTruthy();
        expect(result.fallbackCalls).toBeGreaterThanOrEqual(2);
    });

    test('T80b: ObservationBridgePolicy faellt bei lokaler Inference ohne Vokabular auf Fallback zurueck', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.ObservationBridgePolicy) {
                throw new Error('CURVIOS_TEST_API.ObservationBridgePolicy missing');
            }
            const { ObservationBridgePolicy } = api;
            let fallbackCalls = 0;
            const fallbackPolicy = {
                type: 'rule-based',
                update() {
                    fallbackCalls += 1;
                    return { yawRight: true, boost: true };
                },
            };
            const policy = new ObservationBridgePolicy({
                type: 'classic-bridge',
                fallbackPolicy,
                trainerBridgeEnabled: false,
            });
            policy._localInference = {
                loaded: true,
                selectBestAction() {
                    return { actionIndex: 4 };
                },
            };
            policy._localInferenceVocabulary = null;

            const bot = { index: 0, inventory: [] };
            const context = {
                mode: 'classic',
                dt: 1 / 60,
                players: [],
                projectiles: [],
                observation: new Array(40).fill(0),
            };
            const action = policy.update(1 / 60, bot, context);
            return {
                fallbackCalls,
                yawRight: !!action?.yawRight,
                boost: !!action?.boost,
                yawLeft: !!action?.yawLeft,
            };
        });

        expect(result.fallbackCalls).toBeGreaterThanOrEqual(1);
        expect(result.yawRight).toBeTruthy();
        expect(result.boost).toBeTruthy();
        expect(result.yawLeft).toBeFalsy();
    });

    test('T80c: ObservationBridgePolicy injiziert Fallback-Lenkung bei lokaler No-Steer-Action', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.ObservationBridgePolicy) {
                throw new Error('CURVIOS_TEST_API.ObservationBridgePolicy missing');
            }
            const { ObservationBridgePolicy } = api;
            let fallbackCalls = 0;
            const fallbackPolicy = {
                type: 'rule-based',
                update() {
                    fallbackCalls += 1;
                    return { yawLeft: true };
                },
            };
            const policy = new ObservationBridgePolicy({
                type: 'classic-bridge',
                fallbackPolicy,
                trainerBridgeEnabled: false,
            });
            policy._localInference = {
                loaded: true,
                selectBestAction() {
                    return { actionIndex: 5 };
                },
            };
            policy._localInferenceVocabulary = {
                decode() {
                    return { boost: true };
                },
            };

            const bot = { index: 0, inventory: [] };
            const context = {
                mode: 'classic',
                dt: 1 / 60,
                players: [],
                projectiles: [],
                observation: new Array(40).fill(0.2),
            };
            const action = policy.update(1 / 60, bot, context);
            return {
                fallbackCalls,
                yawLeft: !!action?.yawLeft,
                boost: !!action?.boost,
                yawRight: !!action?.yawRight,
            };
        });

        expect(result.fallbackCalls).toBeGreaterThanOrEqual(1);
        expect(result.yawLeft).toBeTruthy();
        expect(result.boost).toBeTruthy();
        expect(result.yawRight).toBeFalsy();
    });

    test('T80d: ObservationBridgePolicy bevorzugt Steering statt lokaler boost-only Top-Action', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.ObservationBridgePolicy) {
                throw new Error('CURVIOS_TEST_API.ObservationBridgePolicy missing');
            }
            const { ObservationBridgePolicy } = api;
            let fallbackCalls = 0;
            const fallbackPolicy = {
                type: 'rule-based',
                update() {
                    fallbackCalls += 1;
                    return { yawRight: true };
                },
            };
            const policy = new ObservationBridgePolicy({
                type: 'classic-bridge',
                fallbackPolicy,
                trainerBridgeEnabled: false,
            });
            policy._localInference = {
                loaded: true,
                predict() {
                    const q = new Array(6).fill(0);
                    q[1] = 0.7; // steering candidate
                    q[5] = 1.0; // boost-only top action
                    return q;
                },
                selectBestAction() {
                    return { actionIndex: 5 };
                },
            };
            policy._localInferenceVocabulary = {
                decode(index) {
                    if (index === 5) return { boost: true };
                    if (index === 1) return { yawLeft: true };
                    return {};
                },
            };

            const bot = { index: 0, inventory: [] };
            const context = {
                mode: 'classic',
                dt: 1 / 60,
                players: [],
                projectiles: [],
                observation: new Array(40).fill(0.2),
            };
            const action = policy.update(1 / 60, bot, context);
            return {
                fallbackCalls,
                yawLeft: !!action?.yawLeft,
                boost: !!action?.boost,
                yawRight: !!action?.yawRight,
            };
        });

        expect(result.fallbackCalls).toBe(0);
        expect(result.yawLeft).toBeTruthy();
        expect(result.boost).toBeFalsy();
        expect(result.yawRight).toBeFalsy();
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

    test('T81: RuntimeConfig loest Bot-Policy-Strategie reproduzierbar nach Modus auf', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.createRuntimeConfigSnapshot) {
                throw new Error('CURVIOS_TEST_API.createRuntimeConfigSnapshot missing');
            }
            const { createRuntimeConfigSnapshot } = api;

            const classic3dAuto = createRuntimeConfigSnapshot({
                gameMode: 'CLASSIC',
                gameplay: { planarMode: false },
                botPolicyStrategy: 'auto',
            });
            const classic2dAuto = createRuntimeConfigSnapshot({
                gameMode: 'CLASSIC',
                gameplay: { planarMode: true },
                botPolicyStrategy: 'auto',
            });
            const hunt3dAuto = createRuntimeConfigSnapshot({
                gameMode: 'HUNT',
                gameplay: { planarMode: false },
                botPolicyStrategy: 'auto',
            });
            const hunt2dAuto = createRuntimeConfigSnapshot({
                gameMode: 'HUNT',
                gameplay: { planarMode: true },
                botPolicyStrategy: 'auto',
            });
            const classicBridge = createRuntimeConfigSnapshot({
                gameMode: 'CLASSIC',
                gameplay: { planarMode: true },
                botPolicyStrategy: 'bridge',
            });
            const huntBridge = createRuntimeConfigSnapshot({
                gameMode: 'HUNT',
                gameplay: { planarMode: true },
                botPolicyStrategy: 'bridge',
            });
            const forcedRuleBased = createRuntimeConfigSnapshot({
                gameMode: 'HUNT',
                gameplay: { planarMode: true },
                botPolicyStrategy: 'rule-based',
            });
            const invalidStrategy = createRuntimeConfigSnapshot({
                gameMode: 'CLASSIC',
                gameplay: { planarMode: true },
                botPolicyStrategy: 'unknown',
            });

            return {
                classic3dAuto: classic3dAuto?.bot?.policyType,
                classic2dAuto: classic2dAuto?.bot?.policyType,
                hunt3dAuto: hunt3dAuto?.bot?.policyType,
                hunt2dAuto: hunt2dAuto?.bot?.policyType,
                classicBridge: classicBridge?.bot?.policyType,
                huntBridge: huntBridge?.bot?.policyType,
                forcedRuleBased: forcedRuleBased?.bot?.policyType,
                invalidStrategyName: invalidStrategy?.bot?.policyStrategy,
                invalidStrategyPolicy: invalidStrategy?.bot?.policyType,
            };
        });

        expect(result.classic3dAuto).toBe('classic-3d');
        expect(result.classic2dAuto).toBe('classic-2d');
        expect(result.hunt3dAuto).toBe('hunt-3d');
        expect(result.hunt2dAuto).toBe('hunt-2d');
        expect(result.classicBridge).toBe('classic-bridge');
        expect(result.huntBridge).toBe('hunt-bridge');
        expect(result.forcedRuleBased).toBe('rule-based');
        expect(result.invalidStrategyName).toBe('auto');
        expect(result.invalidStrategyPolicy).toBe('classic-2d');
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
                game._onSettingsChanged();
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
            game._onSettingsChanged();
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

    test('T82c: Hunt-Bot nutzt nahe Special Gates als Retreat-Anker', async ({ page }) => {
        await loadGame(page);
        const result = await page.evaluate(async () => {
            const THREE = await import('three');
            const api = window.CURVIOS_TEST_API;
            if (!api?.HuntBotPolicy) {
                throw new Error('CURVIOS_TEST_API.HuntBotPolicy missing');
            }
            const { HuntBotPolicy } = api;

            const player = {
                id: 'hunt-bot',
                index: 0,
                alive: true,
                hp: 20,
                maxHp: 100,
                shieldHP: 0,
                maxShieldHp: 100,
                inventory: [],
                position: new THREE.Vector3(0, 0, 0),
                getDirection(out) {
                    return out.set(0, 0, 1);
                },
            };
            const enemy = {
                id: 'enemy',
                index: 1,
                alive: true,
                hp: 100,
                maxHp: 100,
                shieldHP: 0,
                maxShieldHp: 100,
                position: new THREE.Vector3(0, 0, 18),
            };
            const gate = {
                pos: new THREE.Vector3(-10, 0, 0),
                radius: 3,
                cooldowns: new Map(),
            };
            const policy = new HuntBotPolicy();
            policy._fallbackPolicy.update = () => ({
                yawLeft: false,
                yawRight: false,
                pitchUp: false,
                pitchDown: false,
                boost: false,
                shootMG: true,
                shootItem: false,
                shootItemIndex: -1,
            });
            policy._fallbackPolicy.getSensorSnapshot = () => ({
                targetYaw: 0.8,
                targetPitch: 0,
                pressure: 0.92,
                projectileThreat: true,
                targetPlayer: enemy,
                targetInFront: true,
                targetDistanceSq: enemy.position.lengthSq(),
            });

            const action = policy.update(1 / 60, player, {
                arena: { specialGates: [gate] },
                players: [player, enemy],
                projectiles: [],
                huntTarget: null,
            });

            return {
                boost: !!action?.boost,
                shootMG: !!action?.shootMG,
                yawLeft: !!action?.yawLeft,
                yawRight: !!action?.yawRight,
                shootItemIndex: Number(action?.shootItemIndex ?? -1),
            };
        });

        expect(result.boost).toBeTruthy();
        expect(result.shootMG).toBeFalsy();
        expect(result.yawLeft).toBeFalsy();
        expect(result.yawRight).toBeTruthy();
        expect(result.shootItemIndex).toBe(-1);
    });

});
