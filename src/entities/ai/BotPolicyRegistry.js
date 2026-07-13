// ============================================
// BotPolicyRegistry.js - policy factory registry for bot controllers
// ============================================

import {
    assertBotPolicyContract,
    BOT_POLICY_TYPES,
    DEFAULT_BOT_POLICY_TYPE,
    normalizeBotPolicyType,
} from './BotPolicyTypes.js';
import { RuleBasedBotPolicy } from './RuleBasedBotPolicy.js';
import { HeuristicBotPolicy } from './HeuristicBotPolicy.js';
import { HuntBotPolicy } from '../../hunt/HuntBotPolicy.js';
import { ClassicBridgePolicy } from './ClassicBridgePolicy.js';
import { HuntBridgePolicy } from './HuntBridgePolicy.js';
import { createLogger } from '../../shared/logging/Logger.js';

const logger = createLogger('BotPolicyRegistry');

function createClassicBridgeFactory(type) {
    return (options = {}) => new ClassicBridgePolicy({
        ...options,
        type,
        fallbackPolicy: options.fallbackPolicy || new RuleBasedBotPolicy(options),
    });
}

function createHuntBridgeFactory(type) {
    return (options = {}) => new HuntBridgePolicy({
        ...options,
        type,
        fallbackPolicy: options.fallbackPolicy || new HuntBotPolicy(options),
    });
}

export class BotPolicyRegistry {
    constructor() {
        this._factories = new Map();
        this._creationLogCache = new Set();
        this.register(BOT_POLICY_TYPES.RULE_BASED, (options) => new RuleBasedBotPolicy(options));
        this.register(BOT_POLICY_TYPES.HEURISTIC, (options) => new HeuristicBotPolicy(options));
        this.register(BOT_POLICY_TYPES.HUNT, (options) => new HuntBotPolicy(options));
        this.register(BOT_POLICY_TYPES.CLASSIC_BRIDGE, createClassicBridgeFactory(BOT_POLICY_TYPES.CLASSIC_BRIDGE));
        this.register(BOT_POLICY_TYPES.HUNT_BRIDGE, createHuntBridgeFactory(BOT_POLICY_TYPES.HUNT_BRIDGE));
        this.register(BOT_POLICY_TYPES.CLASSIC_3D, createClassicBridgeFactory(BOT_POLICY_TYPES.CLASSIC_3D));
        this.register(BOT_POLICY_TYPES.CLASSIC_2D, createClassicBridgeFactory(BOT_POLICY_TYPES.CLASSIC_2D));
        this.register(BOT_POLICY_TYPES.HUNT_3D, createHuntBridgeFactory(BOT_POLICY_TYPES.HUNT_3D));
        this.register(BOT_POLICY_TYPES.HUNT_2D, createHuntBridgeFactory(BOT_POLICY_TYPES.HUNT_2D));
    }

    register(type, factory) {
        if (typeof factory !== 'function') {
            throw new Error(`[BotPolicyRegistry] Invalid factory for policy "${type}"`);
        }
        const normalizedType = normalizeBotPolicyType(type);
        this._factories.set(normalizedType, factory);
        return this;
    }

    _logCreateResult(requestedType, resolvedType, fallbackReason = null) {
        const cacheKey = `${requestedType}|${resolvedType}|${fallbackReason || 'none'}`;
        if (this._creationLogCache.has(cacheKey)) return;
        this._creationLogCache.add(cacheKey);

        if (fallbackReason) {
            logger.warn(`requested=${requestedType} resolved=${resolvedType} fallback=${fallbackReason}`);
        }
    }

    _resolveFactory(type) {
        const requestedType = normalizeBotPolicyType(type);
        let resolvedType = requestedType;
        let fallbackReason = null;

        let factory = this._factories.get(resolvedType);
        if (!factory) {
            resolvedType = DEFAULT_BOT_POLICY_TYPE;
            factory = this._factories.get(resolvedType);
            if (!fallbackReason) {
                fallbackReason = 'factory-missing';
            }
        }

        return {
            requestedType,
            resolvedType,
            fallbackReason,
            factory,
        };
    }

    create(type, options = {}) {
        const resolved = this._resolveFactory(type);
        let factory = resolved.factory;
        if (!factory) {
            throw new Error('[BotPolicyRegistry] No default bot policy registered');
        }

        let policy = null;
        let resolvedType = resolved.resolvedType;
        let fallbackReason = resolved.fallbackReason;
        try {
            policy = factory(options);
        } catch (error) {
            if (resolvedType !== DEFAULT_BOT_POLICY_TYPE) {
                resolvedType = DEFAULT_BOT_POLICY_TYPE;
                fallbackReason = fallbackReason || 'factory-error';
                factory = this._factories.get(DEFAULT_BOT_POLICY_TYPE);
                if (!factory) {
                    throw new Error('[BotPolicyRegistry] No default bot policy registered');
                }
                policy = factory(options);
            } else {
                throw error;
            }
        }

        this._logCreateResult(resolved.requestedType, resolvedType, fallbackReason);
        return assertBotPolicyContract(policy, resolvedType);
    }
}
