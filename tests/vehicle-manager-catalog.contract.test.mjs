import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    getVehicleManagerInteractionRules,
    listVehicleManagerCatalogEntries,
    resolveVehicleManagerCatalogEntry,
} from '../src/ui/arcade/VehicleManagerCatalog.js';

test('vehicle manager catalog entries expose required metadata', () => {
    const entries = listVehicleManagerCatalogEntries();
    assert.ok(entries.length > 0);

    for (const entry of entries) {
        assert.ok(entry.vehicleId.length > 0);
        assert.ok(entry.label.length > 0);
        assert.ok(['jaeger', 'kreuzer', 'spezial', 'custom'].includes(entry.kategorie));
        assert.ok(['kompakt', 'standard', 'schwer'].includes(entry.hitboxKlasse));
        assert.ok(entry.kurzbeschreibung.length > 0);
        assert.equal(Number.isInteger(entry.sortOrder), true);
        assert.ok(entry.keywords.length > 0);
        assert.ok(entry.previewToken.length > 0);
        for (const stat of ['armor', 'agility', 'control', 'upgradePotential']) {
            assert.equal(typeof entry.statsSummary[stat], 'number');
        }
    }
});

test('vehicle manager interaction rules define filters and responsive breakpoints', () => {
    const rules = getVehicleManagerInteractionRules();

    assert.equal(rules.version, '66.1');
    assert.deepEqual(rules.categories.map((entry) => entry.id), ['all', 'jaeger', 'kreuzer', 'spezial', 'custom']);
    assert.ok(rules.filterChips.category.includes('jaeger'));
    assert.ok(rules.filterChips.hitboxKlasse.includes('kompakt'));
    assert.equal(rules.preview.mode, 'interactive-3d');
    assert.equal(rules.preview.allowOrbit, true);
    assert.equal(rules.upgradeFlow.maxTier, 'T3');
    assert.equal(rules.responsiveBreakpoints.stackedPanelMaxWidth, 1000);
    assert.equal(rules.responsiveBreakpoints.compactListMaxWidth, 700);
});

test('vehicle manager catalog provides a stable fallback for unknown vehicle ids', () => {
    const fallback = resolveVehicleManagerCatalogEntry('ghost_vehicle');

    assert.equal(fallback.vehicleId, 'ghost_vehicle');
    assert.equal(fallback.label, 'ghost_vehicle');
    assert.equal(fallback.kategorie, 'custom');
    assert.equal(fallback.hitboxKlasse, 'standard');
    assert.equal(fallback.previewToken, 'vehicle:placeholder');
    assert.ok(fallback.statsSummary.upgradePotential > 0);
});
