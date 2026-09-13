import assert from 'node:assert/strict';
import test from 'node:test';

import {
    HANGAR_CAPABILITY_IDS,
    HANGAR_MODES,
    HANGAR_NAV_EVENTS,
    assertHangarCapabilityId,
} from '../src/shared/contracts/HangarModeContract.js';
import {
    HANGAR_DESKTOP_ENTRY_IDS,
    resolveDesktopHangarEntryByMode,
} from '../src/ui/hangar/HangarDesktopEntryContract.js';
import { resolveHangarLifecycleContract } from '../src/ui/hangar/HangarLifecycleContract.js';
import {
    assertHangarShellRegionId,
    resolveHangarShellLayout,
} from '../src/ui/hangar/HangarShellLayoutContract.js';
import {
    HANGAR_SELECTION_WRITEBACK_PATHS,
    readHangarMapSelection,
    readHangarVehicleSelection,
    resolveHangarSelectionMode,
    writeHangarMapSelection,
    writeHangarVehicleSelection,
} from '../src/ui/hangar/HangarSelectionWritebackContract.js';
import { createHangarWorkshopPersistenceFacade } from '../src/ui/hangar/HangarWorkshopPersistenceFacade.js';

test('V76.99.2 desktop hangar entry resolves stable fight/arcade open paths', () => {
    const fightEntry = resolveDesktopHangarEntryByMode(HANGAR_MODES.FIGHT);
    const arcadeEntry = resolveDesktopHangarEntryByMode(HANGAR_MODES.ARCADE);

    assert.equal(fightEntry.entryId, HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_FIGHT_HANGAR);
    assert.equal(fightEntry.navEvent, HANGAR_NAV_EVENTS.OPEN_FIGHT_HANGAR);
    assert.equal(fightEntry.capabilityId, HANGAR_CAPABILITY_IDS.OPEN_HANGAR);

    assert.equal(arcadeEntry.entryId, HANGAR_DESKTOP_ENTRY_IDS.MAIN_MENU_ARCADE_HANGAR);
    assert.equal(arcadeEntry.navEvent, HANGAR_NAV_EVENTS.OPEN_ARCADE_HANGAR);
    assert.equal(arcadeEntry.capabilityId, HANGAR_CAPABILITY_IDS.OPEN_HANGAR);
});

test('V76.99.2 map/vehicle writeback persists mode-aware selections through one contract', () => {
    const settings = {
        mapKey: 'standard',
        vehicles: {
            PLAYER_1: 'ship5',
            PLAYER_2: 'ship5',
        },
        localSettings: {
            modePath: HANGAR_MODES.FIGHT,
            startSetup: {
                modeSelections: {},
            },
        },
    };

    const arcadeMapWrite = writeHangarMapSelection(settings, 'arcade-map', 'standard', { mode: HANGAR_MODES.ARCADE });
    const arcadeVehicleWrite = writeHangarVehicleSelection(
        settings,
        'PLAYER_1',
        'ship7',
        'ship5',
        { mode: HANGAR_MODES.ARCADE }
    );
    const fightMapWrite = writeHangarMapSelection(settings, 'fight-map', 'standard', { mode: HANGAR_MODES.FIGHT });
    const fightVehicleWrite = writeHangarVehicleSelection(
        settings,
        'PLAYER_2',
        'ship9',
        'ship5',
        { mode: HANGAR_MODES.FIGHT }
    );

    assert.equal(arcadeMapWrite.persistencePath, HANGAR_SELECTION_WRITEBACK_PATHS.MODE_ARCADE_MAP_KEY);
    assert.equal(arcadeVehicleWrite.persistencePath, HANGAR_SELECTION_WRITEBACK_PATHS.MODE_ARCADE_VEHICLE_PLAYER_1);
    assert.equal(fightMapWrite.persistencePath, HANGAR_SELECTION_WRITEBACK_PATHS.MODE_FIGHT_MAP_KEY);
    assert.equal(fightVehicleWrite.persistencePath, HANGAR_SELECTION_WRITEBACK_PATHS.MODE_FIGHT_VEHICLE_PLAYER_2);

    const arcadeMap = readHangarMapSelection(settings, 'standard', { mode: HANGAR_MODES.ARCADE });
    const fightMap = readHangarMapSelection(settings, 'standard', { mode: HANGAR_MODES.FIGHT });
    const arcadeVehicle = readHangarVehicleSelection(settings, 'PLAYER_1', 'ship5', { mode: HANGAR_MODES.ARCADE });
    const fightVehicle = readHangarVehicleSelection(settings, 'PLAYER_2', 'ship5', { mode: HANGAR_MODES.FIGHT });

    assert.equal(arcadeMap.value, 'arcade-map');
    assert.equal(fightMap.value, 'fight-map');
    assert.equal(arcadeVehicle.value, 'ship7');
    assert.equal(fightVehicle.value, 'ship9');
    assert.equal(settings.mapKey, 'fight-map');
    assert.equal(settings.vehicles.PLAYER_1, 'ship5');
    assert.equal(settings.vehicles.PLAYER_2, 'ship9');
});

