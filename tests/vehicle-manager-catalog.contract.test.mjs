import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    getVehicleManagerInteractionRules,
    listArcadeVehicleManagerCatalogEntries,
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

test('arcade catalog entries carry the fixed role instead of the hitbox class', () => {
    const entries = listArcadeVehicleManagerCatalogEntries();
    assert.equal(entries.length, 8);
    for (const entry of entries) {
        assert.ok(['fighter', 'allrounder', 'tank'].includes(entry.rolle), entry.vehicleId);
        assert.equal(entry.rolle, entry.arcadeBalance.role, entry.vehicleId);
        assert.equal('hitboxKlasse' in entry, false, entry.vehicleId);
        assert.ok(entry.keywords.includes(entry.rolle), `${entry.vehicleId} is searchable by its role`);
        assert.equal(entry.keywords.some((word) => ['kompakt', 'schwer'].includes(word)), false, entry.vehicleId);
        assert.ok(entry.kurzbeschreibung.length > 0);
    }
    assert.equal(resolveVehicleManagerCatalogEntry('manta').hitboxKlasse, 'schwer', 'Classic keeps the hitbox class');
});

test('factory ships expose the arcade balance table separately as arcadeBalance', () => {
    const manta = resolveVehicleManagerCatalogEntry('manta');
    assert.deepEqual(manta.arcadeBalance, {
        role: 'tank', maxHpPct: 150, speedPct: 80, turnPct: 75, itemCapacity: 7, rocketCapacity: 8,
    });
    assert.equal(resolveVehicleManagerCatalogEntry('arrow').arcadeBalance.role, 'fighter');
    assert.equal('maxHpPct' in manta.statsSummary, false);
});

// Classic (StartSetupVehiclePicker3d) and the Fight hangar (HangarStatProjection) read
// armor/agility/control; these must keep main's hitbox-radius formula for every ship.
test('statsSummary armor/agility/control stay the hitbox-radius estimate from main', () => {
    const clampScore = (value) => Math.max(1, Math.min(5, value));
    for (const entry of listVehicleManagerCatalogEntries()) {
        const radius = entry.statsSummary.hitboxRadius;
        const armor = clampScore(Math.round(2 + radius * 2));
        const agilityBase = clampScore(Math.round(6 - radius * 2));
        const agility = entry.kategorie === 'jaeger' ? clampScore(agilityBase + 1) : agilityBase;
        const control = clampScore(Math.round((agility + armor) / 2) + (entry.kategorie === 'spezial' ? 1 : 0));
        assert.deepEqual(
            [entry.statsSummary.armor, entry.statsSummary.agility, entry.statsSummary.control],
            [armor, agility, control],
            entry.vehicleId,
        );
    }
});

test('vehicle manager interaction rules define filters and responsive breakpoints', () => {
    const rules = getVehicleManagerInteractionRules();

    assert.equal(rules.version, '66.1');
    assert.deepEqual(rules.categories.map((entry) => entry.id), ['all', 'jaeger', 'kreuzer', 'spezial', 'custom']);
    assert.ok(rules.filterChips.category.includes('jaeger'));
    assert.ok(rules.filterChips.hitboxKlasse.includes('kompakt'));
    assert.deepEqual(getVehicleManagerInteractionRules('arcade').filterChips.rolle, ['fighter', 'allrounder', 'tank']);
    assert.equal(getVehicleManagerInteractionRules('arcade').filterChips.hitboxKlasse, undefined);
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
