import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CONTENT_DESCRIPTOR_TYPES,
    CONTENT_DESCRIPTOR_VERSION,
} from '../src/shared/contracts/ContentDescriptorContract.js';
import {
    getRuntimeMapPresetRegistryDescriptor,
    listRuntimeMapPresetKeys,
    resolveRuntimeMapPresetLabel,
} from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { MAP_PRESETS } from '../src/core/config/MapPresets.js';
import {
    findEditorBuildEntryById,
    getEditorBuildCategories,
    getEditorBuildCatalogDescriptor,
    getEditorBuildEntriesForCategory,
    getEditorTemplateRegistryDescriptor,
    resolveEditorTemplateImportCapability,
} from '../editor/js/ui/EditorBuildCatalog.js';
import {
    getArcadeMissionRegistryDescriptor,
    listArcadeMissionDescriptors,
    MISSION_TYPES,
} from '../src/shared/contracts/ArcadeMissionContract.js';
import {
    createMissionInstance,
} from '../src/state/arcade/ArcadeMissionState.js';
import {
    getArcadeModifierRegistryDescriptor,
} from '../src/shared/contracts/ArcadeModifierContract.js';
import {
    getArcadeRewardRegistryDescriptor,
} from '../src/shared/contracts/ArcadeRewardContract.js';
import {
    getVehicleRegistryDescriptor,
} from '../src/entities/vehicle-registry.js';
import {
    ARCADE_SECTOR_CATALOG,
} from '../src/entities/directors/ArcadeEncounterCatalog.js';
import {
    resolveFallbackMapKey,
    resolveKnownMapSelection,
} from '../src/entities/mapSchema/CustomMapSelectionResolver.js';

function assertRegistryEnvelope(registry, descriptorType) {
    assert.ok(registry && typeof registry === 'object');
    assert.equal(registry.descriptorVersion, CONTENT_DESCRIPTOR_VERSION);
    assert.equal(registry.descriptorType, descriptorType);
    assert.ok(Array.isArray(registry.entries));
    assert.equal(registry.entryCount, registry.entries.length);
}

test('V85.3 content descriptors expose shared registry envelopes', () => {
    const mapRegistry = getRuntimeMapPresetRegistryDescriptor(MAP_PRESETS);
    assertRegistryEnvelope(mapRegistry, CONTENT_DESCRIPTOR_TYPES.RUNTIME_MAP_PRESETS);
    assert.ok(mapRegistry.entries.some((entry) => entry.id === 'standard'));

    const editorBuildRegistry = getEditorBuildCatalogDescriptor();
    assertRegistryEnvelope(editorBuildRegistry, CONTENT_DESCRIPTOR_TYPES.EDITOR_BUILD_CATALOG);
    assert.ok(editorBuildRegistry.entries.some((entry) => entry.id === 'build-hard'));

    const editorTemplateRegistry = getEditorTemplateRegistryDescriptor();
    assertRegistryEnvelope(editorTemplateRegistry, CONTENT_DESCRIPTOR_TYPES.EDITOR_TEMPLATES);
    assert.equal(editorTemplateRegistry.status, 'missing');
    assert.equal(editorTemplateRegistry.entryCount, 0);
    const templateCapability = resolveEditorTemplateImportCapability(editorTemplateRegistry);
    assert.equal(templateCapability.available, false);
    assert.equal(templateCapability.degradedReason, 'templates_path_not_present');
    assert.equal(templateCapability.descriptorVersion, CONTENT_DESCRIPTOR_VERSION);
    assert.match(templateCapability.message || '', /editor\/templates/i);

    const missionRegistry = getArcadeMissionRegistryDescriptor();
    assertRegistryEnvelope(missionRegistry, CONTENT_DESCRIPTOR_TYPES.ARCADE_MISSIONS);
    assert.ok(missionRegistry.entries.some((entry) => entry.id === 'KILL_COUNT'));

    const modifierRegistry = getArcadeModifierRegistryDescriptor();
    assertRegistryEnvelope(modifierRegistry, CONTENT_DESCRIPTOR_TYPES.ARCADE_MODIFIERS);
    assert.ok(modifierRegistry.entries.some((entry) => entry.id === 'tight_turns'));

    const rewardRegistry = getArcadeRewardRegistryDescriptor();
    assertRegistryEnvelope(rewardRegistry, CONTENT_DESCRIPTOR_TYPES.ARCADE_REWARDS);
    assert.ok(rewardRegistry.entries.some((entry) => entry.id === 'run_speed_t1'));

    const vehicleRegistry = getVehicleRegistryDescriptor();
    assertRegistryEnvelope(vehicleRegistry, CONTENT_DESCRIPTOR_TYPES.VEHICLES);
    assert.ok(vehicleRegistry.entries.some((entry) => entry.id === 'ship5'));
});

