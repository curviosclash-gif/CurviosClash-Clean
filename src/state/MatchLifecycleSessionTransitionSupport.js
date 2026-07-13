import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { SESSION_RUNTIME_STATES } from '../shared/contracts/SessionRuntimeStateMachine.js';

export function completeSessionRuntimeMenuLifecycle(sessionRuntimeState, applyLifecycleTransition, completionEventType) {
    const targetState = sessionRuntimeState?.lifecycle?.disposed
        ? SESSION_RUNTIME_STATES.DISPOSED
        : SESSION_RUNTIME_STATES.MENU;
    const transition = applyLifecycleTransition(targetState, {
        gameStateId: GAME_STATE_IDS.MENU,
        completionEventType,
    });
    if (!transition || transition.nextState !== targetState) {
        const currentState = transition?.currentState || sessionRuntimeState?.lifecycle?.status || 'unknown';
        const transitionError = new Error(`session_runtime_menu_transition_blocked:${currentState}->${targetState}`);
        transitionError.code = 'SESSION_RUNTIME_MENU_TRANSITION_BLOCKED';
        throw transitionError;
    }
    return transition;
}
