/**
 * HangarModeContract — V76 76.1
 *
 * Desktop Hangar architecture contract. Defines:
 *  - ARCADE vs FIGHT mode separation (76.1.2)
 *  - Preload capability IDs exposed to renderer (76.1.1)
 *  - Desktop navigation event types — no window.open() (76.1.3)
 *  - Integration policy: all hangar/workshop access via named IPC capabilities
 *
 * Leitplanke: electron/main.cjs owns window/navigation/persistence lifecycle.
 * electron/preload.cjs is the sole bridge via small named capability contracts.
 * Hangar renderer and workshop must not import electron directly, call
 * window.open(), or bypass defined capability ports.
 */

export const HANGAR_MODE_CONTRACT_VERSION = 'hangar-mode.v2';

// ─── Hangar Modes ───
// Arcade and Fight are strictly separate flows: different rule contracts,
// different data spaces, different start paths. Shared UI shell only.

export const HANGAR_MODES = Object.freeze({
    ARCADE: 'arcade',
    FIGHT: 'fight',
});

// ─── Desktop Capability IDs (Preload Bridge) ───
// Named capability IDs for electron/preload.cjs to expose to renderer.
// Renderer code uses only these names — never electron IPC channel strings.

export const HANGAR_CAPABILITY_IDS = Object.freeze({
    OPEN_HANGAR: 'hangar:open',
    CLOSE_HANGAR: 'hangar:close',
    NAVIGATE_TO_WORKSHOP: 'hangar:navigate-to-workshop',
    NAVIGATE_FROM_WORKSHOP: 'hangar:navigate-from-workshop',
    LOAD_VEHICLE_SELECTION: 'hangar:load-vehicle-selection',
    SAVE_VEHICLE_SELECTION: 'hangar:save-vehicle-selection',
    LOAD_CUSTOM_BLUEPRINT: 'hangar:load-custom-blueprint',
    SAVE_CUSTOM_BLUEPRINT: 'hangar:save-custom-blueprint',
    DELETE_CUSTOM_BLUEPRINT: 'hangar:delete-custom-blueprint',
    RENAME_CUSTOM_BLUEPRINT: 'hangar:rename-custom-blueprint',
    HANGAR_READY: 'hangar:ready',
    MATCH_START_FROM_HANGAR: 'hangar:match-start',
    RETURN_TO_MENU: 'hangar:return-to-menu',
});

// ─── Navigation Events ───
// Renderer emits these via preload capability; main.cjs handles BrowserWindow
// state in response. No direct window.open() or global navigation in renderer.

export const HANGAR_NAV_EVENTS = Object.freeze({
    OPEN_ARCADE_HANGAR: 'hangar_nav:open_arcade',
    OPEN_FIGHT_HANGAR: 'hangar_nav:open_fight',
    OPEN_WORKSHOP: 'hangar_nav:open_workshop',
    CLOSE_WORKSHOP: 'hangar_nav:close_workshop',
    START_MATCH: 'hangar_nav:start_match',
    RETURN_TO_MENU: 'hangar_nav:return_to_menu',
});

export const HANGAR_DESKTOP_LOOP_CONTRACT_VERSION = 'hangar-desktop-loop.v1';

export const HANGAR_DESKTOP_LOOP_STEP_IDS = Object.freeze({
    RUN: 'run',
    HANGAR: 'hangar',
    WORKSHOP: 'workshop',
    RETURN: 'return',
});

const VALID_HANGAR_DESKTOP_LOOP_STEP_SET = new Set(Object.values(HANGAR_DESKTOP_LOOP_STEP_IDS));

function createLoopTransition(actionId, navEvent, capabilityId, nextStepId, description) {
    return Object.freeze({
        actionId,
        navEvent,
        capabilityId,
        nextStepId,
        description,
    });
}

function createLoopStep(stepId, title, description, transitions = []) {
    return Object.freeze({
        stepId,
        title,
        description,
        transitions: Object.freeze([...(Array.isArray(transitions) ? transitions : [])]),
    });
}