test('V115.4.4 arcade mission descriptors are a runtime-consumed API surface', () => {
    const descriptorIds = listArcadeMissionDescriptors().map((entry) => entry.id);

    assert.ok(descriptorIds.includes('KILL_COUNT'));
    assert.equal(createMissionInstance('KILL_COUNT', { target: 2 })?.type, 'KILL_COUNT');
    assert.equal(createMissionInstance('UNKNOWN_MISSION_TYPE'), null);
});

test('V115.4.5 content descriptor registries expose frozen envelopes and entries', () => {
    const missionRegistry = getArcadeMissionRegistryDescriptor();
    const firstMissionEntry = missionRegistry.entries[0];

    assert.equal(Object.isFrozen(CONTENT_DESCRIPTOR_TYPES), true);
    assert.equal(Object.isFrozen(MISSION_TYPES), true);
    assert.equal(Object.isFrozen(MISSION_TYPES.KILL_COUNT), true);
    assert.equal(Object.isFrozen(MISSION_TYPES.KILL_COUNT.defaultParams), true);
    assert.equal(Object.isFrozen(missionRegistry), true);
    assert.equal(Object.isFrozen(missionRegistry.entries), true);
    assert.equal(Object.isFrozen(firstMissionEntry), true);
    assert.throws(() => {
        missionRegistry.entries.push({ id: 'mutated' });
    }, TypeError);
});

test('V85.3 arcade sector pools resolve against descriptor-backed registries', () => {
    const mapIds = new Set(
        getRuntimeMapPresetRegistryDescriptor(MAP_PRESETS).entries.map((entry) => entry.id)
    );
    const modifierIds = new Set(
        getArcadeModifierRegistryDescriptor().entries.map((entry) => entry.id)
    );
    const rewardIds = new Set(
        getArcadeRewardRegistryDescriptor().entries.map((entry) => entry.id)
    );

    ARCADE_SECTOR_CATALOG.forEach((template) => {
        (template.mapPool || []).forEach((mapId) => {
            assert.ok(mapIds.has(mapId), `Unknown map descriptor in sector pool: ${mapId}`);
        });
        (template.modifierPool || []).forEach((modifierId) => {
            assert.ok(modifierIds.has(modifierId), `Unknown modifier descriptor in sector pool: ${modifierId}`);
        });
        (template.rewardPool || []).forEach((rewardId) => {
            assert.ok(rewardIds.has(rewardId), `Unknown reward descriptor in sector pool: ${rewardId}`);
        });
    });
});

test('V85.3.2 runtime/editor consumers resolve through descriptor-backed contracts', () => {
    const runtimeMapKeys = listRuntimeMapPresetKeys(MAP_PRESETS);
    assert.ok(runtimeMapKeys.includes('standard'));
    assert.equal(resolveRuntimeMapPresetLabel('standard', MAP_PRESETS), MAP_PRESETS.standard.name);

    const buildCategories = getEditorBuildCategories();
    assert.ok(buildCategories.some((entry) => entry.id === 'build' && typeof entry.accentColor === 'string'));

    const flowEntries = getEditorBuildEntriesForCategory('flow');
    assert.ok(flowEntries.some((entry) => entry.id === 'flow-portal-ring'));
    const directLookup = findEditorBuildEntryById('flow-portal-ring');
    assert.equal(directLookup?.tool, 'portal');
    assert.equal(directLookup?.previewGlyph, 'PR');
});

test('V85.3.2 custom-map selection prioritizes descriptor-backed map keys', () => {
    const maps = {
        beta: { name: 'Beta' },
        standard: { name: 'Standard' },
        alpha: { name: 'Alpha' },
    };
    const descriptorEntries = [
        { id: 'alpha' },
        { id: 'standard' },
    ];

    const fallbackMapKey = resolveFallbackMapKey(maps, descriptorEntries);
    assert.equal(fallbackMapKey, 'standard');

    const knownFromDescriptor = resolveKnownMapSelection({
        requestedMapKey: 'alpha',
        maps,
        fallbackMapKey,
        mapDescriptors: descriptorEntries,
    });
    assert.equal(knownFromDescriptor.isFallback, false);
    assert.equal(knownFromDescriptor.effectiveMapKey, 'alpha');

    const filteredOutByDescriptor = resolveKnownMapSelection({
        requestedMapKey: 'beta',
        maps,
        fallbackMapKey,
        mapDescriptors: descriptorEntries,
    });
    assert.equal(filteredOutByDescriptor.isFallback, true);
    assert.equal(filteredOutByDescriptor.effectiveMapKey, 'standard');
});
