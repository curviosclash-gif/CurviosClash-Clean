import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createRuntimeDiagnosticsRuntimeAccess,
    RuntimeDiagnosticsSystem,
} from '../src/core/RuntimeDiagnosticsSystem.js';
import { InputManager } from '../src/core/InputManager.js';
import { BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION } from '../src/shared/contracts/BrowserDemoSurfacePolicyOverrideContract.js';
import { resolveSurfacePolicy } from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import {
    createKeybindEditorRuntimeAccess,
    KeybindEditorController,
} from '../src/ui/KeybindEditorController.js';
import { resolveRuntimeMenuFeatureFlags } from '../src/ui/menu/MenuRuntimeFeatureFlags.js';
import { KEY_BIND_ACTIONS } from '../src/ui/KeybindActionCatalog.js';

function createClassList(initialValues = []) {
    const values = new Set(initialValues);
    return {
        add(value) {
            values.add(String(value));
        },
        remove(value) {
            values.delete(String(value));
        },
        contains(value) {
            return values.has(String(value));
        },
    };
}

function createMockElement(tagName = 'div') {
    return {
        tagName: String(tagName).toUpperCase(),
        style: {},
        className: '',
        textContent: '',
        innerHTML: '',
        children: [],
        classList: createClassList(),
        parentNode: null,
        appendChild(child) {
            if (!child || typeof child !== 'object') return child;
            child.parentNode = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (!this.parentNode) return;
            const siblings = this.parentNode.children;
            const index = siblings.indexOf(this);
            if (index >= 0) {
                siblings.splice(index, 1);
            }
            this.parentNode = null;
        },
    };
}

function createMockWindow() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            const key = String(type || '');
            const entries = listeners.get(key) || [];
            entries.push(listener);
            listeners.set(key, entries);
        },
        removeEventListener(type, listener) {
            const key = String(type || '');
            const entries = listeners.get(key) || [];
            listeners.set(key, entries.filter((entry) => entry !== listener));
        },
        dispatchEvent(event) {
            const payload = event && typeof event === 'object' ? event : { type: String(event || '') };
            const type = String(payload.type || '');
            const entries = [...(listeners.get(type) || [])];
            entries.forEach((listener) => listener.call(this, payload));
            return true;
        },
    };
}

function withMockBrowserGlobals(run) {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const window = createMockWindow();
    const body = createMockElement('body');
    const document = {
        body,
        createElement(tagName) {
            return createMockElement(tagName);
        },
    };
    globalThis.window = window;
    globalThis.document = document;
    return Promise.resolve()
        .then(() => run({ window, document }))
        .finally(() => {
            if (typeof originalWindow === 'undefined') {
                delete globalThis.window;
            } else {
                globalThis.window = originalWindow;
            }
            if (typeof originalDocument === 'undefined') {
                delete globalThis.document;
            } else {
                globalThis.document = originalDocument;
            }
        });
}

function createBuildArtifactRuntimeGlobal(draft) {
    class MockXMLHttpRequest {
        constructor() {
            this.status = 0;
            this.responseText = '';
        }

        open() {
            // no-op
        }

        send() {
            this.status = 200;
            this.responseText = JSON.stringify({
                contractVersion: 'browser-demo-surface-policy-export.v1',
                generatedAt: '2026-05-05T00:00:00.000Z',
                source: {
                    kind: 'test',
                },
                draft,
            });
        }
    }

    return {
        XMLHttpRequest: MockXMLHttpRequest,
    };
}

test('V104.2 runtime feature flags derive host capability from desktop-vs-browser runtime snapshot', () => {
    const desktopFlags = resolveRuntimeMenuFeatureFlags(
        { canHost: false },
        { __CURVIOS_APP__: true, curviosApp: { isApp: true } }
    );
    const browserFlags = resolveRuntimeMenuFeatureFlags(
        { canHost: true },
        {}
    );

    assert.equal(desktopFlags.canHost, true);
    assert.equal(desktopFlags.surfacePolicy?.productSurfaceId, 'desktop-app');
    assert.equal(browserFlags.canHost, false);
    assert.equal(browserFlags.surfacePolicy?.productSurfaceId, 'browser-demo');
});

