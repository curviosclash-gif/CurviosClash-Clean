import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSettingsSnapshot } from '../src/core/settings/SettingsSanitizerOps.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import {
    deriveFreePlayVariant,
    resolveFreePlayVariantSettings,
} from '../src/shared/contracts/FreePlayVariantContract.js';

// The team objective is no longer a toggle plus a select: it is the free play variant.
// What used to be "remember the objective across the team toggle" is now "the chosen
// variant survives a profile save and comes back as the same variant".
function chooseVariant(settings, variant) {
    const pinned = resolveFreePlayVariantSettings(variant);
    settings.gameMode = pinned.gameMode;
    settings.localSettings.modePath = pinned.modePath;
    settings.hunt.teamMode = pinned.teamMode;
    settings.hunt.teamObjective = pinned.teamObjective;
    settings.localSettings.freePlayVariant = variant;
}

for (const variant of ['flags', 'escort', 'team', 'ffa', 'classic']) {
    test(`the ${variant} variant survives a profile save`, () => {
        const settings = createDefaultSettingsSnapshot();
        chooseVariant(settings, variant);
        const restored = sanitizeSettingsSnapshot(settings, createDefaultSettingsSnapshot);
        ensureMenuContractState(restored);
        assert.equal(deriveFreePlayVariant(restored), variant);
        assert.equal(restored.localSettings.freePlayVariant, variant);
    });
}

test('the most recently chosen variant replaces the previous one', () => {
    const settings = createDefaultSettingsSnapshot();
    chooseVariant(settings, 'escort');
    chooseVariant(settings, 'flags');
    const restored = sanitizeSettingsSnapshot(settings, createDefaultSettingsSnapshot);
    assert.equal(deriveFreePlayVariant(restored), 'flags');
});
