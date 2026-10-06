// A held machine gun retries every tick. The gap between two shots is ordinary sustained fire,
// and a lockout is news once - not sixty times a second. The desktop playtest of 06.10.2026
// counted about 48 "Schuss bereit in 0.0s" toasts per second while the key was held.
import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerActionPhase } from '../src/entities/systems/lifecycle/PlayerActionPhase.js';
import { GAMEPLAY_ACTION_RESULT_CODES } from '../src/shared/contracts/GameplayActionResultContract.js';

const OK = { ok: true, code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_SUCCESS, type: 'MG_BULLET' };
const COOLDOWN = { ok: false, code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_COOLDOWN, reason: 'Schuss bereit in 0.0s', type: 'MG_BULLET' };
const OVERHEATED = { ok: false, code: GAMEPLAY_ACTION_RESULT_CODES.MG_SHOOT_OVERHEATED, reason: 'MG überhitzt (0.6s)', type: 'MG_BULLET' };

function createScene(results) {
    const feedback = [];
    let tick = 0;
    const entityManager = {
        _shootHuntGun: () => results[Math.min(tick++, results.length - 1)],
        _shootItemProjectile: () => ({ ok: false, code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_COOLDOWN, reason: 'Schuss bereit in 0.4s' }),
        _notifyPlayerFeedback: (_player, message) => feedback.push(message),
    };
    const player = { index: 0, isBot: false, cycleItem() {}, dropItem() {} };
    const phase = new PlayerActionPhase(entityManager);
    const strategy = { hasMachineGun: () => true, requiresShootItemIndex: () => false };
    const hold = (shootMG = true) => phase.run(player, { shootMG }, strategy, 1 / 60);
    return { feedback, hold, phase, player, strategy };
}

test('Gehaltenes MG meldet die Pause zwischen zwei Schuessen nicht', () => {
    const { feedback, hold } = createScene([OK, COOLDOWN, COOLDOWN, OK, COOLDOWN, COOLDOWN, OK, COOLDOWN]);
    for (let i = 0; i < 8; i += 1) hold();
    assert.deepEqual(feedback, []);
});

test('Eine Ueberhitzung wird einmal gemeldet, nicht in jedem Takt', () => {
    const results = [OK, COOLDOWN, ...Array.from({ length: 30 }, () => OVERHEATED)];
    const { feedback, hold } = createScene(results);
    for (let i = 0; i < results.length; i += 1) hold();
    assert.deepEqual(feedback, ['MG überhitzt (0.6s)']);
});

test('Neues Druecken waehrend der Sperre und eine neue Sperre melden sich wieder', () => {
    const results = [OVERHEATED, OVERHEATED, OVERHEATED, OVERHEATED, OK, COOLDOWN, OVERHEATED, OVERHEATED];
    const { feedback, hold } = createScene(results);
    hold(); hold();          // gesperrt, einmal gemeldet
    hold(false);             // losgelassen
    hold(); hold();          // neu gedrueckt, noch gesperrt: wieder eine Meldung
    hold(); hold();          // Sperre vorbei, normales Feuer
    hold(); hold();          // neue Sperre: wieder eine Meldung
    assert.equal(feedback.length, 3, feedback.join(' | '));
});

test('Ein einzelner Raketenschuss in der Abklingzeit meldet sich weiter', () => {
    const { feedback, phase, player, strategy } = createScene([OK]);
    phase.run(player, { shootRocket: true }, strategy, 1 / 60);
    assert.deepEqual(feedback, ['Schuss bereit in 0.4s']);
});