export const ARCADE_HANGAR_DESKTOP_LOOP = Object.freeze({
    contractVersion: HANGAR_DESKTOP_LOOP_CONTRACT_VERSION,
    mode: HANGAR_MODES.ARCADE,
    entryStepId: HANGAR_DESKTOP_LOOP_STEP_IDS.RUN,
    loopPath: Object.freeze([
        HANGAR_DESKTOP_LOOP_STEP_IDS.RUN,
        HANGAR_DESKTOP_LOOP_STEP_IDS.HANGAR,
        HANGAR_DESKTOP_LOOP_STEP_IDS.WORKSHOP,
        HANGAR_DESKTOP_LOOP_STEP_IDS.HANGAR,
        HANGAR_DESKTOP_LOOP_STEP_IDS.RETURN,
    ]),
    steps: Object.freeze({
        [HANGAR_DESKTOP_LOOP_STEP_IDS.RUN]: createLoopStep(
            HANGAR_DESKTOP_LOOP_STEP_IDS.RUN,
            'Arcade Run',
            'Gameplay run executes in runtime and always returns to the desktop hangar surface.',
            [
                createLoopTransition(
                    'run_complete_to_hangar',
                    HANGAR_NAV_EVENTS.OPEN_ARCADE_HANGAR,
                    HANGAR_CAPABILITY_IDS.OPEN_HANGAR,
                    HANGAR_DESKTOP_LOOP_STEP_IDS.HANGAR,
                    'After run end, open arcade hangar as deterministic return anchor.'
                ),
            ]
        ),
        [HANGAR_DESKTOP_LOOP_STEP_IDS.HANGAR]: createLoopStep(
            HANGAR_DESKTOP_LOOP_STEP_IDS.HANGAR,
            'Arcade Hangar',
            'Primary desktop hub for progression review, loadout updates and next navigation decision.',
            [
                createLoopTransition(
                    'open_workshop_from_hangar',
                    HANGAR_NAV_EVENTS.OPEN_WORKSHOP,
                    HANGAR_CAPABILITY_IDS.NAVIGATE_TO_WORKSHOP,
                    HANGAR_DESKTOP_LOOP_STEP_IDS.WORKSHOP,
                    'Open workshop via desktop capability without global navigation.'
                ),
                createLoopTransition(
                    'start_next_run',
                    HANGAR_NAV_EVENTS.START_MATCH,
                    HANGAR_CAPABILITY_IDS.MATCH_START_FROM_HANGAR,
                    HANGAR_DESKTOP_LOOP_STEP_IDS.RUN,
                    'Start next run from curated hangar selection.'
                ),
                createLoopTransition(
                    'return_to_menu',
                    HANGAR_NAV_EVENTS.RETURN_TO_MENU,
                    HANGAR_CAPABILITY_IDS.RETURN_TO_MENU,
                    HANGAR_DESKTOP_LOOP_STEP_IDS.RETURN,
                    'Leave arcade loop and hand control back to main desktop menu.'
                ),
            ]
        ),
        [HANGAR_DESKTOP_LOOP_STEP_IDS.WORKSHOP]: createLoopStep(
            HANGAR_DESKTOP_LOOP_STEP_IDS.WORKSHOP,
            'Workshop',
            'Vehicle lab customization runs as bounded sub-surface and commits back into hangar state.',
            [
                createLoopTransition(
                    'close_workshop_to_hangar',
                    HANGAR_NAV_EVENTS.CLOSE_WORKSHOP,
                    HANGAR_CAPABILITY_IDS.NAVIGATE_FROM_WORKSHOP,
                    HANGAR_DESKTOP_LOOP_STEP_IDS.HANGAR,
                    'Close workshop and return to hangar without leaving desktop flow.'
                ),
            ]
        ),
        [HANGAR_DESKTOP_LOOP_STEP_IDS.RETURN]: createLoopStep(
            HANGAR_DESKTOP_LOOP_STEP_IDS.RETURN,
            'Menu Return',
            'Exit node for deterministic handoff back to the desktop menu lifecycle.',
            []
        ),
    }),
});

// ─── User Flow Descriptors (76.1.2) ───
// Arcade and Fight share UI components but not rule contracts, data spaces,
// or start paths. Each flow references its own rule contract by name.

