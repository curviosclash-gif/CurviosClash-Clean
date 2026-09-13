import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMenuRulesSummary } from '../src/ui/start-setup/StartSetupMultiplayerUiSync.js';
import { resolveLockedStartFieldHints } from '../src/ui/start-setup/StartSetupValidationView.js';
import { ensureMenuContractState, LEVEL4_SECTION_IDS } from '../src/ui/menu/MenuStateContracts.js';
import { resolveMobileAndroidLevel4SectionId } from '../src/mobile-classic/MobileClassicMenuUi.js';

test('rule summaries distinguish classic rounds, respawning combat and arcade sectors', () => {
    const base = { numBots: 2, botDifficulty: 'HARD', winsNeeded: 5, gameMode: 'CLASSIC' };
    assert.equal(formatMenuRulesSummary(base, 'normal'), '2 Bots · Schwer · 5 Siege');
    assert.equal(formatMenuRulesSummary({ ...base, numBots: 0, winsNeeded: 1 }, 'normal'), 'Ohne Bots · 1 Sieg');
    assert.equal(formatMenuRulesSummary({ ...base, gameMode: 'HUNT', hunt: { respawnEnabled: true, deathmatchKillLimit: 12 } }, 'fight'), '2 Bots · Schwer · 12 Abschüsse');
    assert.equal(formatMenuRulesSummary({ ...base, arcade: { sectorCount: 7 } }, 'arcade'), '7 Sektoren · Punkte sammeln');
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
