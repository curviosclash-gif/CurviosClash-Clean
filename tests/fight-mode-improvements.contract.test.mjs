import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoundOutcomeSystem } from '../src/entities/systems/RoundOutcomeSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { getPreferredFightEnemy } from '../src/hunt/FightTargetSelector.js';
import { emitHuntEliminationFeed } from '../src/hunt/HuntEliminationFeed.js';
import { createHuntNetworkState, applyHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { SpawnPlacementSystem } from '../src/entities/systems/SpawnPlacementSystem.js';
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

test('Fight time limit resolves a leader and tied matches continue as Golden Kill', () => {
    const players = [player(0), player(1, { isBot: true })];
    let scoreboard = [
        { playerIndex: 0, kills: 4 },
        { playerIndex: 1, kills: 3 },
    ];
    const system = new RoundOutcomeSystem({
        getPlayers: () => players,
        isRespawnEnabled: () => true,
        getDeathmatchKillLimit: () => 10,
        getDeathmatchTimeLimitSeconds: () => 300,
        getElapsedSeconds: () => 300,
        getScoreboard: () => scoreboard,
    });
    assert.equal(system.resolve().reason, 'TIME_LIMIT');

    system.reset();
    scoreboard = [
        { playerIndex: 0, kills: 4 },
        { playerIndex: 1, kills: 4 },
    ];
    assert.deepEqual(system.resolve(), {
        shouldEnd: false,
        winner: null,
        reason: 'OVERTIME',
        parcours: null,
    });
    assert.equal(system.getDeathmatchState().overtime, true);
    scoreboard[0].kills = 5;
    assert.equal(system.resolve().reason, 'OVERTIME');
});

test('Fight network clients never resolve respawn outcomes locally', () => {
    const system = new RoundOutcomeSystem({
        getPlayers: () => [player(0), player(1, { isBot: true })],
        isRespawnEnabled: () => true,
        isOutcomeAuthority: () => false,
        getDeathmatchKillLimit: () => 5,
        getScoreboard: () => [{ playerIndex: 0, kills: 5 }],
    });
    assert.equal(system.resolve().shouldEnd, false);
});

test('Fight Standard starts one respawn deathmatch instead of endless rounds', () => {
    const preset = createMenuDefaultsEditorConfigSnapshot().fixedPresets.find((entry) => entry.id === 'fight-standard');
    assert.equal(preset.values.winsNeeded, 1);
    assert.equal(preset.values['hunt.respawnEnabled'], true);
    assert.equal(preset.values['hunt.deathmatchKillLimit'], 10);
    assert.equal(preset.values['hunt.timeLimitEnabled'], true);
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
    players[0].position.set(1, 0, 0);
    assert.equal(getPreferredFightEnemy(bot, players, new THREE.Vector3(), 0.1).enemy.index, 0);
    assert.equal(getPreferredFightEnemy(bot, players, new THREE.Vector3(), 1).enemy.index, 0);
});

test('Fight target lock stays stable, expires, and yields immediately to retaliation', () => {
    const bot = player(1, { isBot: true });
    const locked = player(2, { x: 10 });
    const challenger = player(3, { x: 6.5 });
    const attacker = player(0, { x: 8 });
    const scratch = new THREE.Vector3();

    assert.equal(getPreferredFightEnemy(bot, [bot, locked], scratch).enemy, locked);
    assert.equal(getPreferredFightEnemy(bot, [bot, locked, challenger], scratch, 0.25).enemy, locked);
    assert.equal(getPreferredFightEnemy(bot, [bot, locked, challenger], scratch, 0.25).enemy, locked);
    assert.equal(getPreferredFightEnemy(bot, [bot, locked, challenger], scratch, 0.26).enemy, challenger);

    bot.fightLastAttackerIndex = attacker.index;
    assert.equal(getPreferredFightEnemy(bot, [bot, challenger, attacker], scratch).enemy, attacker);
});

test('Fight target lock releases for death, invalid targets, and clearly better enemies', () => {
    const bot = player(1, { isBot: true });
    const locked = player(2, { x: 10 });
    const challenger = player(3, { x: 12 });
    const players = [bot, locked, challenger];
    const scratch = new THREE.Vector3();

    assert.equal(getPreferredFightEnemy(bot, players, scratch).enemy, locked);
    challenger.position.set(8, 0, 0);
    assert.equal(getPreferredFightEnemy(bot, players, scratch, 0.1).enemy, locked);

    challenger.position.set(2, 0, 0);
    assert.equal(getPreferredFightEnemy(bot, players, scratch, 0.1).enemy, challenger);

    challenger.alive = false;
    assert.equal(getPreferredFightEnemy(bot, players, scratch).enemy, locked);

    locked.position.x = Number.NaN;
    challenger.alive = true;
    assert.equal(getPreferredFightEnemy(bot, players, scratch).enemy, challenger);

    challenger.position.x = Number.NaN;
    const empty = getPreferredFightEnemy(bot, players, scratch);
    assert.equal(empty.enemy, null);
    assert.equal(bot.fightTargetPlayerIndex, -1);
    assert.equal(bot.fightTargetLockRemaining, 0);
});

test('Fight spawns avoid visible enemies, recent deaths and recent spawn points', () => {
    const enemy = player(1, { x: 30 });
    const owner = {
        arena: { checkCollision: () => false },
        players: [enemy],
        _tmpVec: new THREE.Vector3(),
    };
    const system = new SpawnPlacementSystem(owner);
    const candidate = new THREE.Vector3();
    const spawningPlayer = player(0);
    assert.equal(system._isSpawnPositionSafe(candidate, 1, 144, owner.players, spawningPlayer), false);

    enemy.position.set(50, 0, 0);
    assert.equal(system._isSpawnPositionSafe(candidate, 1, 144, owner.players, spawningPlayer), true);
    spawningPlayer.fightLastDeathPosition = new THREE.Vector3(1, 0, 0);
    assert.equal(system._isSpawnPositionSafe(candidate, 1, 144, owner.players, spawningPlayer), false);
    spawningPlayer.fightLastDeathPosition = null;
    system._rememberSpawn(new THREE.Vector3(2, 0, 0));
    assert.equal(system._isSpawnPositionSafe(candidate, 1, 144, owner.players, spawningPlayer), false);
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
    const weakHelper = player(3, { isBot: true });
    const scoring = new HuntScoring();
    scoring.registerDamage(helper, target, { applied: 20, hpApplied: 20 }, 1);
    scoring.registerDamage(weakHelper, target, { applied: 4, hpApplied: 4 }, 1);
    const elimination = scoring.registerElimination(target, { killer: attacker, nowSeconds: 2 });
    assert.deepEqual(elimination, { killerIndex: 0, assistIndices: [1] });
    assert.match(scoring.formatSummary([attacker, helper, target, weakHelper]), /K1\/T0\/A0/);
    assert.match(scoring.formatSummary([attacker, helper, target, weakHelper]), /K0\/T0\/A1/);
    const precomputedRows = scoring.getScoreboard([attacker, helper, target, weakHelper]);
    scoring.getScoreboard = () => { throw new Error('scoreboard must not be rebuilt'); };
    assert.match(scoring.formatSummary([], { rows: precomputedRows }), /K1\/T0\/A0/);

    const feed = [];
    emitHuntEliminationFeed({ emitHuntFeed: (message) => feed.push(message) }, [attacker, helper, target], target, attacker, elimination.assistIndices);
    assert.deepEqual(feed, ['P1 -> Bot 3: ausgeschaltet', 'Bot 2: Assist bei Bot 3']);

    const projection = createMatchRuntimeProjection({
        updatedAt: 100,
        hunt: {
            active: true,
            respawnEnabled: true,
            deathmatchKillLimit: 10,
            scoreboardRows: [{ playerIndex: 0, label: 'P1', kills: 2, deaths: 1, assists: 1, spawnDeaths: 1 }],
            elapsedSeconds: 122,
            timeLimitSeconds: 300,
            timeRemainingSeconds: 178,
            overtime: false,
            respawnRemainingByPlayer: { 0: 2.4 },
        },
    });
    assert.equal(projection.hunt.respawnEnabled, true);
    assert.equal(projection.hunt.deathmatchKillLimit, 10);
    assert.equal(projection.hunt.scoreboardRows[0].spawnDeaths, 1);
    assert.equal(projection.hunt.timeRemainingSeconds, 178);
    assert.equal(projection.hunt.respawnRemainingByPlayer[0], 2.4);
});

test('Fight host state synchronizes scores and one authoritative outcome to a client', () => {
    const hostPlayers = [player(0), player(1, { isBot: true })];
    const hostScoring = new HuntScoring();
    hostScoring.registerElimination(hostPlayers[1], { killer: hostPlayers[0], spawnAgeSeconds: 3 });
    const host = {
        huntEnabled: true,
        players: hostPlayers,
        _huntScoring: hostScoring,
        _roundOutcomeSystem: { getDeathmatchState: () => ({ elapsedSeconds: 30, timeLimitSeconds: 300, timeRemainingSeconds: 270, overtime: false }) },
        _lastRoundOutcome: { shouldEnd: true, winner: hostPlayers[0], reason: 'KILL_LIMIT' },
        entityRuntimeConfig: { HUNT: { DEATHMATCH_KILL_LIMIT: 5 } },
    };
    const state = createHuntNetworkState(host);
    const emitted = [];
    const clientPlayers = [player(0), player(1, { isBot: true })];
    const client = {
        players: clientPlayers,
        _huntScoring: new HuntScoring(),
        _eventBus: { emitRoundEnd: (winner, outcome) => emitted.push({ winner, outcome }) },
    };
    applyHuntNetworkState(client, state);
    applyHuntNetworkState(client, state);
    assert.equal(client._huntScoring.getScoreboard(clientPlayers)[0].kills, 1);
    assert.equal(client._authoritativeHuntState.killLimit, 5);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].winner, clientPlayers[0]);
    assert.equal(emitted[0].outcome.reason, 'KILL_LIMIT');
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
    const turret = element();
    const hud = new HuntHUD({
        runtime: { activeGameMode: 'HUNT', state: 'PLAYING' },
        refs: {
            root,
            objective,
            scoreboard,
            p1HpFill: hpFill,
            p1HpText: hpText,
            p1Respawn: respawn,
            p1Turret: turret,
        },
    });
    hud.update(0.2, {
        players: [{
            playerIndex: 0,
            isBot: false,
            alive: false,
            hp: 35,
            maxHp: 100,
            turret: { remainingSeconds: 12.4, hp: 31, maxHp: 45 },
        }],
        hunt: {
            active: true,
            respawnEnabled: true,
            deathmatchKillLimit: 10,
            scoreboardRows: [{ playerIndex: 0, label: 'P1', kills: 2, deaths: 1, assists: 0 }],
            scoreboardSummary: 'legacy',
            timeLimitSeconds: 300,
            timeRemainingSeconds: 178,
            respawnRemainingByPlayer: { 0: 1.6 },
            overheatByPlayer: {},
            killFeed: [],
        },
    });
    assert.equal(root.attributes['aria-hidden'], 'false');
    assert.equal(hpFill.style.width, '35.0%');
    assert.equal(hpText.textContent, '35 / 100');
    assert.match(objective.textContent, /10 Abschüsse/);
    assert.match(objective.textContent, /2:58/);
    assert.match(scoreboard.textContent, /P1 2/);
    assert.match(scoreboard.attributes['aria-label'], /P1: 2\/10 Abschüsse/);
    assert.match(scoreboard.attributes['aria-label'], /1 Tode/);
    assert.match(respawn.textContent, /1\.6 s/);
    assert.equal(turret.textContent, 'Geschütz 13 s · 31/45 HP');

    hud.runtime.activeGameMode = 'CLASSIC';
    hud.update(0.2);
    assert.equal(root.attributes['aria-hidden'], 'true');
});

