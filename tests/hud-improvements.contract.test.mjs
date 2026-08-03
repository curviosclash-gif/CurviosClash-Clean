import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { GAMEPLAY_CAMERA_MODE_ID } from '../src/shared/contracts/CameraModeContract.js';
import {
    createDefaultHudAppearance,
    DEFAULT_HUD_APPEARANCE,
    HUD_APPEARANCE_LIMITS,
    HUD_COLOR_PRESET,
    normalizeHudAppearance,
    normalizeHudColorPreset,
} from '../src/shared/contracts/HudAppearanceContract.js';
import { HUD } from '../src/ui/HUD.js';
import {
    applyHudAppearance,
    applyRuntimeHudAppearance,
    resolveHudColorPresetLabel,
} from '../src/ui/HudAppearance.js';
import { HudRuntimeSystem } from '../src/ui/HudRuntimeSystem.js';
import { ArcadeScoreHUD } from '../src/ui/arcade/ArcadeScoreHUD.js';
import { SETTINGS_CHANGE_KEYS, SETTINGS_CHANGE_PATHS } from '../src/ui/SettingsChangeKeys.js';

// ---------------------------------------------------------------------------
// DOM stubs (node has no DOM; HUD/HudRuntimeSystem only need a small subset)
// ---------------------------------------------------------------------------

function createStubClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
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
    const element = {
        className,
        style: {},
        dataset: {},
        children: [],
        childNodes: [],
        textContent: '',
        title: '',
        clientWidth: 800,
        clientHeight: 450,
        classList: createStubClassList(),
        parentNode: null,
        nextSibling: null,
        appendChild(child) {
            this.children.push(child);
            this.childNodes.push(child);
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) {
                this.children.splice(index, 1);
                this.childNodes.splice(index, 1);
            }
            return child;
        },
        replaceChildren() {
            this.children.length = 0;
            this.childNodes.length = 0;
        },
        querySelector(selector) {
            if (!this._queryCache) this._queryCache = new Map();
            if (!this._queryCache.has(selector)) {
                this._queryCache.set(selector, createStubElement());
            }
            return this._queryCache.get(selector);
        },
        get lastChild() {
            return this.children[this.children.length - 1] || null;
        },
    };
    return element;
}

test('HudRuntimeSystem exposes the active menu mode to the shared HUD shell', () => {
    const hud = createStubElement('hud');
    const game = {
        ui: { hud },
        settings: { localSettings: { modePath: 'arcade' } },
    };
    const runtime = new HudRuntimeSystem({ game });

    runtime._syncHudMode();
    assert.equal(hud.dataset.hudMode, 'arcade');

    game.settings.localSettings.modePath = 'fight';
    runtime._syncHudMode();
    assert.equal(hud.dataset.hudMode, 'fight');

    game.settings.localSettings.modePath = 'quick_action';
    runtime._syncHudMode();
    assert.equal(hud.dataset.hudMode, 'normal');
});

test('Arcade score keeps breakdown details out of active play', () => {
    const documentStub = installDocumentStub();
    try {
        const parent = createStubElement('hud');
        const hud = new ArcadeScoreHUD(parent);
        const activeState = {
            phase: 'sector_active',
            nowMs: 1000,
            sectorIndex: 1,
            score: { total: 100, combo: 2, multiplier: 1.5, breakdown: { base: 100 } },
        };

        hud.update(activeState);
        assert.equal(hud._breakdownWrap.style.display, 'none');
        assert.equal(hud._modifierWrap.style.display, 'none');

        hud.update({ ...activeState, phase: 'paused' });
        assert.equal(hud._breakdownWrap.style.display, 'grid');
    } finally {
        documentStub.restore();
    }
});

function installDocumentStub() {
    const previousDocument = globalThis.document;
    const byId = new Map();
    globalThis.document = {
        getElementById(id) {
            if (!byId.has(id)) byId.set(id, createStubElement());
            return byId.get(id);
        },
        createElement(tagName) {
            return createStubElement(tagName);
        },
    };
    return {
        byId,
        restore() {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        },
    };
}

