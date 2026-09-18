import { createNeutralBotAction } from './actions/BotActionContract.js';

/** Borrow the current bot policy's avoidance while the owner steers a rocket. */
export function createDefensiveGuidedPolicy(base) {
    const safeAction = createNeutralBotAction({});
    return {
        guidedDefensivePolicy: true,
        type: base?.type || 'heuristic',
        usesRuntimeContext: base?.usesRuntimeContext === true,
        requiresObservation: base?.requiresObservation === true,
        usesObservation: base?.usesObservation === true,
        sensePhase: 0,
        update(dt, player, contextOrArena, allPlayers, projectiles) {
            const action = createNeutralBotAction(safeAction);
            Object.assign(action, base?.update?.(dt, player, contextOrArena, allPlayers, projectiles) || {});
            action.shootItem = false;
            action.shootRocket = false;
            action.shootMG = false;
            action.dropItem = false;
            action.nextItem = false;
            action.cameraSwitch = false;
            action.useItem = -1;
            action.shootItemIndex = -1;
            return action;
        },
    };
}

export function beginGuidedRocketAutopilot(player) {
    if (!player || player.autopilotActive) return;
    player.autopilotActive = true;
    const manager = player.entityManager;
    if (!manager?.botByPlayer || !manager?.botPolicyRegistry) return;
    const base = manager.botPolicyRegistry.create('heuristic', {
        difficulty: manager.botDifficulty,
        heuristicProfile: 'defensive',
        runtimeConfig: manager.runtimeConfig,
        entityRuntimeConfig: manager.entityRuntimeConfig,
        activeGameMode: manager.combatModeType,
        runtimeRng: manager.runtimeRng,
    });
    manager.botByPlayer.set(player, createDefensiveGuidedPolicy(base));
}

export function endGuidedRocketAutopilot(player) {
    if (!player) return;
    player.autopilotActive = false;
    const policies = player.entityManager?.botByPlayer;
    if (policies?.get(player)?.guidedDefensivePolicy === true) policies.delete(player);
}

export function routeGuidedRocketOwnerInput(manager, player, dt, inputManager, emptyInput) {
    const includeSecondaryBindings = manager?.humanPlayers?.length === 1 && player.index === 0;
    const input = inputManager?.getPlayerInput?.(player.index, { includeSecondaryBindings, dt });
    manager?._projectileSystem?.applyGuidedInput?.(player, input);
    return emptyInput;
}
