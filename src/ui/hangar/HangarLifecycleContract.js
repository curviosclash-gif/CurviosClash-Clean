import {
    HANGAR_CAPABILITY_IDS,
    HANGAR_NAV_EVENTS,
    resolveHangarMode,
    resolveHangarUserFlow,
} from '../../shared/contracts/HangarModeContract.js';
import {
    HANGAR_SELECTION_WRITEBACK_PATHS,
    HANGAR_SELECTION_WRITEBACK_VERSION,
    resolveHangarSelectionDataSpace,
} from './HangarSelectionWritebackContract.js';

export const HANGAR_LIFECYCLE_CONTRACT_VERSION = 'hangar-lifecycle.v1';

function createLifecycleTransition(transitionId, action, navEvent, capabilityId, description) {
    return Object.freeze({
        transitionId,
        action,
        navEvent,
        capabilityId,
        description,
    });
}

export function resolveHangarLifecycleContract(rawMode) {
    const mode = resolveHangarMode(rawMode);
    const flow = resolveHangarUserFlow(mode);
    const dataSpace = resolveHangarSelectionDataSpace(mode);
    return Object.freeze({
        contractVersion: HANGAR_LIFECYCLE_CONTRACT_VERSION,
        mode,
        dataSpace: flow.dataSpace,
        startNavEvent: flow.startNavEvent,
        writeback: Object.freeze({
            source: 'settings.vehicles',
            contractVersion: HANGAR_SELECTION_WRITEBACK_VERSION,
            pathMap: HANGAR_SELECTION_WRITEBACK_PATHS,
            dataSpace,
        }),
        transitions: Object.freeze([
            createLifecycleTransition(
                'open_hangar_from_menu',
                'open_hangar',
                flow.startNavEvent,
                HANGAR_CAPABILITY_IDS.OPEN_HANGAR,
                'Desktop main menu enters hangar through a single open capability.'
            ),
            createLifecycleTransition(
                'open_workshop_from_hangar',
                'open_workshop',
                HANGAR_NAV_EVENTS.OPEN_WORKSHOP,
                HANGAR_CAPABILITY_IDS.NAVIGATE_TO_WORKSHOP,
                'Hangar opens workshop as internal desktop view switch.'
            ),
            createLifecycleTransition(
                'return_from_workshop_to_hangar',
                'return_to_hangar',
                HANGAR_NAV_EVENTS.CLOSE_WORKSHOP,
                HANGAR_CAPABILITY_IDS.NAVIGATE_FROM_WORKSHOP,
                'Workshop returns into hangar through a single navigation capability.'
            ),
            createLifecycleTransition(
                'start_match_from_hangar',
                'start_match',
                HANGAR_NAV_EVENTS.START_MATCH,
                HANGAR_CAPABILITY_IDS.MATCH_START_FROM_HANGAR,
                'Hangar starts match only after writeback through settings.vehicles contract path.'
            ),
            createLifecycleTransition(
                'return_to_menu',
                'return_to_menu',
                HANGAR_NAV_EVENTS.RETURN_TO_MENU,
                HANGAR_CAPABILITY_IDS.RETURN_TO_MENU,
                'Hangar or workshop exits through a single desktop lifecycle return capability.'
            ),
        ]),
    });
}