function createMemoryStoragePlatform(initialRecords = {}) {
    const records = new Map(Object.entries(initialRecords));
    return {
        driver: { storage: null },
        readJson(key, legacyKeys = [], fallback = null) {
            const candidates = [key, ...(Array.isArray(legacyKeys) ? legacyKeys : [])];
            for (const candidate of candidates) {
                if (!records.has(candidate)) continue;
                return records.get(candidate);
            }
            return fallback;
        },
        writeJson(key, value) {
            records.set(key, value);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        getRecord(key) {
            return records.get(key);
        },
    };
}

function createHudInstance(documentStub) {
    const hud = new HUD('p1-fighter-hud', 0, { getCamera: () => null });
    const container = documentStub.byId.get('p1-fighter-hud');
    return { hud, container };
}

function createAlivePlayer(overrides = {}) {
    return {
        alive: true,
        position: { x: 0, y: 12, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        speed: 35,
        boostCharge: 4,
        boostCapacity: 4,
        cameraModeId: GAMEPLAY_CAMERA_MODE_ID,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// HUD appearance contract (suggestion 5)
// ---------------------------------------------------------------------------

test('normalizeHudAppearance falls back to defaults for invalid input', () => {
    assert.deepEqual(normalizeHudAppearance(null), DEFAULT_HUD_APPEARANCE);
    assert.deepEqual(normalizeHudAppearance('garbage'), DEFAULT_HUD_APPEARANCE);
    assert.deepEqual(
        normalizeHudAppearance({ scale: 'x', opacity: null, colorPreset: 'neon' }),
        DEFAULT_HUD_APPEARANCE
    );
});

test('normalizeHudAppearance clamps scale and opacity to the HUD limits', () => {
    const normalized = normalizeHudAppearance({ scale: 99, opacity: -1, colorPreset: 'AMBER' });
    assert.equal(normalized.scale, HUD_APPEARANCE_LIMITS.SCALE_MAX);
    assert.equal(normalized.opacity, HUD_APPEARANCE_LIMITS.OPACITY_MIN);
    assert.equal(normalized.colorPreset, HUD_COLOR_PRESET.AMBER);
});

test('normalizeHudColorPreset accepts only known presets', () => {
    assert.equal(normalizeHudColorPreset('cyan'), HUD_COLOR_PRESET.CYAN);
    assert.equal(normalizeHudColorPreset(' CYAN '), HUD_COLOR_PRESET.CYAN);
    assert.equal(normalizeHudColorPreset('magenta'), DEFAULT_HUD_APPEARANCE.colorPreset);
    assert.equal(normalizeHudColorPreset('', 'white'), HUD_COLOR_PRESET.WHITE);
});

test('createDefaultHudAppearance returns independent copies', () => {
    const first = createDefaultHudAppearance();
    const second = createDefaultHudAppearance();
    assert.notEqual(first, second);
    first.scale = 0.5;
    assert.equal(second.scale, DEFAULT_HUD_APPEARANCE.scale);
});

test('applyHudAppearance writes scale, opacity and preset colors as CSS variables', () => {
    const properties = new Map();
    const element = {
        style: {
            setProperty(name, value) { properties.set(name, value); },
        },
    };
    applyHudAppearance(element, { scale: 1.2, opacity: 0.7, colorPreset: 'amber' });
    assert.equal(properties.get('--hud-scale'), '1.2');
    assert.equal(properties.get('--hud-opacity'), '0.7');
    assert.equal(properties.get('--hud-color'), '#ffd28d');
    assert.ok(properties.has('--hud-line'));
    assert.ok(properties.has('--hud-line-soft'));
    assert.ok(properties.has('--hud-line-strong'));
    assert.ok(properties.has('--hud-glow'));
    assert.ok(properties.has('--hud-bg'));
    assert.ok(properties.has('--hud-text'));
});

test('applyHudAppearance keeps the HUD visible for invalid input and missing elements', () => {
    const properties = new Map();
    const element = {
        style: {
            setProperty(name, value) { properties.set(name, value); },
        },
    };
    applyHudAppearance(element, { scale: 0, opacity: -5, colorPreset: 'void' });
    assert.equal(properties.get('--hud-scale'), String(HUD_APPEARANCE_LIMITS.SCALE_MIN));
    assert.equal(properties.get('--hud-opacity'), String(HUD_APPEARANCE_LIMITS.OPACITY_MIN));
    assert.equal(properties.get('--hud-color'), '#8dff9f');
    assert.doesNotThrow(() => applyHudAppearance(null, null));
});

test('applyRuntimeHudAppearance reaches body-mounted HUD overlays through the document root', () => {
    const hudProperties = new Map();
    const documentProperties = new Map();
    const documentElement = {
        style: {
            setProperty(name, value) { documentProperties.set(name, value); },
        },
    };
    const hud = {
        ownerDocument: { documentElement },
        style: {
            setProperty(name, value) { hudProperties.set(name, value); },
        },
    };

    applyRuntimeHudAppearance(hud, { scale: 1.4, opacity: 0.4, colorPreset: 'cyan' });

    for (const properties of [hudProperties, documentProperties]) {
        assert.equal(properties.get('--hud-scale'), '1.4');
        assert.equal(properties.get('--hud-opacity'), '0.4');
        assert.equal(properties.get('--hud-color'), '#8ddcff');
    }
});

test('resolveHudColorPresetLabel returns German labels with fallback', () => {
    assert.equal(resolveHudColorPresetLabel('green'), 'Grün');
    assert.equal(resolveHudColorPresetLabel('white'), 'Weiß');
    assert.equal(resolveHudColorPresetLabel('unknown'), 'Grün');
});

// ---------------------------------------------------------------------------
// Settings persistence + change keys (suggestion 5 storage format)
// ---------------------------------------------------------------------------

test('settings sanitizer preserves localSettings.hud (whitelist + defaults)', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const sanitized = manager.sanitizeSettings({
        localSettings: {
            hud: { scale: 1.25, opacity: 0.55, colorPreset: 'amber' },
        },
    });
    assert.deepEqual(sanitized.localSettings.hud, { scale: 1.25, opacity: 0.55, colorPreset: 'amber' });
});

test('settings sanitizer clamps invalid localSettings.hud values', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const sanitized = manager.sanitizeSettings({
        localSettings: {
            hud: { scale: 99, opacity: -1, colorPreset: 'neon' },
        },
    });
    assert.deepEqual(sanitized.localSettings.hud, {
        scale: HUD_APPEARANCE_LIMITS.SCALE_MAX,
        opacity: HUD_APPEARANCE_LIMITS.OPACITY_MIN,
        colorPreset: DEFAULT_HUD_APPEARANCE.colorPreset,
    });
});

test('settings default snapshot contains localSettings.hud defaults', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    assert.deepEqual(defaults.localSettings.hud, DEFAULT_HUD_APPEARANCE);
});

test('HUD appearance change keys are registered and resolve to localSettings paths', () => {
    assert.equal(SETTINGS_CHANGE_KEYS.LOCAL_HUD_SCALE, 'local.hud.scale');
    assert.equal(SETTINGS_CHANGE_KEYS.LOCAL_HUD_OPACITY, 'local.hud.opacity');
    assert.equal(SETTINGS_CHANGE_KEYS.LOCAL_HUD_COLOR_PRESET, 'local.hud.colorPreset');
    assert.equal(SETTINGS_CHANGE_PATHS['localSettings.hud.scale'], 'local.hud.scale');
    assert.equal(SETTINGS_CHANGE_PATHS['localSettings.hud.opacity'], 'local.hud.opacity');
    assert.equal(SETTINGS_CHANGE_PATHS['localSettings.hud.colorPreset'], 'local.hud.colorPreset');
});

// ---------------------------------------------------------------------------
// Fighter HUD (suggestions 1-3)
// ---------------------------------------------------------------------------

test('HUD heading tape covers -120°..480° so the 0°/360° wrap has no blank side', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        const ticks = hud.headingScale.children;
        assert.equal(ticks.length, (480 + 120) / 15 + 1);
        assert.equal(ticks[0].style.left, `${-120 * 4}px`);
        assert.equal(ticks[ticks.length - 1].style.left, `${480 * 4}px`);
        // Direction labels wrap around (e.g. -45° renders as NW, 405° as NE).
        const minus45 = ticks.find((tick) => tick.style.left === `${-45 * 4}px`);
        const plus405 = ticks.find((tick) => tick.style.left === `${405 * 4}px`);
        assert.equal(minus45.children[0].textContent, 'NW');
        assert.equal(plus405.children[0].textContent, 'NE');
    } finally {
        documentStub.restore();
    }
});

