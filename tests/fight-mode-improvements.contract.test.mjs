import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { getPreferredFightEnemy } from '../src/hunt/FightTargetSelector.js';
import { emitHuntEliminationFeed } from '../src/hunt/HuntEliminationFeed.js';
import { deriveFightTuningSummary } from '../src/ui/menu/FightMenuTuningSync.js';
import { createMenuDefaultsEditorConfigSnapshot } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { HuntHUD } from '../src/ui/HuntHUD.js';

function player(index, { alive = true, isBot = false, x = 0 } = {}) {
    return {
        index,
        alive,
        isBot,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        position: new THREE.Vector3(x, 0, 0),
    };
}

test('Fight elimination counts humans and bots symmetrically', () => {
    const human = player(0);
    const bot = player(1, { alive: false, isBot: true });
    const system = new RoundOutcomeSystem({ getPlayers: () => [human, bot] });
    assert.deepEqual(system.resolve(), {
        shouldEnd: true,
        winner: human,
        reason: 'ELIMINATION',
        parcours: null,
    });

    bot.alive = true;
    assert.equal(system.resolve().shouldEnd, false);
    human.alive = false;
    assert.equal(system.resolve().winner, bot);
});

test('Fight respawn uses a kill limit instead of endless elimination', () => {
    const players = [player(0), player(1, { isBot: true })];
    let kills = 9;
    const system = new RoundOutcomeSystem({
        getPlayers: () => players,
        isRespawnEnabled: () => true,
        getDeathmatchKillLimit: () => 10,
        getScoreboard: () => [{ playerIndex: 0, kills }],
    });
    assert.equal(system.resolve().shouldEnd, false);
    kills = 10;
    assert.deepEqual(system.resolve(), {
        shouldEnd: true,
        winner: players[0],
        reason: 'KILL_LIMIT',
        parcours: null,
    });
});

test('Fight Standard starts one respawn deathmatch instead of endless rounds', () => {
    const preset = createMenuDefaultsEditorConfigSnapshot().fixedPresets.find((entry) => entry.id === 'fight-standard');
    assert.equal(preset.values.winsNeeded, 1);
    assert.equal(preset.values['hunt.respawnEnabled'], true);
});

test('Fight non-rocket pickup selection samples RNG once', () => {
    let calls = 0;
    const strategy = new HuntModeStrategy({ random: () => (++calls, 0.25) });
    const picked = strategy.resolveSpawnType(['SHIELD', 'SPEED_UP'], {
        HUNT: {
            ROCKET_PICKUP_SPAWN_CHANCE: 0,
            PICKUP_WEIGHTS: { SHIELD: 1, SPEED_UP: 1 },
        },
    });
    assert.equal(picked, 'SHIELD');
    assert.equal(calls, 1);
});

test('Fight target selection spreads bots and prioritizes retaliation', () => {
    const players = [
        player(0, { x: 10 }),
        player(1, { isBot: true }),
        player(2, { isBot: true }),
        player(3, { isBot: true }),
    ];
    players[2].position.set(0, 10, 0);
    players[3].position.set(0, 0, 10);
    const bot = players[1];
    const target = getPreferredFightEnemy(bot, players, new THREE.Vector3());
    assert.equal(target.enemy.index, 2);
    bot.fightLastAttackerIndex = 0;
    assert.equal(getPreferredFightEnemy(bot, players, new THREE.Vector3()).enemy.index, 0);
});

test('Fight tuning summary includes hangar HP and readable TTK', () => {
    const summary = deriveFightTuningSummary({
        settings: {
            vehicles: { PLAYER_1: 'ship5' },
            localSettings: { fightHangar: { activeBonusesByVehicle: { ship5: { maxHpBonus: 60 } } } },
        },
        fightPlayerHp: 100,
        fightMgDamage: 7.75,
        config: { HUNT: { MG: { COOLDOWN: 0.08, OVERHEAT_PER_SHOT: 9, COOLING_PER_SECOND: 20, LOCKOUT_THRESHOLD: 96, LOCKOUT_SECONDS: 0.75, MIN_FALLOFF: 0.5 } } },
    });
    assert.match(summary.text, /effektiv 160 HP/);
    assert.match(summary.text, /nah \d+ Treffer\/\d+\.\d s/);
});

test('Fight scoring exposes K/T/A and runtime projection keeps deathmatch state', () => {
    const attacker = player(0);
    const helper = player(1, { isBot: true });
    const target = player(2, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(helper, target, { applied: 4, hpApplied: 4 }, 1);
    const elimination = scoring.registerElimination(target, { killer: attacker, nowSeconds: 2 });
    assert.deepEqual(elimination, { killerIndex: 0, assistIndices: [1] });
    assert.match(scoring.formatSummary([attacker, helper, target]), /K1\/T0\/A0/);
    assert.match(scoring.formatSummary([attacker, helper, target]), /K0\/T0\/A1/);

    const feed = [];
    emitHuntEliminationFeed({ emitHuntFeed: (message) => feed.push(message) }, [attacker, helper, target], target, attacker, elimination.assistIndices);
    assert.deepEqual(feed, ['P1 -> Bot 3: ausgeschaltet', 'Bot 2: Assist bei Bot 3']);

    const projection = createMatchRuntimeProjection({
        updatedAt: 100,
        hunt: {
            active: true,
            respawnEnabled: true,
            deathmatchKillLimit: 10,
            respawnRemainingByPlayer: { 0: 2.4 },
        },
    });
    assert.equal(projection.hunt.respawnEnabled, true);
    assert.equal(projection.hunt.deathmatchKillLimit, 10);
    assert.equal(projection.hunt.respawnRemainingByPlayer[0], 2.4);
});

function element() {
    const classes = new Set();
    return {
        style: {},
        textContent: '',
        attributes: {},
        classList: {
            add: (name) => classes.add(name),
            toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
            contains: (name) => classes.has(name),
        },
        setAttribute(name, value) { this.attributes[name] = value; },
    };
}

test('Fight HUD keeps HP, objective, score and respawn accessible outside fighter camera', () => {
    const root = element();
    const objective = element();
    const scoreboard = element();
    const hpFill = element();
    const hpText = element();
    const respawn = element();
    const hud = new HuntHUD({
        runtime: { activeGameMode: 'HUNT', state: 'PLAYING' },
        refs: { root, objective, scoreboard, p1HpFill: hpFill, p1HpText: hpText, p1Respawn: respawn },
    });
    hud.update(0.2, {
        players: [{ playerIndex: 0, isBot: false, alive: false, hp: 35, maxHp: 100 }],
        hunt: {
            active: true,
            respawnEnabled: true,
            deathmatchKillLimit: 10,
            scoreboardSummary: 'P1 K2/T1/A0',
            respawnRemainingByPlayer: { 0: 1.6 },
            overheatByPlayer: {},
            killFeed: [],
        },
    });
    assert.equal(root.attributes['aria-hidden'], 'false');
    assert.equal(hpFill.style.width, '35.0%');
    assert.equal(hpText.textContent, '35 / 100');
    assert.match(objective.textContent, /10 Abschüsse/);
    assert.equal(scoreboard.textContent, 'P1 K2/T1/A0');
    assert.match(respawn.textContent, /1\.6 s/);

    hud.runtime.activeGameMode = 'CLASSIC';
    hud.update(0.2);
    assert.equal(root.attributes['aria-hidden'], 'true');
});