test('V104.2 platform capability resolver reads browser-demo overrides only from explicit runtime inputs', () => {
    const overrideDraft = {
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
        policy: {
            allowedModePaths: ['fight'],
        },
    };
    const runtimeGlobal = createBuildArtifactRuntimeGlobal(overrideDraft);
    const originalXmlHttpRequest = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = runtimeGlobal.XMLHttpRequest;
    try {
        const implicitPolicy = resolveSurfacePolicy({ productSurfaceId: 'browser-demo' });
        const explicitPolicy = resolveSurfacePolicy({
            productSurfaceId: 'browser-demo',
            runtimeGlobal,
        });

        assert.equal(implicitPolicy.allowedModePaths.includes('arcade'), true);
        assert.equal(implicitPolicy.browserDemoOverrideDiagnostics.status, 'skipped');
        assert.equal(explicitPolicy.allowedModePaths.includes('arcade'), false);
        assert.deepEqual(explicitPolicy.allowedModePaths, ['fight']);
        assert.equal(explicitPolicy.browserDemoOverrideDiagnostics.status, 'applied');
    } finally {
        if (typeof originalXmlHttpRequest === 'undefined') {
            delete globalThis.XMLHttpRequest;
        } else {
            globalThis.XMLHttpRequest = originalXmlHttpRequest;
        }
    }
});

test('V104.2 keybind capture commits in PAUSED flow and reapplies pause bindings', () => {
    let settingsChangedCalls = 0;
    let pauseBindingCalls = 0;
    const toastMessages = [];
    const runtime = {
        state: 'PAUSED',
        keyCapture: { playerKey: 'PLAYER_1', actionKey: 'UP' },
        settings: {
            controls: {
                PLAYER_1: { UP: 'KeyW' },
                PLAYER_2: { UP: 'ArrowUp' },
                GLOBAL: {},
            },
        },
        input: {
            setBindings() {
                pauseBindingCalls += 1;
            },
        },
        // The pause shows the menu's settings window, so the menu root is visible.
        ui: {
            mainMenu: { classList: createClassList(), dataset: { pauseSettings: 'true' } },
        },
        _onSettingsChanged() {
            settingsChangedCalls += 1;
        },
        _showStatusToast(message) {
            toastMessages.push(String(message));
        },
    };

    const controller = new KeybindEditorController(createKeybindEditorRuntimeAccess(runtime));
    let pauseRenderCalls = 0;
    controller.renderEditor = () => {
        pauseRenderCalls += 1;
    };

    let preventDefaultCalls = 0;
    let stopPropagationCalls = 0;
    const handled = controller.handleKeyCapture({
        code: 'KeyZ',
        preventDefault() {
            preventDefaultCalls += 1;
        },
        stopPropagation() {
            stopPropagationCalls += 1;
        },
    });

    assert.equal(handled, true);
    assert.equal(preventDefaultCalls, 1);
    assert.equal(stopPropagationCalls, 1);
    assert.equal(runtime.keyCapture, null);
    assert.equal(runtime.settings.controls.PLAYER_1.UP, 'KeyZ');
    assert.equal(settingsChangedCalls, 1);
    assert.equal(pauseBindingCalls, 1);
    assert.equal(pauseRenderCalls, 1);
    assert.equal(toastMessages.includes('Taste gespeichert!'), true);
});