test('HUD pitch ladder labels major angles and keeps minor steps compact', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        const lines = hud.pitchLadder.children;
        assert.equal(lines.length, 36);

        const plusTen = lines.find((line) => line.dataset.deg === 10);
        const minusFive = lines.find((line) => line.dataset.deg === -5);
        assert.equal(plusTen.className, 'pitch-line pitch-line-major');
        assert.deepEqual(plusTen.children.map((child) => child.textContent), ['10', '10']);
        assert.equal(minusFive.className, 'pitch-line pitch-line-minor');
        assert.equal(minusFive.children.length, 0);
    } finally {
        documentStub.restore();
    }
});

test('HUD builds speed and altitude tapes from the gameplay config ranges', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        // Defaults: 35 m/s * 1.8 boost * 10 readout = 630 -> rounded up to 650.
        assert.equal(hud._tapeSpeedMax, 650);
        assert.equal(hud.speedScale.children.length, 650 / 10 + 1);
        // Altitude keeps the 200 floor (arena top 30*3=90 stays below it).
        assert.equal(hud._tapeAltMax, 200);
    } finally {
        documentStub.restore();
    }
});

test('HUD keeps the classic boost arc percentage and cooldown state in sync', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        hud.update(createAlivePlayer({
            boostCharge: 2,
            boostCapacity: 4,
            boostRecharging: true,
        }), 0.05, {});

        assert.equal(hud.classicBoostFill.style['--hunt-segments-filled'], '50%');
        assert.equal(hud.classicBoostText.textContent, '50%');
        assert.equal(hud.classicBoostWidget.classList.contains('cooldown'), true);

        hud.update(createAlivePlayer({
            boostCharge: 4,
            boostCapacity: 4,
            boostRecharging: false,
        }), 0.05, {});
        assert.equal(hud.classicBoostFill.style['--hunt-segments-filled'], '100%');
        assert.equal(hud.classicBoostText.textContent, '100%');
        assert.equal(hud.classicBoostWidget.classList.contains('cooldown'), false);
    } finally {
        documentStub.restore();
    }
});

