// ============================================
// GameModeRegistry.js - factory for game mode strategies
// ============================================

import { GAME_MODE_TYPES } from '../hunt/HuntMode.js';
import { ClassicModeStrategy } from './ClassicModeStrategy.js';
import { HuntModeStrategy } from './HuntModeStrategy.js';
import { ArcadeModeStrategy } from './ArcadeModeStrategy.js';

const FACTORIES = {
    [GAME_MODE_TYPES.CLASSIC]: (options = {}) => new ClassicModeStrategy(options),
    [GAME_MODE_TYPES.HUNT]: (options = {}) => new HuntModeStrategy(options),
    [GAME_MODE_TYPES.ARCADE]: (options = {}) => new ArcadeModeStrategy(options),
};

export function createGameModeStrategy(modeType, options = {}) {
    const normalized = String(modeType || '').trim().toUpperCase();
    const factory = FACTORIES[normalized] || FACTORIES[GAME_MODE_TYPES.CLASSIC];
    return factory(options);
}

export function registerGameModeStrategy(modeType, factoryFn) {
    FACTORIES[String(modeType || '').trim().toUpperCase()] = factoryFn;
}
