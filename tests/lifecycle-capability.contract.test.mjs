/**
 * Lifecycle- und Capability-Contract-Tests (V91 91.4)
 *
 * Deckt kritische Architekturbegriffe ab:
 * - 91.4.1: return_to_menu, match_finalized -> menu_opened, Finalize-Blocking,
 *           Capability-Fallbacks gegen denselben Shared-Contract-Vertrag
 * - 91.4.2: Snapshotgetriebenes UI-Gating, Surface-Blocked-Feedback und
 *           degradierte Capability-Pfade ohne Reach-Through auf rohe Plattformobjekte
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SESSION_FINALIZE_TRIGGERS,
    MATCH_LIFECYCLE_EVENT_TYPES,
} from '../src/shared/contracts/MatchLifecycleContract.js';
import {
    SESSION_RUNTIME_EVENT_TYPES,
    createSessionRuntimeEvent,
    normalizeSessionRuntimeEvent,
} from '../src/shared/contracts/SessionRuntimeEventContract.js';
import {
    SESSION_RUNTIME_STATES,
    applySessionRuntimeLifecycleTransition,
    canTransitionSessionRuntimeState,
    ensureSessionRuntimeLifecycleState,
} from '../src/shared/contracts/SessionRuntimeStateMachine.js';
import {
    createSessionRuntimeSnapshot,
    createMatchFlowSnapshot,
    createRuntimeObservabilitySnapshot,
} from '../src/shared/contracts/SessionRuntimeSnapshotContract.js';
import {
    PLATFORM_CAPABILITY_IDS,
    createPlatformCapabilityDescriptor,
    createPlatformCapabilitySnapshot,
} from '../src/shared/contracts/PlatformCapabilityContract.js';
import {
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_PROVIDER_KINDS,
    resolveSurfaceCapabilityAccess,
} from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import {
    resolveSurfaceBlockedFeatureFeedback,
    isSurfaceModePathAllowed,
    PLATFORM_SURFACE_FEATURE_IDS,
    resolveSurfaceFeatureClassification,
    resolveSurfaceMultiplayerGateAccess,
} from '../src/shared/contracts/PlatformSurfacePolicyOps.js';
import {
    canExecutePauseOverlayIntent,
    createPauseOverlayIntentLease,
    PAUSE_OVERLAY_INTENT_TYPES,
} from '../src/shared/runtime/UiIntentAtomicity.js';
import { resolveSurfaceFeatureLaunchGuard } from '../src/ui/menu/MenuSurfaceFeatureAccess.js';

// ---- 91.4.1: Lifecycle-Contract-Tests ----

test('SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU ist ein stabiler Vertragswert', () => {
    assert.equal(SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU, 'return_to_menu');
    assert.equal(MATCH_LIFECYCLE_EVENT_TYPES.MENU_OPENED, 'menu_opened');
});

test('match_finalized und menu_opened sind separate, geordnete Event-Typen im Shared-Contract', () => {
    assert.equal(SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED, 'match_finalized');
    assert.equal(SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED, 'menu_opened');
    // MATCH_FINALIZED muss im Enum vor MENU_OPENED stehen (Reihenfolge der Deklaration)
    const eventKeys = Object.keys(SESSION_RUNTIME_EVENT_TYPES);
    const finalizedIdx = eventKeys.indexOf('MATCH_FINALIZED');
    const menuOpenedIdx = eventKeys.indexOf('MENU_OPENED');
    assert.ok(finalizedIdx < menuOpenedIdx, 'MATCH_FINALIZED muss vor MENU_OPENED deklariert sein');
});

test('Finalize-Blocking: FINALIZING -> MENU ist ohne match_finalized-Completion blockiert', () => {
    const sessionRuntime = { lifecycle: { status: SESSION_RUNTIME_STATES.FINALIZING } };
    ensureSessionRuntimeLifecycleState(sessionRuntime);

    // Transition ohne Finalize-Completion-Flag muss abgelehnt werden
    const result = applySessionRuntimeLifecycleTransition(
        sessionRuntime,
        SESSION_RUNTIME_STATES.MENU
    );

    assert.equal(result?.changed, false, 'Transition soll nicht erfolgen ohne Finalize-Completion');
    assert.equal(result?.currentState, SESSION_RUNTIME_STATES.FINALIZING);
});

test('Finalize-Blocking: FINALIZING -> MENU ist mit match_finalized-Completion erlaubt', () => {
    const sessionRuntime = {
        lifecycle: { status: SESSION_RUNTIME_STATES.FINALIZING },
        finalize: { status: 'finalized' },
    };
    ensureSessionRuntimeLifecycleState(sessionRuntime);

    const result = applySessionRuntimeLifecycleTransition(
        sessionRuntime,
        SESSION_RUNTIME_STATES.MENU,
        { completionEventType: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED }
    );

    assert.equal(result?.changed, true, 'Transition soll nach Finalize-Completion erfolgen');
    assert.equal(result?.nextState, SESSION_RUNTIME_STATES.MENU);
});

test('Finalize-Blocking: FINALIZING -> DISPOSED ist immer erlaubt (Notfall-Dispose)', () => {
    const sessionRuntime = { lifecycle: { status: SESSION_RUNTIME_STATES.FINALIZING } };
    ensureSessionRuntimeLifecycleState(sessionRuntime);

    const result = applySessionRuntimeLifecycleTransition(
        sessionRuntime,
        SESSION_RUNTIME_STATES.DISPOSED,
        { disposed: true, allowFromAny: true }
    );

    assert.equal(result?.nextState, SESSION_RUNTIME_STATES.DISPOSED);
});

test('return_to_menu Lease blockiert stale Snapshot und finalize race', () => {
    const lease = createPauseOverlayIntentLease({
        sessionId: 'session-a',
        updatedAt: 17,
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'paused',
        finalizeState: 'idle',
    }, PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU);
    assert.ok(lease);

    assert.equal(canExecutePauseOverlayIntent({
        sessionId: 'session-a',
        updatedAt: 17,
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'paused',
        finalizeState: 'finalizing',
    }, lease, PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU), false);

    assert.equal(canExecutePauseOverlayIntent({
        sessionId: 'session-a',
        updatedAt: 18,
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'paused',
        finalizeState: 'idle',
    }, lease, PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU), false);

    assert.equal(canExecutePauseOverlayIntent({
        sessionId: 'session-a',
        updatedAt: 17,
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'paused',
        finalizeState: 'idle',
    }, lease, PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU), true);
});

test('canTransitionSessionRuntimeState: PLAYING -> FINALIZING ist erlaubt', () => {
    assert.equal(
        canTransitionSessionRuntimeState(SESSION_RUNTIME_STATES.PLAYING, SESSION_RUNTIME_STATES.FINALIZING),
        true
    );
});

test('canTransitionSessionRuntimeState: DISPOSED -> MENU ist nicht erlaubt', () => {
    assert.equal(
        canTransitionSessionRuntimeState(SESSION_RUNTIME_STATES.DISPOSED, SESSION_RUNTIME_STATES.MENU),
        false
    );
});

test('Capability-Fallback: unavailable Descriptor hat providerKind=unavailable', () => {
    const descriptor = createPlatformCapabilityDescriptor(PLATFORM_CAPABILITY_IDS.HOST, {
        available: false,
    });

    assert.equal(descriptor.available, false);
    assert.equal(descriptor.providerKind, 'unavailable');
    assert.equal(descriptor.capabilityId, PLATFORM_CAPABILITY_IDS.HOST);
});

test('Capability-Fallback: degradedReason bleibt auch bei unavailable Descriptor sichtbar', () => {
    const descriptor = createPlatformCapabilityDescriptor(PLATFORM_CAPABILITY_IDS.RECORDING, {
        available: false,
        providerKind: PLATFORM_PROVIDER_KINDS.UNAVAILABLE,
        degradedReason: 'webrtc_not_supported',
    });

    assert.equal(descriptor.available, false);
    assert.equal(descriptor.providerKind, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
    assert.equal(descriptor.degradedReason, 'webrtc_not_supported');
});

test('Capability-Fallback: Browser-Demo hat HOST-Capability als nicht verfuegbar', () => {
    const access = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(access.available, false, 'Browser-Demo darf nicht hosten');
    assert.equal(access.productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO);
});

test('Capability-Fallback: Desktop hat HOST-Capability als verfuegbar', () => {
    const access = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });

    assert.equal(access.available, true, 'Desktop-App soll hosten koennen');
    assert.equal(access.productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);
});

// ---- 91.4.2: Snapshot-Gating und Surface-Blocked-Tests ----

test('createSessionRuntimeSnapshot: Defaults sind stabile Vertragsfelder', () => {
    const snapshot = createSessionRuntimeSnapshot({});

    assert.ok(snapshot.contractVersion, 'contractVersion muss gesetzt sein');
    assert.equal(snapshot.lifecycleState, 'unknown');
    assert.equal(snapshot.finalizeState, 'idle');
    assert.equal(snapshot.isNetworkSession, false);
    assert.equal(snapshot.isHost, true);
    assert.equal(snapshot.pendingSessionInit, false);
});

test('createSessionRuntimeSnapshot: canReturnToMenu ist kein Feld (richtig: in MatchFlowSnapshot)', () => {
    const sessionSnapshot = createSessionRuntimeSnapshot({ canReturnToMenu: true });
    // canReturnToMenu gehoert zu MatchFlowSnapshot, nicht SessionRuntimeSnapshot
    assert.ok(!('canReturnToMenu' in sessionSnapshot), 'SessionRuntimeSnapshot besitzt kein canReturnToMenu');
});

test('createMatchFlowSnapshot: canReturnToMenu-Gating liefert sicheren Default', () => {
    const snapshot = createMatchFlowSnapshot({});
    assert.equal(snapshot.canReturnToMenu, false, 'Default-Snapshot soll kein returnToMenu erlauben');
});

test('createMatchFlowSnapshot: canReturnToMenu=true ist explizit opt-in', () => {
    const snapshot = createMatchFlowSnapshot({ canReturnToMenu: true });
    assert.equal(snapshot.canReturnToMenu, true);
    assert.ok(snapshot.contractVersion, 'contractVersion muss gesetzt sein');
});

test('createPlatformCapabilitySnapshot: alle 4 Capabilities sind im Snapshot praesent', () => {
    const snapshot = createPlatformCapabilitySnapshot({
        runtimeKind: 'desktop',
        discovery: { available: true, providerKind: 'electron-lan' },
        host: { available: true, providerKind: 'electron-lan' },
        save: { available: true, providerKind: 'electron-fs' },
        recording: { available: true, providerKind: 'electron-capture' },
    });

    assert.equal(snapshot.runtimeKind, 'desktop');
    assert.equal(snapshot.discovery.available, true);
    assert.equal(snapshot.host.available, true);
    assert.equal(snapshot.save.available, true);
    assert.equal(snapshot.recording.available, true);
    assert.equal(snapshot.discovery.capabilityId, PLATFORM_CAPABILITY_IDS.DISCOVERY);
    assert.equal(snapshot.host.capabilityId, PLATFORM_CAPABILITY_IDS.HOST);
    assert.equal(snapshot.save.capabilityId, PLATFORM_CAPABILITY_IDS.SAVE);
    assert.equal(snapshot.recording.capabilityId, PLATFORM_CAPABILITY_IDS.RECORDING);
});

test('createPlatformCapabilitySnapshot: Browser-Default hat alle Capabilities als unavailable', () => {
    const snapshot = createPlatformCapabilitySnapshot({});

    // Ohne explizite Provider sind alle Capabilities unavailable
    assert.equal(snapshot.discovery.available, false);
    assert.equal(snapshot.host.available, false);
    assert.equal(snapshot.save.available, false);
    assert.equal(snapshot.recording.available, false);
});

test('resolveSurfaceBlockedFeatureFeedback: Browser-Demo liefert stabiles Feedback-Objekt', () => {
    const feedback = resolveSurfaceBlockedFeatureFeedback('Video-Export', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(feedback.reason, 'surface_policy_blocked');
    assert.equal(feedback.productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO);
    assert.ok(feedback.message.includes('Demo'), 'Message soll Demo-Kontext enthalten');
    assert.equal(feedback.tone, 'warning');
    assert.ok(feedback.durationMs > 0, 'durationMs muss positiv sein');
});

test('resolveSurfaceBlockedFeatureFeedback: Desktop liefert stabiles Feedback-Objekt', () => {
    const feedback = resolveSurfaceBlockedFeatureFeedback('Unbekanntes Feature', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });

    assert.equal(feedback.reason, 'surface_policy_blocked');
    assert.equal(feedback.productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);
    assert.equal(feedback.tone, 'warning');
});

test('isSurfaceModePathAllowed: Browser-Demo erlaubt normal und blockiert quick_action', () => {
    const normalAllowed = isSurfaceModePathAllowed('normal', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const quickActionAllowed = isSurfaceModePathAllowed('quick_action', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    assert.equal(normalAllowed, true, 'normal modePath soll in Browser-Demo erlaubt sein');
    assert.equal(quickActionAllowed, false, 'quick_action soll in Browser-Demo blockiert sein');
});

test('normalizeSessionRuntimeEvent: unbekannte Event-Types werden normalisiert zurueckgewiesen', () => {
    const result = normalizeSessionRuntimeEvent({ type: 'INVALID_EVENT', sessionId: 'test' });
    assert.equal(result, null, 'Unbekannter Event-Type soll null liefern');
});

test('normalizeSessionRuntimeEvent: bekannte Event-Types werden beibehalten', () => {
    const result = normalizeSessionRuntimeEvent({
        type: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED,
        sessionId: 's1',
        sequence: 5,
    });

    assert.ok(result !== null, 'Bekannter Event-Type soll nicht null liefern');
    assert.equal(result?.type, SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED);
    assert.equal(result?.sessionId, 's1');
    assert.equal(result?.sequence, 5);
});

test('createRuntimeObservabilitySnapshot: match_finalized vor menu_opened in recentEvents', () => {
    const events = [
        { type: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZING, sessionId: 's1', sequence: 1 },
        { type: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED, sessionId: 's1', sequence: 2 },
        { type: SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED, sessionId: 's1', sequence: 3 },
    ];
    const snapshot = createRuntimeObservabilitySnapshot({
        sessionId: 's1',
        lifecycleState: SESSION_RUNTIME_STATES.MENU,
        finalizeState: 'finalized',
        recentEvents: events,
    });

    assert.equal(snapshot.recentEvents.length, 3);
    assert.equal(snapshot.recentEvents[1].type, SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED);
    assert.equal(snapshot.recentEvents[2].type, SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED);
    assert.ok(
        snapshot.recentEvents[1].sequence < snapshot.recentEvents[2].sequence,
        'match_finalized muss vor menu_opened liegen'
    );
});

test('createRuntimeObservabilitySnapshot: capability_fallback_used bleibt vor match_finalized -> menu_opened', () => {
    const fallbackEvent = createSessionRuntimeEvent(SESSION_RUNTIME_EVENT_TYPES.CAPABILITY_FALLBACK_USED, {
        sequence: 18,
        timestampMs: 2401,
        sessionId: 'session-b',
        lifecycleState: 'playing',
        finalizeState: 'idle',
        source: 'runtime-intent-port',
        payload: {
            capabilityId: 'save',
            fallbackProviderKind: 'browser_download',
        },
    });
    const finalizedEvent = createSessionRuntimeEvent(SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED, {
        sequence: 19,
        timestampMs: 2402,
        sessionId: 'session-b',
        lifecycleState: 'finalizing',
        finalizeState: 'finalized',
        source: 'match-lifecycle',
    });
    const menuOpenedEvent = createSessionRuntimeEvent(SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED, {
        sequence: 20,
        timestampMs: 2403,
        sessionId: 'session-b',
        lifecycleState: 'menu',
        finalizeState: 'finalized',
        source: 'match-lifecycle',
        payload: { reason: 'return_to_menu' },
    });
    const snapshot = createRuntimeObservabilitySnapshot({
        sessionId: 'session-b',
        lifecycleState: SESSION_RUNTIME_STATES.MENU,
        finalizeState: 'finalized',
        recentEvents: [fallbackEvent, finalizedEvent, menuOpenedEvent],
    });

    assert.deepEqual(
        snapshot.recentEvents.map((event) => event.type),
        [
            SESSION_RUNTIME_EVENT_TYPES.CAPABILITY_FALLBACK_USED,
            SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED,
            SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED,
        ]
    );
});

test('resolveSurfaceFeatureLaunchGuard blockiert nur desktop-only Features in browser-demo', () => {
    const browserDemoPolicy = { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO };

    const replayGuard = resolveSurfaceFeatureLaunchGuard(
        browserDemoPolicy,
        PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT,
        'Replay-Export'
    );
    const videoGuard = resolveSurfaceFeatureLaunchGuard(
        browserDemoPolicy,
        PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT,
        'Video-Export'
    );
    const fileIoGuard = resolveSurfaceFeatureLaunchGuard(
        browserDemoPolicy,
        PLATFORM_SURFACE_FEATURE_IDS.FILE_IO,
        'Datei-Zugriff'
    );

    assert.equal(replayGuard.allowed, true);
    assert.equal(videoGuard.allowed, true);
    assert.equal(fileIoGuard.allowed, false);
});

test('resolveSurfaceFeatureLaunchGuard erlaubt desktop-only Features in desktop-app', () => {
    const desktopPolicy = { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP };

    const replayGuard = resolveSurfaceFeatureLaunchGuard(
        desktopPolicy,
        PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT,
        'Replay-Export'
    );
    const videoGuard = resolveSurfaceFeatureLaunchGuard(
        desktopPolicy,
        PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT,
        'Video-Export'
    );

    assert.equal(replayGuard.allowed, true);
    assert.equal(videoGuard.allowed, true);
});

test('resolveSurfaceMultiplayerGateAccess blockiert host in browser-demo mit stabilem reason', () => {
    const result = resolveSurfaceMultiplayerGateAccess('host', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(result.allowed, false);
    assert.equal(result.action, 'host');
    assert.equal(result.productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO);
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
    assert.ok(typeof result.message === 'string' && result.message.length > 0);
});

test('resolveSurfaceFeatureClassification liefert Klassifikation fuer replay-export', () => {
    const result = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    assert.equal(result.featureId, PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT);
    assert.ok(typeof result.classification === 'string' && result.classification.length > 0);
});
