import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { createClipboardPayloadFromObject } from '../editor/js/ui/EditorSelectionOps.js';
import { getDefaultEditorLayerId } from '../editor/js/EditorAuthoringDocument.js';
import { createMapDocument, toArenaMapDefinition, parseMapJSON } from '../src/entities/MapSchema.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { findEditorBuildEntryById, resolveEditorBuildEntryAssetId } from '../editor/js/ui/EditorBuildCatalog.js';
import { normalizeStaticTurretDefinition } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { getEditorTurretAuthoringScale, showEditorTurretProperties, clearEditorTurretRange, bindEditorTurretProperties } from '../editor/js/ui/EditorTurretProperties.js';

function manager() {
    return new EditorMapManager({ objectsContainer: new THREE.Group(), transformControl: { object: null, detach() {} } },
        { getClone: () => null, setCloneHydrationHandler() {} });
}
const arenaSize = { width: 2800, height: 950, depth: 2400 };

test('editor rocket entries use procedural meshes and the correct layer and pickup type', () => {
    const maps = manager();
    try {
        const catalog = findEditorBuildEntryById('gameplay-rocket-turret');
        assert.equal(catalog.tool, 'turret');
        assert.equal(resolveEditorBuildEntryAssetId(catalog), null);
        assert.equal(getDefaultEditorLayerId(catalog.tool), 'gameplay');
        const turret = maps.createMesh(catalog.tool, catalog.subType, 0, 20, 0, 0);
        assert.equal(turret.userData.maxHp, 90);
        assert.equal(turret.userData.destructible, true);
        const pickup = findEditorBuildEntryById('pickups-rocket-turret');
        assert.equal(resolveEditorBuildEntryAssetId(pickup), null);
        const item = maps.createMesh(pickup.tool, pickup.subType, 20, 20, 0, 0);
        assert.equal(item.userData.pickupType, 'ROCKET_TURRET');
        assert.ok(item.children.length >= 3);
    } finally { maps.clearAllObjects(); }
});

test('editor turret properties, IDs and legacy behavior survive export, import and duplication', () => {
    const maps = manager();
    try {
        const turret = maps.createMesh('turret', 'rocket', 50, 80, -30, 0, {
            id: 'launcher', rocketType: 'ROCKET_HEAVY', maxHp: 140, range: 1400, cooldown: 4.5, phase: 1.2,
        });
        const clipboard = createClipboardPayloadFromObject({}, turret);
        const duplicate = maps.createMesh('turret', 'rocket', 90, 80, -30, 0, clipboard);
        assert.notEqual(duplicate.userData.id, turret.userData.id);
        const json = maps.generateJSONExport(arenaSize);
        const document = JSON.parse(json);
        assert.equal(document.staticTurrets.length, 2);
        assert.deepEqual(document.staticTurrets[0].pos, [50, 80, -30]);
        assert.equal(document.staticTurrets[0].range, 1400);
        maps.importFromJSON(json);
        assert.equal(maps.getObjectById('launcher').userData.rocketType, 'ROCKET_HEAVY');
        assert.deepEqual(JSON.parse(maps.generateJSONExport(arenaSize)).staticTurrets, document.staticTurrets);
        const legacy = createMapDocument({ arenaSize, staticTurrets: [{ id: 'old', weapon: 'mg', pos: [10, 20, 30] }] });
        assert.equal(legacy.staticTurrets[0].destructible, false);
        assert.equal(legacy.staticTurrets[0].targetPlayers, 'humans');
        assert.equal(legacy.staticTurrets[0].targetTrails, false);
        assert.deepEqual(legacy.staticTurrets[0].allowedModes, ['HUNT']);
        maps.importFromJSON(JSON.stringify(legacy));
        assert.equal(maps.getObjectById('old').userData.destructible, false);
        const legacyRuntime = parseMapJSON(JSON.stringify({ size: [100, 50, 100], obstacles: [], staticTurrets: legacy.staticTurrets }));
        assert.equal(legacyRuntime.map.staticTurrets[0].id, 'old');
    } finally { maps.clearAllObjects(); }
});