test('InputManager preventDefault guard leaves native controls to the browser', async () => {
    await withMockBrowserGlobals(async ({ document }) => {
        const manager = new InputManager();
        const inputElement = (type) => ({ tagName: 'INPUT', getAttribute: () => type });
        try {
            for (const activeElement of [
                { tagName: 'BUTTON' },
                { tagName: 'SELECT' },
                inputElement('range'),
                inputElement('checkbox'),
                inputElement('radio'),
                inputElement('button'),
            ]) {
                document.activeElement = activeElement;
                assert.equal(manager._shouldPreventDefault('KeyW'), false);
            }

            document.activeElement = inputElement('text');
            assert.equal(manager._isTextInputFocused(), true);
            assert.equal(manager._shouldPreventDefault('KeyW'), false);

            document.activeElement = { tagName: 'DIV', isContentEditable: true };
            assert.equal(manager._isTextInputFocused(), true);
            assert.equal(manager._shouldPreventDefault('KeyW'), false);

            document.activeElement = { tagName: 'DIV' };
            assert.equal(manager._shouldPreventDefault('KeyW'), true);
        } finally {
            manager.dispose();
        }
    });
});

test('InputManager keeps short key taps visible until the next input poll', async () => {
    await withMockBrowserGlobals(async ({ window }) => {
        const manager = new InputManager();
        const boostCode = manager.bindings.PLAYER_1.BOOST;
        const dispatchKey = (type) => window.dispatchEvent({
            type,
            code: boostCode,
            preventDefault() {},
        });

        try {
            dispatchKey('keydown');
            dispatchKey('keyup');

            const tappedInput = manager.getKeyboardInput(0, { includeSecondaryBindings: true });
            const tappedBoost = tappedInput.boost;
            const tappedBoostPressed = tappedInput.boostPressed;
            const consumedInput = manager.getKeyboardInput(0, { includeSecondaryBindings: true });

            assert.equal(tappedBoost, false);
            assert.equal(tappedBoostPressed, true);
            assert.equal(consumedInput.boostPressed, false);
        } finally {
            manager.dispose();
        }
    });
});

test('Keybind capture rejects duplicate bindings before changing controls', () => {
    const controls = { PLAYER_1: { UP: 'KeyW' }, PLAYER_2: { DOWN: 'ArrowDown' }, GLOBAL: {} };
    const warning = { classList: createClassList(['hidden']), textContent: '' };
    let settingsChangedCalls = 0;
    let toast = null;
    const runtime = {
        state: 'MENU',
        keyCapture: { playerKey: 'PLAYER_2', actionKey: 'DOWN' },
        settings: { controls },
        ui: { mainMenu: { classList: createClassList() }, keybindWarning: warning },
        _onSettingsChanged() { settingsChangedCalls += 1; },
        _showStatusToast(message, durationMs, tone) {
            toast = { message: String(message), durationMs, tone };
        },
    };
    const controller = new KeybindEditorController(createKeybindEditorRuntimeAccess(runtime));
    controller.renderEditor = () => {};

    const handled = controller.handleKeyCapture({
        code: 'KeyW',
        preventDefault() {},
        stopPropagation() {},
    });

    assert.equal(handled, true);
    assert.equal(runtime.keyCapture, null);
    assert.equal(controls.PLAYER_2.DOWN, 'ArrowDown');
    assert.equal(settingsChangedCalls, 0);
    // The rejected key is not bound twice, so the hint names the existing binding instead of
    // claiming a double assignment.
    const expectedMessage = `Taste W ist bereits mit ${KEY_BIND_ACTIONS.find((action) => action.key === 'UP').label} (Spieler 1) belegt`;
    assert.equal(warning.classList.contains('hidden'), false);
    assert.equal(warning.textContent, expectedMessage);
    assert.doesNotMatch(warning.textContent, /Mehrfachbelegte/);
    assert.deepEqual(toast, {
        message: expectedMessage,
        durationMs: 1800,
        tone: 'error',
    });
});