test('Fight HUD shows overheat as a full reserve that shrinks from green through orange to red', () => {
    const root = element();
    const overheatFill = element();
    overheatFill.style.setProperty = (name, value) => {
        overheatFill.style[name] = value;
    };
    const overheatText = element();
    const hud = new HuntHUD({
        runtime: { activeGameMode: 'HUNT', state: 'PLAYING' },
        refs: { root, p1OverheatFill: overheatFill, p1OverheatText: overheatText },
    });
    const projection = (overheat) => ({
        players: [{ playerIndex: 0, isBot: false }],
        hunt: {
            active: true,
            overheatByPlayer: { 0: overheat },
            killFeed: [],
        },
    });

    hud.update(0.2, projection(0));
    assert.equal(overheatFill.style.width, '100.0%');
    assert.equal(overheatFill.style['--hunt-segments-filled'], '100%');
    assert.equal(overheatText.textContent, '0%');
    assert.equal(overheatFill.classList.contains('warning'), false);
    assert.equal(overheatFill.classList.contains('danger'), false);

    hud.update(0.2, projection(50));
    assert.equal(overheatFill.style.width, '50.0%');
    assert.equal(overheatFill.style['--hunt-segments-filled'], '50%');
    assert.equal(overheatText.textContent, '50%');
    assert.equal(overheatFill.classList.contains('warning'), true);
    assert.equal(overheatFill.classList.contains('danger'), false);

    hud.update(0.2, projection(80));
    assert.equal(overheatFill.style.width, '20.0%');
    assert.equal(overheatFill.style['--hunt-segments-filled'], '20%');
    assert.equal(overheatText.textContent, '80%');
    assert.equal(overheatFill.classList.contains('warning'), false);
    assert.equal(overheatFill.classList.contains('danger'), true);
});
