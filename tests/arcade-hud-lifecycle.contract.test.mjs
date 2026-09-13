import assert from 'node:assert/strict';
import test from 'node:test';

import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';
import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';
import { ParcoursOverlayController } from '../src/ui/arcade/ParcoursOverlayController.js';

function createStubClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(...items) { for (const item of items) values.add(item); },
        remove(...items) { for (const item of items) values.delete(item); },
        contains(value) { return values.has(value); },
        toggle(value, force) {
            const enabled = force === undefined ? !values.has(value) : !!force;
            if (enabled) values.add(value);
            else values.delete(value);
            return enabled;
        },
    };
}

function createStubElement(className = '') {
    return {
        className,
        id: '',
        style: {},
        dataset: {},
        children: [],
        textContent: '',
        classList: createStubClassList(),
        parentElement: null,
        appendChild(child) {
            this.children.push(child);
            if (child && typeof child === 'object') child.parentElement = this;
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            return child;
        },
        replaceChildren() { this.children.length = 0; },
        querySelector() { return null; },
        setAttribute() {},
    };
}

/** Node has no DOM; the arcade HUD only needs element creation and a body to hang overlays on. */
function installDocumentStub() {
    const previousDocument = globalThis.document;
    const byId = new Map();
    globalThis.document = {
        body: createStubElement('body'),
        getElementById(id) { return byId.get(id) || null; },
        createElement(tagName) { return createStubElement(tagName); },
    };
    return {
        restore() {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        },
    };
}

/**
 * Stands for ParcoursMinimapRenderer. The real renderer appends its canvas straight to
 * document.body, outside the HUD container, so hiding the HUD alone never hides it.
 * The stub only records whether anyone asked it to hide.
 */
function createMinimapStub() {
    return {
        hidden: false,
        _hide() { this.hidden = true; },
        update() {},
        dispose() {},
    };
}

test('returning to the menu hides the parcours minimap along with the rest of the HUD', () => {
    const runtime = new HudRuntimeSystem({ game: { ui: {} } });
    const overlay = new ParcoursOverlayController();
    const minimap = createMinimapStub();
    overlay._minimap = minimap;
    runtime._parcoursOverlay = overlay;

    // MatchFinalizeFlowService calls exactly this on the way back to the menu.
    runtime.clearNetworkScoreboard();

    assert.equal(minimap.hidden, true, 'the minimap canvas does not stay on top of the menu');
});

test('the arcade HUD shows the settled sector score right after the round ends', () => {
    const documentStub = installDocumentStub();
    try {
        let settledTotal = 0;
        const runtime = new HudRuntimeSystem({
            game: { ui: { hud: createStubElement('hud') } },
            ports: {
                // The real port builds a fresh projection on every call, straight from the run runtime.
                runtimeProjectionPort: {
                    getMatchRuntimeProjection: () => ({
                        arcade: { phase: 'intermission', nowMs: 0, sectorIndex: 1, score: { total: settledTotal, breakdown: {} } },
                    }),
                },
            },
        });
        const lifecycleController = new MatchFlowLifecycleController({
            matchFlowUiController: { _getMatchRuntimeProjection: () => ({}), applyMatchUiState() {} },
            game: { hudRuntimeSystem: runtime },
            runtimePort: {},
            coordinateRoundEnd: () => ({ uiState: { messageText: 'Sektor 1 abgeschlossen' } }),
            // As in the real flow, the sector score is settled by the round-end telemetry, after the plan.
            telemetryController: { recordRoundEndTelemetry() { settledTotal = 1050; } },
        });

        // The last playing tick before the round ends draws the score from before the settlement.
        runtime._updateArcadeHud(runtime._getMatchRuntimeProjection());
        assert.equal(runtime._arcadeScoreHud?._scoreValue?.textContent, '0');

        lifecycleController.onRoundEnd({ name: 'P1' });

        assert.equal(
            runtime._arcadeScoreHud?._scoreValue?.textContent,
            '1050',
            'the HUD shows the points the intermission settles, not the score from before',
        );
    } finally {
        documentStub.restore();
    }
});
