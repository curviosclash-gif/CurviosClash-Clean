import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeLabStarterConfig, measureArcadeLabHullVolume, validateArcadeLabShip,
    ARCADE_LAB_REFERENCE_VOLUMES, ARCADE_LAB_MAX_SWEEP_RADIUS, createArcadeLabFactoryCopy } from '../src/shared/contracts/ArcadeLabContract.js';
import { createArcadeLabShip, saveArcadeLabShips, registerArcadeLabShipsFromStore,
    deleteArcadeLabShip, renameArcadeLabShip, saveArcadeLabDraft, commitArcadeLabDraft, loadArcadeLabShips } from '../src/shared/contracts/ArcadeLabStoreContract.js';
import { clearArcadeLabShipState } from '../src/ui/lab/ArcadeLabRules.js';
import { getArcadeVehicleProfileRecord, ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import { clearArcadeLabShipRegistry, getRegisteredArcadeLabShip } from '../src/shared/contracts/ArcadeLabRegistryContract.js';
import { evaluateArcadeLabUnlock, syncArcadeLabUnlock } from '../src/shared/contracts/ArcadeLabUnlockContract.js';
import { getVehicleDefinition, getVehicleIds, getPlayerVehicleIds, isPlayerSelectableVehicleId,
    isValidVehicleId, getVehicleModularConfig } from '../src/entities/vehicle-registry.js';
import { isArcadeSelectableVehicleId, resolveArcadeVehicleBaseStats } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { ARCADE_EXTERNAL_IMPULSE_MAX, ARCADE_HITBOX_MIN_THICKNESS, ARCADE_SWEEP_MAX_STEPS,
    buildArcadeHitboxShape, computeArcadeSweepSteps, resolveArcadeMotionWorstCase } from '../src/shared/contracts/ArcadeVehicleHitboxContract.js';
import { ARCADE_ROLL_BASE_PCT, resolveArcadeStatCapPct } from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { PICKUP_REGISTRY } from '../src/shared/contracts/PickupRegistryContract.js';
import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { getPlayerShipPartConfig } from '../src/shared/vehicle-lab/player-ships/index.js';

function store() {
    const values = new Map();
    return { loadJsonRecord: (key, fallback = null) => values.has(key) ? structuredClone(values.get(key)) : fallback,
        saveJsonRecord: (key, value) => { values.set(key, structuredClone(value)); return { success: true }; }, values };
}

test('unlock needs six simultaneously complete factory profiles and remains permanent', () => {
    const ids = ['ship5', 'spaceship', 'arrow', 'manta', 'drone', 'ship1', 'ship9', 'lab_helix_interceptor'];
    const grown = { sizeWorkshopUnlocked: true, purchasedSizeSteps: 25,
        partSizes: { hull: 125, nose: 125, wings: 125, engines: 125, utility: 125 } };
    const profiles = Object.fromEntries(ids.slice(0, 5).map((id) => [id, grown]));
    assert.equal(evaluateArcadeLabUnlock(profiles).met, false);
    profiles[ids[5]] = { ...grown, partSizes: { ...grown.partSizes, utility: 120 } };
    assert.equal(evaluateArcadeLabUnlock(profiles).met, false);
    profiles[ids[5]] = grown;
    const s = store();
    assert.equal(syncArcadeLabUnlock(s, profiles, 17).changed, true);
    profiles[ids[5]] = { ...grown, purchasedSizeSteps: 20 };
    assert.equal(syncArcadeLabUnlock(s, profiles, 99).record.unlockedAtMs, 17);
    assert.equal(evaluateArcadeLabUnlock({ ...profiles, arcade_lab_1: grown }).met, false);
});

test('hull volume unions overlaps and tiny remote detail cannot buy tank stats', () => {
    const box = { name: 'core', role: 'core', geo: 'box', size: [2, 1, 2], pos: [0, 0, 0], scale: [1, 1, 1] };
    const one = measureArcadeLabHullVolume([box]);
    assert.equal(measureArcadeLabHullVolume([box, { ...box, name: 'same' }]), one);
    const antenna = { name: 'antenna', geo: 'box', size: [0.01, 0.01, 0.01], pos: [10, 0, 0], scale: [1, 1, 1] };
    assert.ok(measureArcadeLabHullVolume([box, antenna]) < one + 0.001);
    assert.ok(ARCADE_LAB_REFERENCE_VOLUMES.arrow > 0 && ARCADE_LAB_REFERENCE_VOLUMES.ship5 > 0
        && ARCADE_LAB_REFERENCE_VOLUMES.spaceship > ARCADE_LAB_REFERENCE_VOLUMES.arrow);
});

test('three neutral frames are valid, obey the 256-step sweep envelope, and have distinct roles', () => {
    for (const role of ['fighter', 'allrounder', 'tank']) {
        const config = createArcadeLabStarterConfig(role);
        const result = validateArcadeLabShip({ id: 'arcade_lab_1', config });
        assert.equal(result.ok, true, `${role}: ${result.errors.join(' · ')}`);
        assert.equal(result.role, role);
        const sizes = { hull: 125, nose: 125, wings: 125, engines: 125, utility: 125 };
        assert.ok(buildArcadeHitboxShape(config.parts, sizes).boundRadius <= ARCADE_LAB_MAX_SWEEP_RADIUS);
    }
});

test('raw Lab dimensions outside bounds cannot validate or replace the saved ship config', () => {
    const s = store();
    const original = createArcadeLabStarterConfig('fighter');
    const created = createArcadeLabShip({ schemaVersion: 'arcade-lab.v1', unlocked: true, nextSerial: 1, ships: [] }, original);
    assert.equal(created.ok, true);
    assert.equal(saveArcadeLabShips(s, created.record), true);

    for (const [property, value] of [['size', -5], ['scale', -0.5], ['size', Number.NaN], ['scale', 21]]) {
        const draft = structuredClone(original);
        draft.parts[0][property][0] = value;
        const result = validateArcadeLabShip({ id: created.ship.id, config: draft });
        assert.equal(result.ok, false, `${property}=${value} must be rejected`);
        assert.equal(result.dimensionsValid, false);
        assert.ok(result.errors.some((error) => error.includes(property === 'size' ? 'Größe X' : 'Skalierung X')));

        const pending = saveArcadeLabDraft(created.record, created.ship.id, draft);
        assert.equal(saveArcadeLabShips(s, pending), true);
        const commit = commitArcadeLabDraft(pending, created.ship.id, 25);
        assert.equal(commit.ok, false);
        assert.deepEqual(loadArcadeLabShips(s).ships[0].config, created.ship.config);
    }
});

test('Lab size ceiling follows current capped motion including altitude at minimum plane scale', () => {
    const player = CONFIG_SECTIONS.PLAYER;
    const stats = ['ship5', 'spaceship', 'arrow', 'manta', 'drone', 'ship1', 'ship9', 'lab_helix_interceptor']
        .map((id) => resolveArcadeVehicleBaseStats(id));
    const worst = resolveArcadeMotionWorstCase({
        baseSpeed: Math.max(SETTINGS_LIMITS.gameplay.speed.max, player.SPEED),
        speedCapPct: Math.max(...stats.map((entry) => resolveArcadeStatCapPct(entry.speedPct))),
        boostMultiplier: player.BOOST_MULTIPLIER,
        speedEffectMultiplier: PICKUP_REGISTRY.SPEED_UP.multiplier,
        externalImpulse: ARCADE_EXTERNAL_IMPULSE_MAX,
        turnSpeed: Math.max(SETTINGS_LIMITS.gameplay.turnSensitivity.max, player.TURN_SPEED),
        turnCapPct: Math.max(...stats.map((entry) => resolveArcadeStatCapPct(entry.turnPct))),
        rollSpeed: player.ROLL_SPEED,
        rollCapPct: resolveArcadeStatCapPct(ARCADE_ROLL_BASE_PCT),
        frameDt: CONFIG_SECTIONS.TIME_STEP,
        minClockScale: Math.min(player.SLOWMO_TIME_SCALE, PICKUP_REGISTRY.SLOW_TIME.timeScale),
    });
    const scale = SETTINGS_LIMITS.gameplay.planeScale.min;
    const atCeiling = computeArcadeSweepSteps(worst.stepDistance, worst.stepAngle,
        ARCADE_LAB_MAX_SWEEP_RADIUS * scale, ARCADE_HITBOX_MIN_THICKNESS * scale);
    assert.equal(ARCADE_SWEEP_MAX_STEPS, 256);
    assert.ok(atCeiling <= ARCADE_SWEEP_MAX_STEPS, `${atCeiling} samples`);
    assert.ok(worst.stepDistance > 28 && worst.stepAngle > 0.9, 'dive and turn maxima included');
});

test('factory copies are allowed when they obey Lab rules; Manta fails the technical envelope', () => {
    for (const id of ['arrow', 'ship5', 'spaceship', 'drone', 'ship1', 'ship9']) {
        const result = validateArcadeLabShip({ id: 'arcade_lab_1', config: getPlayerShipPartConfig(id) });
        assert.equal(result.ok, true, `${id}: ${result.errors.join(' · ')}`);
    }
    assert.match(validateArcadeLabShip({ id: 'arcade_lab_1', config: getPlayerShipPartConfig('manta') }).errors.join(' '), /zu groß/);
});

test('stable ID, draft repair, registry and Arcade-only selection survive a role change', () => {
    const s = store();
    let record = { schemaVersion: 'arcade-lab.v1', unlocked: true, nextSerial: 1, ships: [] };
    const first = createArcadeLabShip(record, createArcadeLabStarterConfig('fighter'));
    assert.equal(first.ok, true);
    record = first.record;
    assert.equal(first.ship.id, 'arcade_lab_1');
    assert.equal(saveArcadeLabShips(s, record), true);
    registerArcadeLabShipsFromStore(s);
    assert.equal(isValidVehicleId('arcade_lab_1'), true);
    assert.equal(isArcadeSelectableVehicleId('arcade_lab_1'), true);
    assert.equal(isPlayerSelectableVehicleId('arcade_lab_1'), false);
    assert.equal(getVehicleIds().includes('arcade_lab_1'), false);
    assert.equal(getPlayerVehicleIds().includes('arcade_lab_1'), false);
    assert.equal(getVehicleDefinition('arcade_lab_1').hitbox.radius, 1.2);
    assert.equal(getVehicleModularConfig('arcade_lab_1').id, 'arcade_lab_1');
    assert.equal(resolveArcadeVehicleBaseStats('arcade_lab_1').maxHpPct, 75);
    record = saveArcadeLabDraft(record, 'arcade_lab_1', createArcadeLabStarterConfig('tank'));
    const changed = commitArcadeLabDraft(record, 'arcade_lab_1');
    assert.equal(changed.ok, true);
    record = renameArcadeLabShip(changed.record, 'arcade_lab_1', 'Neuer Name');
    assert.equal(record.ships[0].id, 'arcade_lab_1');
    saveArcadeLabShips(s, record);
    registerArcadeLabShipsFromStore(s);
    assert.equal(getRegisteredArcadeLabShip('arcade_lab_1').role, 'tank');
    assert.equal(resolveArcadeVehicleBaseStats('arcade_lab_1').maxHpPct, 125);
    record = deleteArcadeLabShip(record, 'arcade_lab_1');
    const second = createArcadeLabShip(record, createArcadeLabStarterConfig('fighter'));
    assert.equal(second.ship.id, 'arcade_lab_2');
    clearArcadeLabShipRegistry();
    assert.equal(isValidVehicleId('arcade_lab_1'), false);
});

test('rotation preserves primitive substance, spheres exclude empty corners and tiny frames cannot deploy', () => {
    const plate = { name: 'plate', geo: 'box', size: [3,0.05,2], pos: [0,0,0] };
    assert.ok(Math.abs(measureArcadeLabHullVolume([plate])-measureArcadeLabHullVolume([{...plate,rot:[45,35,25]}])) < 1e-9);
    const sphere = measureArcadeLabHullVolume([{name:'sphere',geo:'sphere',size:[1,1,1]}]);
    assert.ok(Math.abs(sphere-4*Math.PI/3) < 0.08);
    const tiny = createArcadeLabStarterConfig(); tiny.parts = tiny.parts.map(p => ({...p,size:p.size.map(v=>v*0.5),pos:p.pos.map(v=>v*0.5)}));
    assert.match(validateArcadeLabShip({id:'arcade_lab_1',config:tiny}).errors.join(' '),/kleinster|kleiner/);
    assert.equal(validateArcadeLabShip({id:'arcade_lab_1',config:createArcadeLabFactoryCopy('lab_helix_interceptor')}).ok,true);
});

test('unreadable or unknown Lab records never get replaced and a failed unlock is not granted', () => {
    let writes=0;
    const unavailable = {readJsonRecordResult:()=>({status:'unavailable'}),loadJsonRecord:()=>null,saveJsonRecord:()=>{writes++;return true;}};
    assert.equal(loadArcadeLabShips(unavailable),null);
    assert.equal(saveArcadeLabShips(unavailable,{schemaVersion:'arcade-lab.v1',ships:[]}),false);
    assert.equal(syncArcadeLabUnlock(unavailable,{}).record,null);
    assert.equal(writes,0);
    const s = store();
    s.values.set('curviosclash.arcade-lab.ships.v1',{schemaVersion:'future',ships:[]});
    assert.equal(loadArcadeLabShips(s),null);
    assert.equal(saveArcadeLabShips(s,{schemaVersion:'arcade-lab.v1',ships:[]}),false);
    const grown = {sizeWorkshopUnlocked:true,purchasedSizeSteps:25,partSizes:{hull:125,nose:125,wings:125,engines:125,utility:125}};
    const profiles=Object.fromEntries(['ship5','spaceship','arrow','manta','drone','ship1'].map(id=>[id,grown]));
    s.saveJsonRecord=()=>false;
    assert.equal(syncArcadeLabUnlock(s,profiles).record.unlocked,false);
});

test('deletion write failure restores progress, and role changes keep XP, purchases and weapon levels', () => {
    const s=store();
    const prior={vehicleId:'arcade_lab_1',level:30,xp:18000,xpBank:1200,machineGunLevel:9,rocketDamageLevel:5,shieldLevel:4};
    s.values.set(ARCADE_VEHICLE_PROFILE_STORAGE_KEY,{'arcade_lab_1':prior});
    assert.equal(clearArcadeLabShipState(s,'arcade_lab_1',()=>false),false);
    assert.deepEqual(s.values.get(ARCADE_VEHICLE_PROFILE_STORAGE_KEY),{'arcade_lab_1':prior});
    const record={schemaVersion:'arcade-lab.v1',unlocked:true,nextSerial:2,ships:[{id:'arcade_lab_1',label:'Tank',config:createArcadeLabStarterConfig('tank')}]};
    saveArcadeLabShips(s,record);registerArcadeLabShipsFromStore(s);
    const normalized=getArcadeVehicleProfileRecord({'arcade_lab_1':prior},'arcade_lab_1');
    assert.equal(normalized.xp,prior.xp);assert.equal(normalized.xpBank,prior.xpBank);
    assert.equal(normalized.machineGunLevel,9);assert.equal(normalized.rocketDamageLevel,5);assert.equal(normalized.shieldLevel,4);
    clearArcadeLabShipRegistry();
});
