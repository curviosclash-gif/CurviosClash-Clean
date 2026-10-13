import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    LEVEL4_RESET_SCOPES,
    applyLevel4Reset,
    isLevel4ResetSection,
    resolveLevel4ResetLabel,
} from '../src/shared/settings/Level4ResetScopes.js';
import { isSettingsChangeKey } from '../src/shared/settings/SettingsChangeKeys.js';
import {
    DEFAULT_MENU_SCALE,
    normalizeMenuScale,
    resolveMenuScaleFactor,
} from '../src/shared/contracts/MenuScaleContract.js';
import { LEVEL4_SECTION_IDS, ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { GUEST_LOCKED_LEVEL4_SECTIONS } from '../src/ui/start-setup/LobbyGuestMatchLock.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function createDefaults() {
    return {
        autoRoll: true,
        invertPitch: { PLAYER_1: true, PLAYER_2: true, PLAYER_3: true },
        cockpitCamera: { PLAYER_1: true, PLAYER_2: true },
        cameraPerspective: { normal: 'classic', reduceMotion: true },
        recording: { profile: 'standard', hudMode: 'clean', orientation: 'landscape' },
        localSettings: {
            graphicsStyle: 'modern', shadowQuality: 3, bloomQuality: 0, graphicsQuality: 'auto',
            mapBrightness: 'mittel', viewDistance: 0, menuScale: 100,
            mouseSteering: false, gamepadVibration: true, smoothSteering: false,
            audio: { enabled: true, masterVolume: 1 },
            hud: { scale: 1, opacity: 1 },
        },
    };
}

function createChanged() {
    return {
        autoRoll: false,
        invertPitch: { PLAYER_1: false, PLAYER_2: false, PLAYER_3: false },
        cockpitCamera: { PLAYER_1: false, PLAYER_2: false },
        cameraPerspective: { normal: 'cinematic_action', reduceMotion: false },
        recording: { profile: 'youtube_short', hudMode: 'with_hud', orientation: 'portrait' },
        localSettings: {
            graphicsStyle: 'classic', shadowQuality: 0, bloomQuality: 2, graphicsQuality: 'LOW', bloomQualityUserSet: true,
            mapBrightness: 'hell', viewDistance: 80, menuScale: 140,
            mouseSteering: true, gamepadVibration: false, smoothSteering: true,
            audio: { enabled: false, masterVolume: 0.2 },
            hud: { scale: 1.4, opacity: 0.5 },
        },
    };
}

// The fields each tab owns; a reset must change these and nothing outside them.
const OWNED_FIELDS = {
    controls: ['autoRoll', 'invertPitch', 'localSettings.mouseSteering', 'localSettings.gamepadVibration', 'localSettings.smoothSteering'],
    graphics: ['cockpitCamera', 'cameraPerspective.reduceMotion', 'localSettings.graphicsStyle', 'localSettings.shadowQuality',
        'localSettings.bloomQuality', 'localSettings.bloomQualityUserSet', 'localSettings.graphicsQuality',
        'localSettings.mapBrightness', 'localSettings.viewDistance', 'localSettings.menuScale'],
    audio: ['localSettings.audio'],
    hud: ['localSettings.hud'],
    // The video perspective select sits in the recording tab.
    recording: ['recording', 'cameraPerspective.normal'],
};

function flatten(settings) {
    const out = {};
    const walk = (value, path) => {
        if (value && typeof value === 'object') {
            for (const [key, inner] of Object.entries(value)) walk(inner, path ? `${path}.${key}` : key);
        } else out[path] = value;
    };
    walk(settings, '');
    return out;
}

test('the reset table covers the five tabs with settings and no other tab', () => {
    assert.deepEqual(Object.keys(LEVEL4_RESET_SCOPES).sort(), ['audio', 'controls', 'graphics', 'hud', 'recording']);
    for (const sectionId of ['tools', 'utilities', 'mobile_controls', 'advanced_map', '', undefined]) {
        assert.equal(isLevel4ResetSection(sectionId), false, String(sectionId));
        assert.equal(resolveLevel4ResetLabel(sectionId), '');
    }
    assert.equal(resolveLevel4ResetLabel('graphics'), 'Grafik & Kamera zurücksetzen');
    assert.equal(resolveLevel4ResetLabel('controls'), 'Steuerung zurücksetzen');
});

test('every reset publishes only valid change keys', () => {
    for (const [sectionId, scope] of Object.entries(LEVEL4_RESET_SCOPES)) {
        assert.ok(scope.changeKeys.length > 0, sectionId);
        for (const key of scope.changeKeys) assert.ok(isSettingsChangeKey(key), `${sectionId}: ${key}`);
    }
});

for (const [sectionId, owned] of Object.entries(OWNED_FIELDS)) {
    test(`resetting ${sectionId} restores its own fields and leaves every other tab alone`, () => {
        const settings = createChanged();
        const before = flatten(createChanged());
        const keys = applyLevel4Reset(settings, createDefaults(), sectionId);
        assert.deepEqual(keys, [...LEVEL4_RESET_SCOPES[sectionId].changeKeys]);
        const after = flatten(settings);
        const isOwned = (path) => owned.some((field) => path === field || path.startsWith(`${field}.`));
        for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (isOwned(path)) assert.notEqual(after[path], before[path], `${path} should be reset`);
            else assert.equal(after[path], before[path], `${path} must stay`);
        }
    });
}