test('Keybind capture clears the rejected-key hint after a successful binding', () => {
    const controls = { PLAYER_1: { UP: 'KeyW' }, PLAYER_2: { DOWN: 'ArrowDown' }, GLOBAL: {} };
    const warning = { classList: createClassList(['hidden']), textContent: '' };
    const runtime = {
        state: 'MENU',
        keyCapture: { playerKey: 'PLAYER_2', actionKey: 'DOWN' },
        settings: { controls },
        ui: { mainMenu: { classList: createClassList() }, keybindWarning: warning },
        _onSettingsChanged() {},
        _showStatusToast() {},
    };
    const controller = new KeybindEditorController(createKeybindEditorRuntimeAccess(runtime));
    controller.renderEditor = () => {};
    controller.handleKeyCapture({ code: 'KeyW', preventDefault() {}, stopPropagation() {} });
    runtime.keyCapture = { playerKey: 'PLAYER_2', actionKey: 'DOWN' };
    controller.handleKeyCapture({ code: 'KeyK', preventDefault() {}, stopPropagation() {} });
    assert.equal(controls.PLAYER_2.DOWN, 'KeyK');
    assert.equal(warning.classList.contains('hidden'), true);
    assert.equal(warning.textContent, '');
});

test('V104.2 runtime diagnostics handles KeyP/KeyO and blocks both while key-capture is active', async () => {
    await withMockBrowserGlobals(async ({ window, document }) => {
        const qualityCalls = [];
        const toastMessages = [];
        const runtime = {
            keyCapture: null,
            state: 'PLAYING',
            _renderDelta: 1 / 60,
            renderer: {
                setQuality(quality) {
                    qualityCalls.push(String(quality));
                },
                getQualityState() {
                    return { effectiveQuality: qualityCalls.at(-1) || 'HIGH' };
                },
                renderer: {
                    info: {
                        render: { calls: 0, triangles: 0 },
                        memory: { geometries: 0, textures: 0 },
                    },
                },
            },
            entityManager: {
                players: [],
            },
            mediaRecorderSystem: {
                isRecording() {
                    return false;
                },
                getRecordingCaptureSettings() {
                    return { profile: 'standard' };
                },
            },
            _showStatusToast(message) {
                toastMessages.push(String(message));
            },
        };

        const diagnostics = new RuntimeDiagnosticsSystem(createRuntimeDiagnosticsRuntimeAccess(runtime));
        try {
            window.dispatchEvent({ type: 'keydown', code: 'KeyP' });
            assert.equal(qualityCalls.length, 1);
            assert.equal(qualityCalls[0], 'LOW');
            assert.equal(toastMessages.length >= 1, true);

            window.dispatchEvent({ type: 'keydown', code: 'KeyO' });
            assert.equal(document.body.children.length, 1);
            assert.equal(diagnostics._statsElement !== null, true);

            window.dispatchEvent({ type: 'keydown', code: 'KeyO' });
            assert.equal(document.body.children.length, 0);
            assert.equal(diagnostics._statsElement, null);

            runtime.keyCapture = { playerKey: 'PLAYER_1', actionKey: 'UP' };
            const qualityCallsBeforeCapture = qualityCalls.length;
            window.dispatchEvent({ type: 'keydown', code: 'KeyP' });
            window.dispatchEvent({ type: 'keydown', code: 'KeyO' });

            assert.equal(qualityCalls.length, qualityCallsBeforeCapture);
            assert.equal(document.body.children.length, 0);
            assert.equal(diagnostics._statsElement, null);
        } finally {
            diagnostics.dispose();
        }
    });
});

