import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMenuRulesSummary } from '../src/ui/start-setup/StartSetupMultiplayerUiSync.js';
import { resolveSyncMethodNamesForChangeKeys, START_SETUP_SYNC_METHOD } from '../src/ui/UISettingsSyncMap.js';
import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import {
    renderStartFieldHints,
    resolveLockedStartFieldHints,
    SOLO_FIGHT_WITHOUT_BOTS_HINT,
} from '../src/ui/start-setup/StartSetupValidationView.js';
import { ensureMenuContractState, LEVEL4_SECTION_IDS } from '../src/ui/menu/MenuStateContracts.js';
import { resolveMobileAndroidLevel4SectionId } from '../src/mobile-classic/MobileClassicMenuUi.js';

test('rule summaries distinguish classic rounds, respawning combat and arcade sectors', () => {
    const base = { numBots: 2, botDifficulty: 'HARD', winsNeeded: 5, gameMode: 'CLASSIC' };
    assert.equal(formatMenuRulesSummary(base, 'normal'), '2 Bots · Schwer · 5 Siege');
    assert.equal(formatMenuRulesSummary({ ...base, numBots: 0, winsNeeded: 1 }, 'normal'), 'Ohne Bots · 1 Sieg');
    assert.equal(formatMenuRulesSummary({ ...base, gameMode: 'HUNT', hunt: { respawnEnabled: true, deathmatchKillLimit: 12 } }, 'fight'), '2 Bots · Schwer · 12 Abschüsse · 5 Siege');
    assert.equal(formatMenuRulesSummary({ ...base, arcade: { sectorCount: 7 } }, 'arcade'), '7 Sektoren · Punkte sammeln');
});

test('respawning combat names the round wins once a match needs more than one', () => {
    const fight = { numBots: 3, botDifficulty: 'HARD', gameMode: 'HUNT', hunt: { respawnEnabled: true, deathmatchKillLimit: 5 } };
    assert.equal(formatMenuRulesSummary({ ...fight, winsNeeded: 2 }, 'fight'), '3 Bots · Schwer · 5 Abschüsse · 2 Siege');
    assert.equal(formatMenuRulesSummary({ ...fight, winsNeeded: 1 }, 'fight'), '3 Bots · Schwer · 5 Abschüsse');
});

function createHintElement() {
    const classes = new Set(['hidden']);
    return {
        textContent: '',
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
            contains: (name) => classes.has(name),
        },
    };
}

test('a single player Fight without bots explains that nobody will fight back', () => {
    const matchFieldHint = createHintElement();
    const settings = { numBots: 0, localSettings: { sessionType: 'single', modePath: 'fight' } };

    renderStartFieldHints({ ui: { matchFieldHint }, settings, settingsManager: null });
    assert.equal(matchFieldHint.textContent, SOLO_FIGHT_WITHOUT_BOTS_HINT);
    assert.equal(matchFieldHint.classList.contains('hidden'), false);

    renderStartFieldHints({ ui: { matchFieldHint }, settings: { ...settings, numBots: 2 }, settingsManager: null });
    assert.equal(matchFieldHint.classList.contains('hidden'), true, 'the hint goes away once a bot is set');

    const splitscreen = { numBots: 0, localSettings: { sessionType: 'splitscreen', modePath: 'fight' } };
    renderStartFieldHints({ ui: { matchFieldHint }, settings: splitscreen, settingsManager: null });
    assert.equal(matchFieldHint.classList.contains('hidden'), true, 'two local players can fight each other');
});

test('every rule shown in the start summary redraws that summary when it changes', () => {
    const summaryKeys = [
        SETTINGS_CHANGE_KEYS.BOTS_COUNT,
        SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY,
        SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED,
        SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
        SETTINGS_CHANGE_KEYS.HUNT_DEATHMATCH_KILL_LIMIT,
        SETTINGS_CHANGE_KEYS.ARCADE_SECTOR_COUNT,
    ];
    for (const key of summaryKeys) {
        assert.ok(
            resolveSyncMethodNamesForChangeKeys([key]).includes(START_SETUP_SYNC_METHOD),
            `${key} has to redraw the start summary`
        );
    }
});

test('locked-field hints explain fixed presets without exposing internal setting paths', () => {
    const manager = { listMenuPresets: () => [{ id: 'combat', name: 'Kampf', metadata: { lockedFields: ['gameMode', 'hunt.deathmatchKillLimit', 'custom.internal.path'] } }] };
    const settings = { matchSettings: { activePresetId: 'combat', activePresetKind: 'fixed' } };
    const message = resolveLockedStartFieldHints(settings, manager).get('match');
    assert.match(message, /Spielmodus.*Abschussziel.*Weitere Spielregeln/u);
    assert.match(message, /Vorlagen/u);
    assert.doesNotMatch(message, /gameMode|hunt\.|custom\./u);
    assert.equal(resolveLockedStartFieldHints({ matchSettings: { ...settings.matchSettings, activePresetKind: 'custom' } }, manager).size, 0);
});

test('new settings sections survive normalization and remain accessible on mobile', () => {
    for (const section of [LEVEL4_SECTION_IDS.AUDIO, LEVEL4_SECTION_IDS.GRAPHICS, LEVEL4_SECTION_IDS.RECORDING, LEVEL4_SECTION_IDS.HUD]) {
        const settings = { localSettings: { toolsState: { activeSection: section } } };
        ensureMenuContractState(settings);
        assert.equal(settings.localSettings.toolsState.activeSection, section);
        assert.equal(resolveMobileAndroidLevel4SectionId(section), section);
    }
});


test('focus eligibility keeps closed summaries but excludes their controls, hidden and disabled actions', async () => {
    const { isAvailable } = await import('../src/ui/menu/MenuNavigationFocusOps.js');
    const summary = { contains: (element) => element === summary };
    const details = { tagName: 'DETAILS', open: false, querySelector: () => summary };
    summary.parentElement = details;
    assert.equal(isAvailable(summary), true);
    assert.equal(isAvailable({ parentElement: details }), false);
    details.open = true;
    assert.equal(isAvailable({ parentElement: details }), true);
    assert.equal(isAvailable({ disabled: true }), false);
    assert.equal(isAvailable({ getAttribute: () => 'true' }), false);
    assert.equal(isAvailable({ getClientRects: () => [] }), false);
    assert.equal(isAvailable({ closest: () => ({ inert: true }) }), false);
});