test('a tab without a reset touches nothing and publishes nothing', () => {
    const settings = createChanged();
    assert.equal(applyLevel4Reset(settings, createDefaults(), 'tools'), null);
    assert.deepEqual(settings, createChanged());
});

test('the graphics reset also returns bloom and the level to the automatic state', () => {
    const settings = createChanged();
    applyLevel4Reset(settings, createDefaults(), 'graphics');
    assert.equal(settings.localSettings.bloomQualityUserSet, false);
    assert.equal(settings.localSettings.graphicsQuality, 'auto');
});

test('menu size is a percent from 100 to 150 in steps of 10', () => {
    assert.equal(DEFAULT_MENU_SCALE, 100);
    assert.equal(normalizeMenuScale(120), 120);
    assert.equal(normalizeMenuScale('130'), 130);
    assert.equal(normalizeMenuScale(114), 110);
    assert.equal(normalizeMenuScale(60), 100);
    assert.equal(normalizeMenuScale(400), 150);
    for (const bad of [undefined, null, '', 'x', NaN]) assert.equal(normalizeMenuScale(bad), 100, String(bad));
    assert.equal(normalizeMenuScale('x', 120), 120);
    assert.equal(resolveMenuScaleFactor(150), 1.5);
});

test('the menu size survives the settings normalizer and falls back to 100', () => {
    const settings = { localSettings: { menuScale: 130 } };
    ensureMenuContractState(settings);
    assert.equal(settings.localSettings.menuScale, 130);
    const broken = { localSettings: { menuScale: 'huge' } };
    ensureMenuContractState(broken);
    assert.equal(broken.localSettings.menuScale, 100);
});

test('the Karten-Details tab is gone and a stored one falls back to the controls tab', () => {
    assert.equal(Object.values(LEVEL4_SECTION_IDS).includes('advanced_map'), false);
    const settings = { localSettings: { toolsState: { activeSection: 'advanced_map' } } };
    ensureMenuContractState(settings);
    assert.equal(settings.localSettings.toolsState.activeSection, 'controls');
    const kept = { localSettings: { toolsState: { activeSection: 'recording' } } };
    ensureMenuContractState(kept);
    assert.equal(kept.localSettings.toolsState.activeSection, 'recording');
    assert.deepEqual([...GUEST_LOCKED_LEVEL4_SECTIONS], []);
});

test('the drawer shows the tabs in the agreed order and no Karten-Details', () => {
    const nav = /<div class="level4-section-nav"[\s\S]*?<div class="level4-section-stack">/u.exec(html)?.[0] || '';
    const order = [...nav.matchAll(/data-level4-section-target="([a-z_]+)"/gu)].map((match) => match[1]);
    assert.deepEqual(order, ['controls', 'mobile_controls', 'graphics', 'audio', 'hud', 'recording', 'tools']);
    assert.doesNotMatch(html, /advanced[_-]map/u);
});

test('saved settings sit in the drawer footer, the player tab keeps only the player profiles', () => {
    // The drawer ends where the next screen (Werkzeuge) begins.
    const footer = /<div class="level4-footer[\s\S]*?<!-- ======= SUBMENU: WERKZEUGE/u.exec(html)?.[0] || '';
    const backups = /<div id="level4-backups"[\s\S]*?<div class="level4-footer-actions">/u.exec(footer)?.[0] || '';
    for (const id of ['profile-name', 'btn-profile-save', 'profile-select', 'btn-profile-load', 'btn-profile-delete',
        'btn-profile-duplicate', 'btn-profile-set-default', 'profile-transfer-input', 'btn-profile-export',
        'btn-profile-import', 'profile-transfer-status']) {
        assert.match(backups, new RegExp(`id="${id}"`, 'u'), id);
    }
    assert.match(backups, /\bhidden>/u);
    for (const id of ['btn-level4-reset', 'btn-level4-backups']) assert.match(footer, new RegExp(`id="${id}"`, 'u'), id);
    assert.match(footer, /id="btn-level4-backups"[^>]*aria-pressed="false"[^>]*aria-expanded="false"/u);
    const tools = /<section id="level4-section-tools"[\s\S]*?<\/section>/u.exec(html)?.[0] || '';
    assert.doesNotMatch(tools, /id="(?:btn-)?profile-(?:name|save|select|load|transfer)/u);
    assert.match(tools, /id="player-profile-name"/u);
    const header = /<div class="level4-header">[\s\S]*?<div class="submenu-body level4-body">/u.exec(html)?.[0] || '';
    assert.doesNotMatch(header, /btn-level4-reset/u);
});

test('the menu size slider sits in the graphics tab and the drawer style is linked after the tokens', () => {
    const graphics = /<section id="level4-section-graphics"[\s\S]*?<\/section>/u.exec(html)?.[0] || '';
    assert.match(graphics, /id="menu-scale-slider" min="100" max="150" step="10"/u);
    assert.ok(html.indexOf('MenuDrawer.css') > html.indexOf('MenuTokens.css'));
    const css = readFileSync(new URL('../src/ui/menu/MenuDrawer.css', import.meta.url), 'utf8');
    assert.match(css, /\[class\*="menu-q-"\]\[hidden\]\s*\{\s*display:\s*none/u);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//gu, ''), /#[0-9a-fA-F]{3,8}\b|rgba?\(/u, 'no colours of its own');
});