test('HUD update rotates the artificial horizon with roll and shifts it with pitch', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        // Pure roll of +90° about the z axis.
        const rollRad = Math.PI / 2;
        const player = createAlivePlayer({
            quaternion: { x: 0, y: 0, z: Math.sin(rollRad / 2), w: Math.cos(rollRad / 2) },
        });
        hud.update(player, 0.05, {});
        const transform = String(hud.horizon.style.transform || '');
        const match = /^translate\(-50%, -50%\) rotate\((-?[\d.e+-]+)deg\) translateY\((-?[\d.e+-]+)px\) scale\(var\(--hud-scale, 1\)\)$/.exec(transform);
        assert.ok(match, `horizon transform carries roll and pitch: ${transform}`);
        assert.ok(Math.abs(Number(match[1]) - 90) < 0.01, `roll term ~90deg, got ${match[1]}`);
        assert.ok(Math.abs(Number(match[2])) < 0.01, `pitch term ~0px, got ${match[2]}`);
        assert.equal(hud.pitchLadder.style.transform, hud.horizon.style.transform);
    } finally {
        documentStub.restore();
    }
});

test('HUD hides the redundant bank readout near level flight', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        hud.update(createAlivePlayer(), 0.05, {});
        assert.equal(hud.bankAngle.classList.contains('hidden'), true);

        const rollRad = (10 * Math.PI) / 180;
        hud.update(createAlivePlayer({
            quaternion: { x: 0, y: 0, z: Math.sin(rollRad / 2), w: Math.cos(rollRad / 2) },
        }), 0.05, {});
        assert.equal(hud.bankAngle.classList.contains('hidden'), false);
        assert.equal(hud.bankAngle.textContent, '+10 deg');
    } finally {
        documentStub.restore();
    }
});