test('runtime diagnostics ignores KeyP/KeyO typed into text entry fields', async () => {
    await withMockBrowserGlobals(async ({ window, document }) => {
        const qualityCalls = [];
        const runtimeAccess = {
            getKeyCaptureActive: () => false,
            getRenderer: () => ({ setQuality: (quality) => qualityCalls.push(String(quality)) }),
            getMediaRecorderSystem: () => null,
            getEntityManager: () => null,
            getRenderDelta: () => 1 / 60,
            getState: () => 'MENU',
            actionShowStatusToast() {},
        };
        const diagnostics = new RuntimeDiagnosticsSystem(runtimeAccess);
        try {
            for (const target of [
                { tagName: 'INPUT' },
                { tagName: 'TEXTAREA' },
                { tagName: 'SELECT' },
                { tagName: 'DIV', isContentEditable: true },
            ]) {
                window.dispatchEvent({ type: 'keydown', code: 'KeyP', target });
                window.dispatchEvent({ type: 'keydown', code: 'KeyO', target });
            }

            assert.deepEqual(qualityCalls, [], 'typing must not toggle the graphics quality');
            assert.equal(document.body.children.length, 0, 'typing must not open the stats overlay');
            assert.equal(diagnostics._statsElement, null);

            // A key press outside a text entry field still works.
            window.dispatchEvent({ type: 'keydown', code: 'KeyP', target: { tagName: 'CANVAS' } });
            assert.deepEqual(qualityCalls, ['LOW']);
        } finally {
            diagnostics.dispose();
        }
    });
});

test('runtime diagnostics adapts quality in stable steps and restores automatic downgrades', async () => {
    await withMockBrowserGlobals(async () => {
        const qualityCalls = [];
        const runtimeAccess = {
            getRenderer: () => ({ setQuality: (quality) => qualityCalls.push(quality) }),
            getMediaRecorderSystem: () => null,
            getEntityManager: () => null,
            getRenderDelta: () => 1 / 60,
            getState: () => 'PLAYING',
            actionShowStatusToast() {},
        };
        const diagnostics = new RuntimeDiagnosticsSystem(runtimeAccess);
        diagnostics._fpsTracker.update = () => {};

        // Cooldown gezielt ueberspringen - die Sperre selbst deckt der naechste Test ab.
        const checkWithAverageFps = (avgFps) => {
            diagnostics._fpsTracker.avg = avgFps;
            diagnostics._adaptiveCooldown = 0;
            diagnostics.update(3.1);
        };

        try {
            checkWithAverageFps(20);
            checkWithAverageFps(20);
            // 52 fps hebt LOW auf MEDIUM, reicht aber nicht fuer HIGH - Hysterese haelt die Stufe.
            checkWithAverageFps(52);
            checkWithAverageFps(52);
            checkWithAverageFps(60);

            assert.deepEqual(qualityCalls, ['MEDIUM', 'LOW', 'MEDIUM', 'HIGH']);
            assert.equal(diagnostics._isLowQuality, false);
            assert.equal(diagnostics._autoLowActive, false);
        } finally {
            diagnostics.dispose();
        }
    });
});

test('runtime diagnostics holds the quality level during the cooldown after a switch', async () => {
    await withMockBrowserGlobals(async () => {
        const qualityCalls = [];
        const runtimeAccess = {
            getRenderer: () => ({ setQuality: (quality) => qualityCalls.push(quality) }),
            getMediaRecorderSystem: () => null,
            getEntityManager: () => null,
            getRenderDelta: () => 1 / 60,
            getState: () => 'PLAYING',
            actionShowStatusToast() {},
        };
        const diagnostics = new RuntimeDiagnosticsSystem(runtimeAccess);
        diagnostics._fpsTracker.update = () => {};

        try {
            // Dauerhaft niedrige FPS: ohne Cooldown wuerde der Regler bei jedem Intervall
            // eine Stufe weiterschalten und die Szenenhelligkeit im Takt umkippen.
            diagnostics._fpsTracker.avg = 20;
            diagnostics.update(3.1);
            assert.deepEqual(qualityCalls, ['MEDIUM']);

            for (let step = 0; step < 3; step++) {
                diagnostics._fpsTracker.avg = 20;
                diagnostics.update(3.1);
                assert.deepEqual(qualityCalls, ['MEDIUM']);
            }

            // Erst nach Ablauf des Cooldowns darf die naechste Stufe folgen.
            diagnostics._fpsTracker.avg = 20;
            diagnostics.update(3.1);
            assert.deepEqual(qualityCalls, ['MEDIUM', 'LOW']);
        } finally {
            diagnostics.dispose();
        }
    });
});
