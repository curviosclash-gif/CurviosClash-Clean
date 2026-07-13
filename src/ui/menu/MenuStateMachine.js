export const MENU_STATE_IDS = Object.freeze({
    MAIN: 'main',
    PATH: 'path',
    START_SETUP: 'start_setup',
    QUICKSTART: 'quickstart',
    CUSTOM: 'custom',
    MULTIPLAYER: 'multiplayer',
    DEVELOPER: 'developer',
    SETTINGS: 'settings',
    CONTROLS: 'controls',
    PROFILES: 'profiles',
    PORTALS: 'portals',
    DEBUG: 'debug',
});

const CUSTOM_FLOW_STATE_SET = new Set([
    MENU_STATE_IDS.PATH,
    MENU_STATE_IDS.START_SETUP,
    MENU_STATE_IDS.CUSTOM,
    MENU_STATE_IDS.SETTINGS,
    MENU_STATE_IDS.CONTROLS,
    MENU_STATE_IDS.PROFILES,
    MENU_STATE_IDS.PORTALS,
]);

function normalizeStateId(value, fallback = MENU_STATE_IDS.MAIN) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function createDefaultTransitionMap() {
    return new Map([
        [MENU_STATE_IDS.MAIN, new Set([
            MENU_STATE_IDS.MAIN,
            MENU_STATE_IDS.QUICKSTART,
            MENU_STATE_IDS.PATH,
            MENU_STATE_IDS.START_SETUP,
            MENU_STATE_IDS.CUSTOM,
            MENU_STATE_IDS.SETTINGS,
            MENU_STATE_IDS.CONTROLS,
            MENU_STATE_IDS.PROFILES,
            MENU_STATE_IDS.PORTALS,
            MENU_STATE_IDS.MULTIPLAYER,
            MENU_STATE_IDS.DEVELOPER,
            MENU_STATE_IDS.DEBUG,
        ])],
        [MENU_STATE_IDS.QUICKSTART, new Set([
            MENU_STATE_IDS.MAIN,
            MENU_STATE_IDS.QUICKSTART,
            MENU_STATE_IDS.PATH,
            MENU_STATE_IDS.START_SETUP,
            MENU_STATE_IDS.CUSTOM,
            MENU_STATE_IDS.SETTINGS,
            MENU_STATE_IDS.CONTROLS,
            MENU_STATE_IDS.PROFILES,
            MENU_STATE_IDS.PORTALS,
            MENU_STATE_IDS.MULTIPLAYER,
            MENU_STATE_IDS.DEVELOPER,
            MENU_STATE_IDS.DEBUG,
        ])],
        [MENU_STATE_IDS.MULTIPLAYER, new Set([
            MENU_STATE_IDS.MAIN,
            MENU_STATE_IDS.QUICKSTART,
            MENU_STATE_IDS.PATH,
            MENU_STATE_IDS.START_SETUP,
            MENU_STATE_IDS.MULTIPLAYER,
            MENU_STATE_IDS.DEBUG,
        ])],
        [MENU_STATE_IDS.DEVELOPER, new Set([
            MENU_STATE_IDS.MAIN,
            MENU_STATE_IDS.QUICKSTART,
            MENU_STATE_IDS.PATH,
            MENU_STATE_IDS.START_SETUP,
            MENU_STATE_IDS.DEVELOPER,
            MENU_STATE_IDS.DEBUG,
        ])],
        [MENU_STATE_IDS.DEBUG, new Set([
            MENU_STATE_IDS.MAIN,
            MENU_STATE_IDS.QUICKSTART,
            MENU_STATE_IDS.CUSTOM,
            MENU_STATE_IDS.MULTIPLAYER,
            MENU_STATE_IDS.DEVELOPER,
            MENU_STATE_IDS.DEBUG,
        ])],
    ]);
}

function canTransitionInCustomFlow(fromState, toState) {
    if (!CUSTOM_FLOW_STATE_SET.has(fromState)) return false;
    return CUSTOM_FLOW_STATE_SET.has(toState) || toState === MENU_STATE_IDS.MAIN || toState === MENU_STATE_IDS.QUICKSTART;
}

export class MenuStateMachine {
    constructor(options = {}) {
        this.currentState = normalizeStateId(options.initialState, MENU_STATE_IDS.MAIN);
        this.transitionMap = createDefaultTransitionMap();
        this.history = [];
    }

    getState() {
        return this.currentState;
    }

    canTransition(nextState) {
        const targetState = normalizeStateId(nextState, '');
        if (!targetState) return false;
        if (targetState === this.currentState) return true;

        const directTransitions = this.transitionMap.get(this.currentState);
        if (directTransitions && directTransitions.has(targetState)) {
            return true;
        }

        return canTransitionInCustomFlow(this.currentState, targetState);
    }

    transition(nextState, metadata = null) {
        const targetState = normalizeStateId(nextState, MENU_STATE_IDS.MAIN);
        if (!this.canTransition(targetState)) {
            return {
                changed: false,
                blocked: true,
                previousState: this.currentState,
                state: this.currentState,
            };
        }

        const previousState = this.currentState;
        this.currentState = targetState;

        this.history.push({
            at: Date.now(),
            previousState,
            state: this.currentState,
            metadata: metadata && typeof metadata === 'object' ? { ...metadata } : null,
        });
        if (this.history.length > 60) {
            this.history.shift();
        }

        return {
            changed: previousState !== this.currentState,
            blocked: false,
            previousState,
            state: this.currentState,
        };
    }

    reset() {
        this.currentState = MENU_STATE_IDS.MAIN;
    }

    getHistory() {
        return this.history.slice();
    }
}