test('HUD update aligns the heading tape without the stale -50% offset', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        hud.update(createAlivePlayer(), 0.05, {});
        // heading 0 -> tick 0° sits exactly under the tape center marker.
        assert.equal(hud.headingScale.style.transform, 'translateX(0px)');
    } finally {
        documentStub.restore();
    }
});

test('HUD update grows the speed tape when the live speed exceeds the built range', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        hud.update(createAlivePlayer({ speed: 80 }), 0.05, {});
        // Readout 80*10=800 exceeds the default 650 range and triggers one rebuild.
        assert.equal(hud._tapeSpeedMax, 800);
        assert.equal(hud.speedScale.children.length, 800 / 10 + 1);
        hud.update(createAlivePlayer({ speed: 35 }), 0.05, {});
        // Range never shrinks back (no per-frame rebuild churn).
        assert.equal(hud._tapeSpeedMax, 800);
    } finally {
        documentStub.restore();
    }
});

test('HUD lock reticle uses transforms and clamps an arrow for off-screen targets', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        const camera = new THREE.PerspectiveCamera(60, 800 / 450, 0.1, 1000);
        camera.position.set(0, 12, 0);
        camera.lookAt(0, 12, -1);
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();

        const player = createAlivePlayer();
        const onScreenTarget = { alive: true, position: { x: 0, y: 12, z: -30 } };
        hud.update(player, 0.05, { lockTarget: onScreenTarget, getCamera: () => camera });
        assert.equal(hud.lockReticle.classList.contains('hidden'), false);
        assert.equal(hud.lockBox.classList.contains('hidden'), false);
        assert.equal(hud.lockArrow.classList.contains('hidden'), true);
        assert.match(hud.lockReticle.style.transform, /^translate\(400px, 225px\)/);
        assert.match(hud.lockReticle.style.transform, /scale\(var\(--hud-scale, 1\)\)$/);
        assert.equal(hud.lockReticle.style.left, undefined);

        const behindTarget = { alive: true, position: { x: 5, y: 12, z: 30 } };
        hud.update(player, 0.05, { lockTarget: behindTarget, getCamera: () => camera });
        assert.equal(hud.lockReticle.classList.contains('hidden'), false);
        assert.equal(hud.lockBox.classList.contains('hidden'), true);
        assert.equal(hud.lockArrow.classList.contains('hidden'), false);
        assert.match(hud.lockArrow.style.transform, /rotate\(/);
        // Arrow stays inside the margin-clamped screen area.
        const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(hud.lockReticle.style.transform);
        assert.ok(match, 'reticle transform contains a pixel translation');
        const edgeX = Number(match[1]);
        const edgeY = Number(match[2]);
        assert.ok(edgeX >= 28 && edgeX <= 800 - 28, `edge x ${edgeX} within margins`);
        assert.ok(edgeY >= 28 && edgeY <= 450 - 28, `edge y ${edgeY} within margins`);
        assert.ok(
            Math.abs(edgeX - 28) < 0.001 || Math.abs(edgeX - (800 - 28)) < 0.001
                || Math.abs(edgeY - 28) < 0.001 || Math.abs(edgeY - (450 - 28)) < 0.001,
            'arrow is clamped to a screen edge'
        );
    } finally {
        documentStub.restore();
    }
});

// ---------------------------------------------------------------------------
// Item bar cooldown overlay (suggestion 4)
// ---------------------------------------------------------------------------

test('item slots render cooldown sweep and remaining seconds instead of title-only info', () => {
    const documentStub = installDocumentStub();
    try {
        const runtime = new HudRuntimeSystem({ game: {}, ports: null });
        const container = createStubElement('item-bar');
        const player = {
            inventory: ['ROCKET'],
            selectedItemIndex: 0,
            itemUseCooldownRemaining: 0,
            shootCooldown: 0.625,
        };
        runtime._updateItemBar(container, player, { modeId: 'HUNT' });

        assert.equal(container.children.length, 5);
        const slot = container.children[0];
        const [iconEl, sweepEl, cooldownTextEl] = slot.children;
        assert.ok(iconEl.textContent.length > 0, 'icon is rendered in the dedicated icon element');
        const sweepMatch = /scaleY\(([\d.]+)\)/.exec(sweepEl.style.transform);
        assert.ok(sweepMatch, `sweep transform carries a scaleY fraction: ${sweepEl.style.transform}`);
        assert.ok(Math.abs(Number(sweepMatch[1]) - 0.5) < 0.001, `sweep fraction ~0.5, got ${sweepMatch[1]}`);
        assert.equal(cooldownTextEl.textContent, '0.6');
        assert.ok(slot.title.includes('Shoot-CD'), 'tooltip details are kept for debugging');

        // Cooldown over: sweep collapses and the seconds readout clears.
        player.shootCooldown = 0;
        runtime._updateItemBar(container, player, { modeId: 'HUNT' });
        assert.equal(sweepEl.style.transform, 'scaleY(0)');
        assert.equal(cooldownTextEl.textContent, '');
    } finally {
        documentStub.restore();
    }
});

