import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('index.html');
const styleCss = read('style.css');
const glowCss = read('src/ui/menu/Leuchtspuren.css');
const appShellCss = read('app-shell.css');

function section(id) {
    return html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`))?.[0] || '';
}

test('the light/dark menu scheme is gone from markup, styles and settings keys', () => {
    assert.doesNotMatch(html, /id="theme-mode-select"|id="theme-field-hint"/);
    for (const css of [styleCss, glowCss, appShellCss]) {
        assert.doesNotMatch(css, /data-menu-local-theme/);
    }
    assert.equal('LOCAL_THEME_MODE' in SETTINGS_CHANGE_KEYS, false);
    for (const path of ['src/ui/UIManager.js', 'src/ui/menu/MenuConfigShareOps.js', 'src/core/runtime/MatchStartValidationService.js']) {
        assert.doesNotMatch(read(path), /themeMode/, path);
    }
});

test('a stored theme from an old save is accepted and dropped', () => {
    const settings = ensureMenuContractState({ localSettings: { sessionType: 'single', themeMode: 'hell' } });
    assert.equal('themeMode' in settings.localSettings, false);
});

test('the Mobile tab only shows in the Mobile Classic app', () => {
    assert.match(styleCss, /body:not\(\.mobile-classic-app\) :is\(#level4-tab-mobile-controls, #level4-section-mobile-controls\)\s*\{\s*display:\s*none !important;/);
});

test('the always-on cockpit checkboxes are removed', () => {
    assert.doesNotMatch(html, /id="cockpit-cam-p[12]"/);
});

test('settings save on their own, so both extra save buttons are gone', () => {
    assert.doesNotMatch(html, /id="btn-save-keys"/);
    const gamepadEditor = read('src/ui/GamepadBindingEditor.js');
    assert.doesNotMatch(gamepadEditor, /Einstellungen speichern/);
    // The named snapshot in the players tab is a different action and stays.
    assert.match(html, /id="btn-profile-save"/);
});

test('the video perspective sits in the recording tab while live camera options stay', () => {
    assert.match(section('level4-section-recording'), /id="normal-camera-perspective-select"/);
    const graphics = section('level4-section-graphics');
    assert.doesNotMatch(graphics, /id="normal-camera-perspective-select"/);
    // Speed FOV and calmer camera also drive the live camera (CameraRigSystem), not only videos.
    assert.match(graphics, /id="normal-camera-speed-fov-toggle"/);
    assert.match(graphics, /id="normal-camera-reduce-motion-toggle"/);
});

test('the controls and expert entries use the normal text colour', () => {
    assert.doesNotMatch(glowCss, /\[data-level4-section="controls"\], #main-menu \.expert-entry-btn \{[^}]*--lobby-muted/);
});

test('the active settings tab no longer shifts sideways into a scrollbar', () => {
    const activeRule = styleCss.match(/\.level4-section-tab\[aria-selected="true"\] \{[^}]*\}/)?.[0] || '';
    assert.ok(activeRule);
    assert.doesNotMatch(activeRule, /translateX/);
});
