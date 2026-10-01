import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createHangarViewport3d } from '../src/ui/hangar/HangarViewport3d.js';

function createHarness() {
    const frameCallbacks = new Map();
    const cancelledFrames = [];
    const documentListeners = new Map();
    const intersectionTargets = [];
    const callOrder = [];
    let nextFrameId = 1;
    let intersectionCallback = null;
    let resizeCallback = null;
    let intersectionDisconnected = false;
    let resizeDisconnected = false;
    let renderCount = 0;
    let contextLossCount = 0;
    let rendererDisposeCount = 0;
    let preventedContextLoss = false;

    class FakeElement {
        constructor() {
            this.children = [];
            this.dataset = {};
            this.style = {};
            this.classList = { toggle() {}, add() {}, remove() {} };
            this.listeners = new Map();
            this.clientWidth = 640;
            this.clientHeight = 360;
            this.isConnected = true;
            this.ownerDocument = documentRef;
        }

        appendChild(child) {
            this.children.push(child);
            child.parentElement = this;
            child.isConnected = this.isConnected;
            return child;
        }

        removeChild(child) {
            this.children = this.children.filter((entry) => entry !== child);
            child.parentElement = null;
            child.isConnected = false;
        }

        remove() { this.parentElement?.removeChild(this); }
        replaceChildren(...children) { this.children = children; }
        getClientRects() {
            return this.isConnected && !this.hidden && this.clientWidth > 0 && this.clientHeight > 0 ? [{}] : [];
        }
        getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight }; }
        getRootNode() { return documentRef; }
        checkVisibility() { return this.visibility !== 'hidden'; }
        setAttribute() {}
        addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || new Set();
            listeners.add(listener);
            this.listeners.set(type, listeners);
        }
        removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
        dispatch(type, event = {}) {
            for (const listener of this.listeners.get(type) || []) listener(event);
        }
        querySelector() { return null; }
        querySelectorAll() { return []; }
    }

    const documentRef = {
        visibilityState: 'visible',
        createElement() { return new FakeElement(); },
        addEventListener(type, listener) { documentListeners.set(type, listener); },
        removeEventListener(type, listener) {
            if (documentListeners.get(type) === listener) documentListeners.delete(type);
        },
    };
    const windowRef = {
        devicePixelRatio: 1,
        requestAnimationFrame(callback) {
            const id = nextFrameId++;
            frameCallbacks.set(id, callback);
            return id;
        },
        cancelAnimationFrame(id) {
            cancelledFrames.push(id);
            frameCallbacks.delete(id);
        },
    };
    const renderer = {
        domElement: new FakeElement(),
        sizes: [],
        setPixelRatio() {},
        setSize(width, height) { this.sizes.push([width, height]); },
        render() { renderCount += 1; },
        forceContextLoss() { contextLossCount += 1; callOrder.push('force-context-loss'); },
        dispose() { rendererDisposeCount += 1; callOrder.push('renderer-dispose'); },
    };
    const mount = new FakeElement();
    const overlay = new FakeElement();
    const viewport = createHangarViewport3d({
        mount,
        overlay,
        lifecycle: {
            documentRef,
            windowRef,
            rendererFactory: () => renderer,
            intersectionObserverFactory(callback) {
                intersectionCallback = callback;
                return {
                    observe(target) { intersectionTargets.push(target); },
                    disconnect() { intersectionDisconnected = true; callOrder.push('intersection-disconnect'); },
                };
            },
            resizeObserverFactory(callback) {
                resizeCallback = callback;
                return {
                    observe() {},
                    disconnect() { resizeDisconnected = true; callOrder.push('resize-disconnect'); },
                };
            },
        },
    });

    function runFrame(nowMs = 16) {
        const [id, callback] = frameCallbacks.entries().next().value || [];
        assert.ok(callback, 'expected a scheduled animation frame');
        frameCallbacks.delete(id);
        callback(nowMs);
    }

    function setIntersection(isIntersecting) {
        intersectionCallback([{ target: mount, isIntersecting }]);
    }

    return {
        callOrder,
        cancelledFrames,
        contextLossCount: () => contextLossCount,
        documentListeners,
        documentRef,
        frameCallbacks,
        intersectionTargets,
        isIntersectionDisconnected: () => intersectionDisconnected,
        isResizeDisconnected: () => resizeDisconnected,
        mount,
        overlay,
        preventedContextLoss: () => preventedContextLoss,
        renderCount: () => renderCount,
        renderer,
        rendererDisposeCount: () => rendererDisposeCount,
        runFrame,
        setIntersection,
        triggerContextLoss() {
            renderer.domElement.dispatch('webglcontextlost', { preventDefault() { preventedContextLoss = true; } });
        },
        triggerContextRestore() { renderer.domElement.dispatch('webglcontextrestored'); },
        triggerResize() { resizeCallback([]); },
        viewport,
    };
}