test('rocket tiers and active effect sources remain visible without color or tooltips', () => {
    const documentStub = installDocumentStub();
    try {
        const runtime = new HudRuntimeSystem({ game: {}, ports: null });
        const container = createStubElement('item-bar');
        container.parentNode = { insertBefore() {} };
        const player = {
            index: 1,
            inventory: ['ROCKET_MEGA'],
            selectedItemIndex: 0,
            activeEffects: [{ type: 'INVERT', remaining: 2.25, sourcePlayerIndex: 0 }],
        };

        runtime._updateItemBar(container, player, { modeId: 'HUNT' });

        const tierBadge = container.children[0].children[3];
        assert.equal(tierBadge.textContent, 'XL');
        assert.match(container.children[0].ariaLabel, /Rakete XL/);
        const effectBar = runtime._activeEffectBars.get(container);
        assert.equal(effectBar.classList.contains('hidden'), false);
        assert.equal(effectBar.children[0].children[1].textContent, 'Invertieren');
        assert.equal(effectBar.children[0].children[2].textContent, '2.3s');
        assert.equal(effectBar.children[0].children[3].textContent, 'P1');
        assert.equal(effectBar.children[0].dataset.tone, 'debuff');
    } finally {
        documentStub.restore();
    }
});

test('item slots render the use-cooldown path with the configured item cooldown', () => {
    const documentStub = installDocumentStub();
    try {
        const game = {
            config: {
                HUNT: { ITEM_USE_COOLDOWN_SECONDS: 0.15 },
                PROJECTILE: { COOLDOWN: 1.25 },
                POWERUP: { MAX_INVENTORY: 5 },
            },
        };
        const runtime = new HudRuntimeSystem({ game, ports: null });
        const container = createStubElement('item-bar');
        const player = {
            inventory: ['GHOST'],
            selectedItemIndex: 0,
            itemUseCooldownRemaining: 0.075,
            shootCooldown: 0,
        };
        runtime._updateItemBar(container, player, { modeId: 'CLASSIC' });
        const [, sweepEl, cooldownTextEl] = container.children[0].children;
        const sweepMatch = /scaleY\(([\d.]+)\)/.exec(sweepEl.style.transform);
        assert.ok(sweepMatch, `sweep transform carries a scaleY fraction: ${sweepEl.style.transform}`);
        assert.ok(Math.abs(Number(sweepMatch[1]) - 0.5) < 0.001, `use-cooldown fraction ~0.5, got ${sweepMatch[1]}`);
        assert.equal(cooldownTextEl.textContent, '0.1');
    } finally {
        documentStub.restore();
    }
});

test('item slots stay empty and cooldown-free with an empty inventory', () => {
    const documentStub = installDocumentStub();
    try {
        const runtime = new HudRuntimeSystem({ game: {}, ports: null });
        const container = createStubElement('item-bar');
        runtime._updateItemBar(container, { inventory: [], selectedItemIndex: -1 }, { modeId: 'CLASSIC' });
        assert.equal(container.children.length, 5);
        const [iconEl, sweepEl, cooldownTextEl] = container.children[0].children;
        assert.equal(iconEl.textContent, '');
        assert.equal(sweepEl.style.transform, 'scaleY(0)');
        assert.equal(cooldownTextEl.textContent, '');
    } finally {
        documentStub.restore();
    }
});

