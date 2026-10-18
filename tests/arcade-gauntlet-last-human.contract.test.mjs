import test from 'node:test';
import assert from 'node:assert/strict';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';

function fixture({ arcade = true, partner = false, pending = false, authority = true } = {}) {
    const human = { index: 0, isBot: false, alive: false };
    const second = { index: 1, isBot: false, alive: true };
    const bots = [2, 3].map(index => ({ index, isBot: true, alive: true }));
    const players = [human, ...(partner ? [second] : []), ...bots];
    const system = new RoundOutcomeSystem({ getPlayers: () => players,
        isArcadeGauntlet: () => arcade, isRespawnPending: player => pending && player === human,
        isOutcomeAuthority: () => authority });
    return { system, human, second, bots };
}

test('a gauntlet ends when its last human dies even with two opponents alive', () => {
    const { system, bots } = fixture();
    const result = system.resolve();
    assert.equal(result.shouldEnd, true);
    assert.equal(result.reason, 'ELIMINATION');
    assert.ok(bots.includes(result.winner));
});

test('a legal pending respawn or surviving partner keeps the gauntlet open', () => {
    assert.equal(fixture({ pending: true }).system.resolve().shouldEnd, false);
    const party = fixture({ partner: true });
    assert.equal(party.system.resolve().shouldEnd, false);
    party.second.alive = false;
    assert.equal(party.system.resolve().shouldEnd, true);
});

test('ordinary elimination, network authority and diagnostic holds keep their own rules', () => {
    assert.equal(fixture({ arcade: false }).system.resolve().shouldEnd, false);
    assert.equal(fixture({ authority: false }).system.resolve().shouldEnd, false);
    const { system } = fixture();
    system.setRoundEndHold(true);
    assert.equal(system.resolve().shouldEnd, false);
    system.setRoundEndHold(false);
    assert.equal(system.resolve().shouldEnd, true);
});