test('editor range input corresponds to 90 gameplay units after conversion and runtime scaling', () => {
    const maps = manager();
    const editor = { mapManager: maps, getArenaSizeForExport: () => arenaSize, core: { scene: new THREE.Scene() },
        dom: { propTurretFields: {}, propTurretRange: {} }, isObjectLocked: () => false };
    const scale = getEditorTurretAuthoringScale(editor);
    const system = new StaticTurretSystem({ gameModeStrategy: { modeType: 'HUNT' }, entityRuntimeConfig: { ARENA: { MAP_SCALE: 3 } }, arena: {} });
    try {
        const mesh = maps.createMesh('turret', 'rocket', 350, 140, -700, 0, { turretAuthoringScale: scale });
        showEditorTurretProperties(editor, mesh);
        assert.equal(editor.dom.propTurretRange.value, '90');
        assert.equal(editor.turretRangePreview.scale.x, 90 * scale);
        const document = JSON.parse(maps.generateJSONExport(arenaSize));
        system.entityManager.arena.currentMapDefinition = toArenaMapDefinition(document, { mapScale: 35 }).map;
        system.startRound();
        const turret = system.turrets[0];
        assert.deepEqual(turret.position.toArray(), [30, 12, -60]);
        assert.ok(Math.abs(turret.range - 90) < 1e-10);
        assert.equal(turret.maxHp, 90);
        assert.equal(turret.cooldown, 3.4);
        clearEditorTurretRange(editor);
        assert.equal(editor.core.scene.children.length, 0);
    } finally { clearEditorTurretRange(editor); system.dispose(); maps.clearAllObjects(); }
});

test('turret schema enforces limits and unique IDs, while preserving optional compatibility defaults', () => {
    assert.throws(() => createMapDocument({ staticTurrets: Array.from({ length: 513 }, (_, index) => ({ id: `t${index}` })) }), /limit.*512/);
    assert.throws(() => createMapDocument({ staticTurrets: [{ id: 'same' }, { id: 'same' }] }), /Duplicate/);
    const value = normalizeStaticTurretDefinition({ pos: [Infinity, NaN, 3], cooldown: -2, maxHp: Infinity, rocketType: 'INVALID' });
    assert.deepEqual(value.pos, [0, 0, 3]);
    assert.equal(value.cooldown, 0.2);
    assert.equal(value.maxHp, 90);
    assert.equal(value.rocketType, 'ROCKET_WEAK');
    assert.deepEqual(createMapDocument({ schemaVersion: 4 }).staticTurrets, []);
});

test('a deferred panel refresh keeps a typed but uncommitted turret value', () => {
    const maps = manager();
    const input = () => Object.assign(new EventTarget(), { value: '', disabled: false });
    const dom = { propTurretFields: {}, propTurretRange: input(), propTurretCooldown: input(), propTurretRocketType: input(), propTurretHp: input() };
    const editor = { mapManager: maps, getArenaSizeForExport: () => arenaSize, core: { scene: new THREE.Scene() }, dom,
        isObjectLocked: () => false, isManagedObjectAlive: () => true, executeHistoryMutation: (_label, fn) => fn(),
        showPropPanel: (object) => showEditorTurretProperties(editor, object) };
    try {
        const first = maps.createMesh('turret', 'rocket', 0, 20, 0, 0, { id: 'first' });
        const second = maps.createMesh('turret', 'rocket', 90, 20, 0, 0, { id: 'second', maxHp: 60 });
        bindEditorTurretProperties(editor);
        editor.selectedObject = first;
        showEditorTurretProperties(editor, first);
        dom.propTurretHp.value = '130';
        dom.propTurretHp.dispatchEvent(new Event('input'));
        showEditorTurretProperties(editor, first);
        assert.equal(dom.propTurretHp.value, '130');
        dom.propTurretHp.dispatchEvent(new Event('change'));
        assert.equal(first.userData.maxHp, 130);
        dom.propTurretHp.value = '999';
        dom.propTurretHp.dispatchEvent(new Event('input'));
        dom.propTurretHp.dispatchEvent(new Event('change'));
        assert.equal(dom.propTurretHp.value, '500');
        dom.propTurretHp.value = '77';
        dom.propTurretHp.dispatchEvent(new Event('input'));
        editor.selectedObject = second;
        showEditorTurretProperties(editor, second);
        assert.equal(dom.propTurretHp.value, '60');
    } finally { clearEditorTurretRange(editor); maps.clearAllObjects(); }
});
