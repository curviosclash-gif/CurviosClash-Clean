import { registerSessionMenuEventHandlers } from './SessionMenuEventHandlers.js';
import { registerPresetMenuEventHandlers } from './PresetMenuEventHandlers.js';
import { registerMultiplayerMenuEventHandlers } from './MultiplayerMenuEventHandlers.js';
import { registerDeveloperMenuEventHandlers } from './DeveloperMenuEventHandlers.js';
import { registerProfileMenuEventHandlers } from './ProfileMenuEventHandlers.js';

export function createMenuEventHandlerRegistry(facade) {
    const registry = new Map();
    registerSessionMenuEventHandlers(facade, registry);
    registerPresetMenuEventHandlers(facade, registry);
    registerMultiplayerMenuEventHandlers(facade, registry);
    registerDeveloperMenuEventHandlers(facade, registry);
    registerProfileMenuEventHandlers(facade, registry);
    return registry;
}