export const HANGAR_USER_FLOW_DESCRIPTORS = Object.freeze({
    [HANGAR_MODES.ARCADE]: Object.freeze({
        mode: HANGAR_MODES.ARCADE,
        ruleContract: 'ArcadeHangarRulesContract',
        dataSpace: 'settings.vehicles.arcade',
        persistenceKey: 'cuviosclash.hangar.arcade.v1',
        startNavEvent: HANGAR_NAV_EVENTS.OPEN_ARCADE_HANGAR,
        workshopAllowed: true,
        progressionDriven: true,
        freeRulesAllowed: false,
    }),
    [HANGAR_MODES.FIGHT]: Object.freeze({
        mode: HANGAR_MODES.FIGHT,
        ruleContract: 'FightHangarBalanceContract',
        dataSpace: 'settings.vehicles.fight',
        persistenceKey: 'cuviosclash.hangar.fight.v1',
        startNavEvent: HANGAR_NAV_EVENTS.OPEN_FIGHT_HANGAR,
        workshopAllowed: true,
        progressionDriven: false,
        freeRulesAllowed: true,
    }),
});

// ─── Desktop Integration Policy (76.1.3) ───
// Enforces that hangar and workshop integration uses named desktop-navigation
// ports only. window.open() and direct Electron access are forbidden in renderer.

export const HANGAR_DESKTOP_INTEGRATION_POLICY = Object.freeze({
    noWindowOpen: true,
    noDirectElectronAccess: true,
    noGlobalBackdoors: true,
    navigationVia: 'ipc-capability',
    persistenceVia: 'named-capability',
    surfaceGuardRequired: true,
});

// ─── Guard Helpers ───

export function resolveHangarMode(rawMode) {
    const normalized = String(rawMode || '').trim().toLowerCase();
    if (Object.values(HANGAR_MODES).includes(normalized)) return normalized;
    return HANGAR_MODES.FIGHT;
}

export function resolveHangarUserFlow(mode) {
    const resolved = resolveHangarMode(mode);
    return HANGAR_USER_FLOW_DESCRIPTORS[resolved] || HANGAR_USER_FLOW_DESCRIPTORS[HANGAR_MODES.FIGHT];
}

export function assertHangarCapabilityId(rawId) {
    const id = String(rawId || '').trim();
    return new Set(Object.values(HANGAR_CAPABILITY_IDS)).has(id) ? id : null;
}

export function assertHangarNavEvent(rawEvent) {
    const ev = String(rawEvent || '').trim();
    return new Set(Object.values(HANGAR_NAV_EVENTS)).has(ev) ? ev : null;
}

export function assertHangarDesktopLoopStepId(rawStepId) {
    const stepId = String(rawStepId || '').trim().toLowerCase();
    return VALID_HANGAR_DESKTOP_LOOP_STEP_SET.has(stepId) ? stepId : null;
}

export function resolveArcadeHangarDesktopLoop() {
    const clonedSteps = Object.values(ARCADE_HANGAR_DESKTOP_LOOP.steps).map((step) => ({
        stepId: step.stepId,
        title: step.title,
        description: step.description,
        transitions: step.transitions.map((transition) => ({
            actionId: transition.actionId,
            navEvent: transition.navEvent,
            capabilityId: transition.capabilityId,
            nextStepId: transition.nextStepId,
            description: transition.description,
        })),
    }));
    return {
        contractVersion: ARCADE_HANGAR_DESKTOP_LOOP.contractVersion,
        mode: ARCADE_HANGAR_DESKTOP_LOOP.mode,
        entryStepId: ARCADE_HANGAR_DESKTOP_LOOP.entryStepId,
        loopPath: [...ARCADE_HANGAR_DESKTOP_LOOP.loopPath],
        steps: clonedSteps,
    };
}

export function resolveHangarDesktopLoop(rawMode) {
    const mode = resolveHangarMode(rawMode);
    if (mode === HANGAR_MODES.ARCADE) return resolveArcadeHangarDesktopLoop();
    return null;
}