test('cooldown indicator shows player shoot and use cooldowns independently of inventory slots', () => {
    const documentStub = installDocumentStub();
    try {
        const runtime = new HudRuntimeSystem({ game: {}, ports: null });
        const container = createStubElement('item-bar');
        const sibling = createStubElement();
        container.parentNode = { insertBefore(child) { sibling._inserted = child; return child; } };
        container.nextSibling = sibling;
        // Player has a global shoot cooldown but empty inventory (item was
        // consumed by takeInventoryItem, so no per-slot indicator would show).
        runtime._updateItemBar(container, { inventory: [], shootCooldown: 1.25, itemUseCooldownRemaining: 0 }, { modeId: 'HUNT' });
        const indicator = runtime._cooldownIndicators.get(container);
        assert.ok(indicator, 'global cooldown indicator was created');
        assert.equal(indicator.textContent, '1.3s');
        assert.equal(indicator.classList.contains('hidden'), false);

        // Cooldown ended.
        runtime._updateItemBar(container, { inventory: [], shootCooldown: 0, itemUseCooldownRemaining: 0 }, { modeId: 'HUNT' });
        assert.equal(indicator.classList.contains('hidden'), true);
    } finally {
        documentStub.restore();
    }
});

// ---------------------------------------------------------------------------
// Fighter HUD guard clauses (pre-existing behavior, now pinned by tests)
// ---------------------------------------------------------------------------

test('HUD hides when the player is not alive', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud, container } = createHudInstance(documentStub);
        hud.update(createAlivePlayer(), 0.05, {});
        assert.equal(hud.visible, true);
        hud.update(createAlivePlayer({ alive: false }), 0.05, {});
        assert.equal(hud.visible, false);
        assert.equal(container.classList.contains('hidden'), true);
    } finally {
        documentStub.restore();
    }
});

test('HUD hides the center crosshair in planar mode only', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        hud.update(createAlivePlayer({ planarMode: true }), 0.05, {});
        assert.equal(hud.centerCrosshair.classList.contains('hidden'), true);
        hud.update(createAlivePlayer({ planarMode: false }), 0.05, {});
        assert.equal(hud.centerCrosshair.classList.contains('hidden'), false);
    } finally {
        documentStub.restore();
    }
});

test('HUD hides when the camera mode is not the gameplay camera', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud, container } = createHudInstance(documentStub);
        hud.update(createAlivePlayer(), 0.05, {});
        assert.equal(hud.visible, true);
        hud.update(createAlivePlayer({ cameraModeId: 'SPECTATOR' }), 0.05, {});
        assert.equal(hud.visible, false);
        assert.equal(container.classList.contains('hidden'), true);
    } finally {
        documentStub.restore();
    }
});

test('HUD heading wraps 359.5+ degrees to 000 instead of showing 360', () => {
    const documentStub = installDocumentStub();
    try {
        const { hud } = createHudInstance(documentStub);
        const yawRad = (0.4 * Math.PI) / 180; // heading = -yaw = -0.4 -> 359.6 -> rounds to 360
        hud.update(createAlivePlayer({
            quaternion: { x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) },
        }), 0.05, {});
        assert.equal(hud.headingValue.textContent, '000');

        const yaw10 = (10 * Math.PI) / 180; // heading 350
        hud.update(createAlivePlayer({
            quaternion: { x: 0, y: Math.sin(yaw10 / 2), z: 0, w: Math.cos(yaw10 / 2) },
        }), 0.05, {});
        assert.equal(hud.headingValue.textContent, '350');
    } finally {
        documentStub.restore();
    }
});

test('HUD constructs the player-two instance with the same tape ranges', () => {
    const documentStub = installDocumentStub();
    try {
        const hudP2 = new HUD('p2-fighter-hud', 1, { getCamera: () => null });
        assert.equal(hudP2.playerIndex, 1);
        assert.ok(hudP2.speedValue, 'p2 speed element resolved');
        assert.ok(hudP2.headingScale, 'p2 heading scale resolved');
        assert.equal(hudP2.headingScale.children.length, (480 + 120) / 15 + 1);
        assert.equal(hudP2._tapeSpeedMax, 650);
    } finally {
        documentStub.restore();
    }
});