test('hangar viewport pauses on hidden or detached mounts and resumes when visible again', () => {
    const appShellCss = readFileSync(new URL('../app-shell.css', import.meta.url), 'utf8');
    assert.match(appShellCss, /\.hidden\s*\{\s*display:\s*none(?:\s*!important)?\s*;/u);
    const harness = createHarness();
    assert.deepEqual(harness.intersectionTargets, [harness.mount]);
    assert.equal(harness.frameCallbacks.size, 0, 'no RAF is queued before the mount is visible');

    harness.setIntersection(true);
    assert.equal(harness.frameCallbacks.size, 1);
    harness.runFrame();
    assert.equal(harness.renderCount(), 1);
    assert.equal(harness.frameCallbacks.size, 1, 'visible mount keeps one RAF queued');

    const staleFrame = harness.frameCallbacks.values().next().value;
    harness.mount.hidden = true;
    harness.setIntersection(false);
    assert.equal(harness.frameCallbacks.size, 0, 'hiding the panel cancels the queued RAF');
    assert.equal(harness.cancelledFrames.length, 1);
    assert.equal(harness.mount.dataset.hangarRenderLoop, 'paused');
    staleFrame(32);
    assert.equal(harness.renderCount(), 1, 'a late frame after hide cannot draw');

    harness.mount.hidden = false;
    harness.setIntersection(true);
    assert.equal(harness.frameCallbacks.size, 1, 'reattaching and becoming visible starts rendering again');
    harness.runFrame(48);
    assert.equal(harness.renderCount(), 2);

    harness.mount.isConnected = false;
    harness.setIntersection(false);
    assert.equal(harness.frameCallbacks.size, 0, 'a detached mount has no RAF');
    harness.mount.isConnected = true;
    harness.setIntersection(true);
    assert.equal(harness.frameCallbacks.size, 1, 'reattaching the mount wakes the renderer');
});

test('document visibility, WebGL context recovery, resize, and dispose manage the same RAF lifecycle', () => {
    const harness = createHarness();
    harness.setIntersection(true);
    harness.runFrame();
    assert.equal(harness.renderCount(), 1);

    harness.documentRef.visibilityState = 'hidden';
    harness.documentListeners.get('visibilitychange')();
    assert.equal(harness.frameCallbacks.size, 0);
    harness.documentRef.visibilityState = 'visible';
    harness.documentListeners.get('visibilitychange')();
    assert.equal(harness.frameCallbacks.size, 1);

    harness.triggerContextLoss();
    assert.equal(harness.preventedContextLoss(), true);
    assert.equal(harness.frameCallbacks.size, 0);
    harness.triggerContextRestore();
    assert.equal(harness.frameCallbacks.size, 1);

    const canvasHost = harness.mount.children.find((child) => child.className.includes('hangar-viewport-canvas'));
    canvasHost.clientWidth = 900;
    harness.triggerResize();
    harness.runFrame(80);
    assert.deepEqual(harness.renderer.sizes.at(-1), [900, 360]);

    harness.viewport.dispose();
    assert.equal(harness.frameCallbacks.size, 0);
    assert.equal(harness.isIntersectionDisconnected(), true);
    assert.equal(harness.isResizeDisconnected(), true);
    assert.equal(harness.documentListeners.has('visibilitychange'), false);
    assert.equal(harness.rendererDisposeCount(), 1);
    assert.equal(harness.contextLossCount(), 1);
    assert.ok(harness.callOrder.indexOf('intersection-disconnect') < harness.callOrder.indexOf('force-context-loss'));
    assert.ok(harness.callOrder.indexOf('resize-disconnect') < harness.callOrder.indexOf('force-context-loss'));
    assert.ok(harness.callOrder.indexOf('force-context-loss') < harness.callOrder.indexOf('renderer-dispose'));

    harness.viewport.dispose();
    assert.equal(harness.rendererDisposeCount(), 1, 'dispose remains idempotent');
    assert.equal(harness.contextLossCount(), 1, 'context loss is requested once');
});
