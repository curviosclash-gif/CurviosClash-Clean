import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeHuntWinCondition } from '../src/shared/contracts/HuntWinConditionContract.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { sanitizeSettingsSnapshot } from '../src/core/settings/SettingsSanitizerOps.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { createLobbyMatchSummary } from '../src/shared/contracts/LobbyMatchSummaryContract.js';

test('HUNT win condition survives settings, runtime and lobby boundaries', () => {
    const defaults = createDefaultSettingsSnapshot();
    assert.equal(defaults.hunt.winCondition, 'kills_time');
    assert.equal(normalizeHuntWinCondition('bad'), 'kills_time');
    assert.equal(normalizeHuntWinCondition(null), 'kills_time');

    for (const winCondition of ['kills_time', 'last_alive', 'score_target']) {
        const settings = sanitizeSettingsSnapshot({
            gameMode: 'HUNT',
            hunt: { respawnEnabled: true, deathmatchKillLimit: 10, winCondition },
        }, createDefaultSettingsSnapshot);
        assert.equal(settings.hunt.winCondition, winCondition);
        const runtime = createRuntimeConfigSnapshot(settings);
        assert.equal(runtime.hunt.winCondition, winCondition);
        const entity = createEntityRuntimeConfig(runtime);
        assert.equal(entity.HUNT.WIN_CONDITION, winCondition);
        const summary = createLobbyMatchSummary(settings);
        assert.equal(summary.winCondition, winCondition);
        assert.equal(summary.targetKind, winCondition === 'score_target' ? 'points' : winCondition === 'last_alive' ? 'lives' : 'kills');
    }
});
