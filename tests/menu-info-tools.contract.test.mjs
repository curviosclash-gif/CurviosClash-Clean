import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { createMenuSchema } from '../src/ui/menu/MenuSchema.js';
import { MenuStateMachine, MENU_STATE_IDS } from '../src/ui/menu/MenuStateMachine.js';
import { resolveMenuDeveloperEnvironment } from '../src/ui/menu/MenuDeveloperEnvironment.js';
import { bindMenuToolsScreen } from '../src/ui/menu/MenuToolsBindings.js';
import {
    MENU_ACCESS_GUARD_REASONS,
    guardMenuRuntimeEvent,
    resolveMenuAccessContext,
} from '../src/ui/menu/MenuAccessPolicy.js';
import { MENU_VISIBILITY_KEYS } from '../src/shared/contracts/MenuVisibilityContract.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const region = (startMarker, endMarker) => {
    const start = html.indexOf(startMarker);
    const end = html.indexOf(endMarker, start + 1);
    assert.ok(start >= 0 && end > start, `${startMarker} .. ${endMarker}`);
    return html.slice(start, end);
};

test('the expert area with its password is gone from the page and the code', () => {
    for (const id of ['submenu-expert', 'btn-open-expert', 'btn-expert-lock-quick', 'expert-locked-state',
        'expert-unlocked-state', 'expert-password-input', 'btn-expert-unlock', 'btn-open-debug', 'submenu-debug']) {
        assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
    }
    assert.equal(existsSync(new URL('../src/ui/menu/MenuExpertLoginRuntime.js', import.meta.url)), false);
    assert.doesNotMatch(source('src/ui/dom/GameUiDomRefs.js'), /expert(Password|Unlock|Lock|Status)|openExpertButton/);
});

test('the debug telemetry panel is gone, the collecting stores stay', () => {
    for (const id of ['developer-telemetry-panel', 'telemetry-collection-toggle', 'btn-telemetry-export-json']) {
        assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
    }
    for (const file of ['MenuTelemetryDashboard.js', 'MenuTelemetryHeatmapView.js']) {
        assert.equal(existsSync(new URL(`../src/ui/menu/${file}`, import.meta.url)), false, file);
    }
    assert.equal(existsSync(new URL('../src/ui/menu/MenuTelemetryStore.js', import.meta.url)), true);
    assert.equal(existsSync(new URL('../src/state/TelemetryHistoryStore.js', import.meta.url)), true);
});

test('the config code exchange is gone from the settings window', () => {
    for (const id of ['config-share-input', 'btn-config-export-code', 'btn-config-export-json', 'btn-config-import', 'config-share-status']) {
        assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
    }
    assert.doesNotMatch(source('src/shared/contracts/MenuControllerContract.js'), /CONFIG_(EXPORT|IMPORT)/);
});

test('the settings window lost its tools tab, the other tabs stay', () => {
    assert.doesNotMatch(html, /level4-tab-utilities|level4-section-utilities/);
    // Karten-Details left with the drawer package; the remaining tabs stay.
    for (const tab of ['controls', 'audio', 'graphics', 'recording', 'hud', 'tools']) {
        assert.match(html, new RegExp(`id="level4-tab-${tab}"`), tab);
    }
});

test('Info sits in the footer next to Beenden and opens a panel with build info and keys', () => {
    const footer = region('<div class="menu-stage-footer">', '<p id="menu-context"');
    assert.match(footer, /id="btn-main-info"[^>]*data-menu-step-target="submenu-info"/);
    assert.match(footer, /id="btn-quit-game"/);
    const info = region('<div id="submenu-info"', '<!-- ======= SUBMENU: BENUTZERDEFINIERT');
    for (const id of ['build-info', 'build-info-detail', 'btn-copy-build']) assert.match(info, new RegExp(`id="${id}"`), id);
    assert.match(info, /Tastenübersicht/);
    assert.match(info, /<kbd>O<\/kbd>/);
});

test('the Werkzeuge button opens its own screen with both editors', () => {
    const side = region('class="menu-utility-shell menu-side-links"', '<div class="menu-stage-footer">');
    assert.match(side, /id="btn-main-tools"[^>]*data-menu-step-target="submenu-tools"/);
    assert.doesNotMatch(side, /level4-section="utilities"/);
    const tools = region('<div id="submenu-tools"', '<!-- ======= SUBMENU: INFO');
    assert.match(tools, /id="btn-open-editor"/);
    assert.match(tools, /id="btn-open-vehicle-editor"/);
});

