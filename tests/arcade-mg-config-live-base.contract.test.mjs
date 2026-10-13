// Die Arcade-MG-Einstellung eines Piloten wird je Spieler zwischengespeichert. Ein Wert, der im
// gemeinsamen HUNT.MG-Grundobjekt nachträglich geändert wird (Live-Tuning, Testschalter wie
// HUMAN_AIM_ASSIST_ENABLED), muss beim nächsten Schuss ankommen - auch wenn das Objekt dasselbe bleibt.
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePlayerMachineGunConfig } from '../src/hunt/mg/MGConfigResolver.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { CONFIG_BASE } from '../src/core/Config.js';

function arcadePilot() {
    return { index: 0, isBot: false, arcadeWeaponLoadout: { machineGunId: 'standard', mgLevel: 1, mgDamagePct: 100 }, position: { x: 0, y: 0, z: 0 } };
}

test('an in-place change of the shared MG base reaches the cached arcade config', () => {
    const base = createEntityRuntimeConfig(null, CONFIG_BASE).HUNT.MG;
    const pilot = arcadePilot();
    assert.notEqual(resolvePlayerMachineGunConfig(base, pilot).HUMAN_AIM_ASSIST_ENABLED, false);
    base.HUMAN_AIM_ASSIST_ENABLED = false;
    assert.equal(resolvePlayerMachineGunConfig(base, pilot).HUMAN_AIM_ASSIST_ENABLED, false, 'the assist switch is honoured');
    const damage = resolvePlayerMachineGunConfig(base, pilot).DAMAGE;
    base.DAMAGE = Number(base.DAMAGE) * 2;
    assert.ok(resolvePlayerMachineGunConfig(base, pilot).DAMAGE > damage, 'a live-tuned damage value is honoured');
});

test('an unchanged base keeps returning the same cached config object', () => {
    const base = createEntityRuntimeConfig(null, CONFIG_BASE).HUNT.MG;
    const pilot = arcadePilot();
    const first = resolvePlayerMachineGunConfig(base, pilot);
    assert.equal(resolvePlayerMachineGunConfig(base, pilot), first, 'no rebuild per shot');
});
