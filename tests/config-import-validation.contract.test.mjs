import assert from 'node:assert/strict';
import test from 'node:test';

import {
    exportMenuConfigAsJson,
    importMenuConfigFromInput,
    parseMenuConfigImportInput,
} from '../src/ui/menu/MenuConfigShareOps.js';
import { handleConfigImportAction } from '../src/core/runtime/MenuRuntimePresetConfigService.js';

test('a versioned Curvios Clash export reports the number of imported settings', () => {
    const exported = JSON.parse(exportMenuConfigAsJson({ mapKey: 'standard', numBots: 3 }));
    const settings = { mapKey: 'other', numBots: 0 };
    const result = importMenuConfigFromInput(settings, JSON.stringify(exported));

    assert.equal(result.success, true);
    assert.equal(result.appliedValueCount, Object.keys(exported.payload).length);
    assert.match(result.message, new RegExp(`${result.appliedValueCount} Werte übernommen`));
    assert.equal(settings.mapKey, 'standard');
    assert.equal(settings.numBots, 3);
});

test('garbage, foreign JSON, incomplete versioned payloads and empty input never report success', () => {
    for (const input of [
        'bm90LWpzb24=',
        JSON.stringify({ title: 'other-app', mapKey: 'standard', numBots: 2 }),
        JSON.stringify({ contractVersion: 'menu-config-share.v1', payload: { mapKey: 'standard' } }),
        '',
    ]) {
        const settings = { mapKey: 'original', numBots: 4 };
        const result = importMenuConfigFromInput(settings, input);
        assert.equal(result.success, false, input);
        assert.equal(result.message, 'Import fehlgeschlagen: Daten passen nicht zu Curvios Clash');
        assert.deepEqual(settings, { mapKey: 'original', numBots: 4 });
    }
});

test('legacy two-field imports keep omitted settings and report two imported values', () => {
    const settings = { mode: '2p', gameMode: 'HUNT', mapKey: 'original', numBots: 4 };
    const result = importMenuConfigFromInput(settings, JSON.stringify({ mapKey: 'standard', numBots: 2 }));

    assert.equal(result.success, true);
    assert.equal(result.usedLegacyFallback, true);
    assert.equal(result.appliedValueCount, 2);
    assert.equal(settings.mode, '2p');
    assert.equal(settings.gameMode, 'HUNT');
    assert.equal(settings.mapKey, 'standard');
    assert.equal(settings.numBots, 2);
});

test('the runtime import action shows the rejection instead of an import success toast', () => {
    const toasts = [];
    const game = {
        settings: { mapKey: 'original', numBots: 4 },
        ui: { configShareStatus: { textContent: '', setAttribute() {} } },
        _showStatusToast(message) { toasts.push(message); },
    };
    handleConfigImportAction({ game, inputValue: JSON.stringify({ mapKey: 'standard' }) });

    assert.equal(toasts[0], 'Import fehlgeschlagen: Daten passen nicht zu Curvios Clash');
    assert.equal(game.ui.configShareStatus.textContent, toasts[0]);
    assert.equal(game.settings.mapKey, 'original');
});