test('developer functions sit in a block that only the development environment shows', () => {
    const tools = region('<div id="submenu-tools"', '<!-- ======= SUBMENU: INFO');
    const block = tools.slice(tools.indexOf('id="tools-developer-block"'));
    assert.match(block, /data-menu-visibility-key="developerTools"[^>]*hidden/);
    assert.match(block, /data-menu-visibility-key="tuningConsoleHint"/);
    for (const id of ['arcade-intermission-slider', 'bot-heuristic-profile-select', 'bot-heuristic-survival-slider']) {
        assert.match(block, new RegExp(`id="${id}"`), id);
    }
    assert.ok(tools.indexOf('id="btn-open-editor"') < tools.indexOf('id="tools-developer-block"'), 'editors stay outside the block');
    assert.ok(!MENU_VISIBILITY_KEYS.includes('telemetryPanel'));
});

test('the visibility of the developer block follows the development environment', () => {
    const makePanel = () => {
        const block = {
            hidden: true,
            getAttribute: (name) => (name === 'data-menu-visibility-key' ? 'developerTools' : null),
            setAttribute() {},
            removeAttribute() {},
        };
        return { block, panel: { querySelectorAll: () => [block] } };
    };
    const shipped = makePanel();
    bindMenuToolsScreen({ ui: { toolsPanel: shipped.panel }, runtimeGlobal: { curviosApp: { developerEnvironment: false } } });
    assert.equal(shipped.block.hidden, true);
    const dev = makePanel();
    bindMenuToolsScreen({ ui: { toolsPanel: dev.panel }, runtimeGlobal: { curviosApp: { developerEnvironment: true } } });
    assert.equal(dev.block.hidden, false);
});

test('development environment: the shell reports it, a packaged page never is one', () => {
    assert.equal(resolveMenuDeveloperEnvironment({ runtimeGlobal: {}, viteDev: false }), false);
    assert.equal(resolveMenuDeveloperEnvironment({ runtimeGlobal: { curviosApp: {} }, viteDev: false }), false);
    assert.equal(resolveMenuDeveloperEnvironment({ runtimeGlobal: { curviosApp: { developerEnvironment: true } }, viteDev: false }), true);
    assert.equal(resolveMenuDeveloperEnvironment({ runtimeGlobal: {}, viteDev: true }), true);
    assert.match(source('electron/main.cjs'), /isDeveloperEnvironment\(\) \? \[DEVELOPER_ENVIRONMENT_ARGUMENT\] : \[\]/);
    assert.match(source('electron/main.cjs'), /additionalArguments:\s*\[/);
    assert.match(source('electron/preload.cjs'), /developerEnvironment: DEVELOPER_ENVIRONMENT/);
});

test('developer events are locked outside the development environment, without any password', () => {
    const locked = guardMenuRuntimeEvent('developer_mode_toggle', { isOwner: true, developerToolsEnabled: false });
    assert.deepEqual([locked.allowed, locked.reason], [false, MENU_ACCESS_GUARD_REASONS.LOCKED]);
    assert.equal(guardMenuRuntimeEvent('developer_mode_toggle', { isOwner: true, developerToolsEnabled: true }).allowed, true);
    assert.equal(resolveMenuAccessContext({}).developerToolsEnabled, false, 'plain node run is no development environment');
    assert.doesNotMatch(source('src/ui/menu/MenuAccessPolicy.js'), /expert/i);
});

test('the menu knows the tools and info screens and no expert or debug state', () => {
    const ids = createMenuSchema({}).panels.map((panel) => panel.id);
    assert.ok(ids.includes('submenu-tools') && ids.includes('submenu-info'));
    assert.ok(!ids.includes('submenu-expert') && !ids.includes('submenu-debug'));
    const machine = new MenuStateMachine({ initialState: MENU_STATE_IDS.MAIN });
    assert.equal(machine.transition(MENU_STATE_IDS.TOOLS).blocked, false);
    assert.equal(machine.transition(MENU_STATE_IDS.MAIN).blocked, false);
    assert.equal(machine.transition(MENU_STATE_IDS.INFO).blocked, false);
    assert.equal(MENU_STATE_IDS.EXPERT, undefined);
});