test('V76.99.2 unknown mode-path falls back consistently to fight mode', () => {
    const settings = {
        mapKey: 'standard',
        vehicles: {
            PLAYER_1: 'ship5',
            PLAYER_2: 'ship5',
        },
        localSettings: {
            modePath: 'normal',
            startSetup: {},
        },
    };

    assert.equal(resolveHangarSelectionMode('normal'), HANGAR_MODES.FIGHT);
    assert.equal(resolveHangarSelectionMode('unknown-mode'), HANGAR_MODES.FIGHT);

    const writeback = writeHangarMapSelection(settings, 'fight-map', 'standard', { modePath: 'normal' });
    assert.equal(writeback.mode, HANGAR_MODES.FIGHT);
    assert.equal(writeback.persistencePath, HANGAR_SELECTION_WRITEBACK_PATHS.MODE_FIGHT_MAP_KEY);
    assert.equal(settings.localSettings.startSetup.modeSelections?.fight?.mapKey, 'fight-map');
});

test('V76.99.2 mode reads stay isolated from global map/vehicle fallbacks', () => {
    const settings = {
        mapKey: 'global-map',
        vehicles: {
            PLAYER_1: 'global-p1',
            PLAYER_2: 'global-p2',
        },
        localSettings: {
            modePath: HANGAR_MODES.FIGHT,
            startSetup: {
                modeSelections: {
                    fight: {
                        mapKey: 'fight-map',
                        vehicles: {
                            PLAYER_1: 'fight-p1',
                            PLAYER_2: 'fight-p2',
                        },
                    },
                },
            },
        },
    };

    const fightMap = readHangarMapSelection(settings, 'standard', { mode: HANGAR_MODES.FIGHT });
    const fightP1 = readHangarVehicleSelection(settings, 'PLAYER_1', 'ship5', { mode: HANGAR_MODES.FIGHT });
    const arcadeMap = readHangarMapSelection(settings, 'standard', { mode: HANGAR_MODES.ARCADE });
    const arcadeP1 = readHangarVehicleSelection(settings, 'PLAYER_1', 'ship5', { mode: HANGAR_MODES.ARCADE });

    assert.equal(fightMap.value, 'fight-map');
    assert.equal(fightP1.value, 'fight-p1');
    assert.equal(arcadeMap.value, 'standard');
    assert.equal(arcadeP1.value, 'ship5');
});

test('V76.99.2 active mode initializes missing map selection from loaded settings', () => {
    const settings = {
        mapKey: 'maze',
        vehicles: {
            PLAYER_1: 'ship5',
            PLAYER_2: 'ship5',
        },
        localSettings: {
            modePath: HANGAR_MODES.FIGHT,
            startSetup: {
                modeSelections: {},
            },
        },
    };

    const fightMap = readHangarMapSelection(settings, 'standard', { mode: HANGAR_MODES.FIGHT });
    const arcadeMap = readHangarMapSelection(settings, 'standard', { mode: HANGAR_MODES.ARCADE });

    assert.equal(fightMap.value, 'maze');
    assert.equal(settings.localSettings.startSetup.modeSelections.fight.mapKey, 'maze');
    assert.equal(arcadeMap.value, 'standard');
});

test('V76.99.2 lifecycle keeps single contract return path to menu and match start for both modes', () => {
    for (const mode of [HANGAR_MODES.ARCADE, HANGAR_MODES.FIGHT]) {
        const lifecycle = resolveHangarLifecycleContract(mode);
        assert.equal(lifecycle.writeback.source, 'settings.vehicles');
        assert.equal(lifecycle.writeback.pathMap, HANGAR_SELECTION_WRITEBACK_PATHS);

        const startMatchTransitions = lifecycle.transitions.filter((entry) => entry.transitionId === 'start_match_from_hangar');
        const returnToMenuTransitions = lifecycle.transitions.filter((entry) => entry.transitionId === 'return_to_menu');

        assert.equal(startMatchTransitions.length, 1);
        assert.equal(returnToMenuTransitions.length, 1);
        assert.equal(startMatchTransitions[0].navEvent, HANGAR_NAV_EVENTS.START_MATCH);
        assert.equal(startMatchTransitions[0].capabilityId, HANGAR_CAPABILITY_IDS.MATCH_START_FROM_HANGAR);
        assert.equal(returnToMenuTransitions[0].navEvent, HANGAR_NAV_EVENTS.RETURN_TO_MENU);
        assert.equal(returnToMenuTransitions[0].capabilityId, HANGAR_CAPABILITY_IDS.RETURN_TO_MENU);

        for (const transition of lifecycle.transitions) {
            assert.notEqual(assertHangarCapabilityId(transition.capabilityId), null);
        }
    }
});

test('V76.99.2 workshop persistence facade saves via named desktop capabilities', async () => {
    const calls = [];
    const facade = createHangarWorkshopPersistenceFacade({
        invokeCapability: async (capabilityId, payload) => {
            calls.push({ capabilityId, payload });
            return { persisted: true, payload };
        },
    });

    const loadResult = await facade.loadCustomVehicle({ id: 'arcade-fighter' });
    const saveResult = await facade.saveCustomVehicle({ id: 'arcade-fighter', label: 'Arcade Fighter' });
    const renameResult = await facade.renameCustomVehicle({ id: 'arcade-fighter', nextLabel: 'Arcade Fighter Mk2' });
    const deleteResult = await facade.deleteCustomVehicle({ id: 'arcade-fighter' });

    assert.equal(loadResult.ok, true);
    assert.equal(saveResult.ok, true);
    assert.equal(renameResult.ok, true);
    assert.equal(deleteResult.ok, true);

    assert.deepEqual(
        calls.map((entry) => entry.capabilityId),
        [
            HANGAR_CAPABILITY_IDS.LOAD_CUSTOM_BLUEPRINT,
            HANGAR_CAPABILITY_IDS.SAVE_CUSTOM_BLUEPRINT,
            HANGAR_CAPABILITY_IDS.RENAME_CUSTOM_BLUEPRINT,
            HANGAR_CAPABILITY_IDS.DELETE_CUSTOM_BLUEPRINT,
        ]
    );
});

test('V76.99.2 workshop persistence facade propagates backend-level rejection', async () => {
    const facade = createHangarWorkshopPersistenceFacade({
        invokeCapability: async () => ({ ok: false, code: 'backend_rejected', message: 'refused by backend' }),
    });

    const result = await facade.saveCustomVehicle({ id: 'arcade-fighter' });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'backend_rejected');
    assert.equal(result.message, 'refused by backend');
});

test('the shell layout keeps every region anchor resolvable', () => {
    for (const mode of [HANGAR_MODES.ARCADE, HANGAR_MODES.FIGHT]) {
        const layout = resolveHangarShellLayout(mode);
        const regionIds = new Set(layout.commonRegions.map((region) => region.id));

        assert.ok(regionIds.size > 0);
        for (const region of layout.commonRegions) {
            assert.notEqual(assertHangarShellRegionId(region.id), null);
        }
        for (const extension of layout.modeExtensions) {
            assert.ok(
                regionIds.has(extension.anchorRegionId),
                `${extension.id} anchors at ${extension.anchorRegionId}, which the layout does not contain`
            );
        }
    }
});
