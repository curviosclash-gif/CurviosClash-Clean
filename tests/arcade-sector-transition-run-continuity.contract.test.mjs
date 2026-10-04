import assert from 'node:assert/strict';
import test from 'node:test';

import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';

/**
 * Steht für den Laufzeitzustand, den GameRuntimeArcadeSupport über getRuntimeState()
 * liest. Nur die Felder, die der Arcade-Pfad wirklich anfasst: die Rundensteuerung
 * (wird durch die Arcade-Variante ersetzt) und die Sitzungsdaten, aus denen der
 * Sektorwechsel ableitet, ob Karte oder Bot-Anzahl wechseln.
 */
function createRuntimeState(botDifficulty = 'NORMAL') {
    return {
        roundStateController: {
            deriveOnRoundEndPlan: () => null,
            deriveRoundEndTick: () => null,
            deriveMatchEndTick: () => null,
        },
        entityManager: null,
        runtimeConfig: {
            arcade: {
                enabled: true,
                seed: 1,
                sectorCount: 5,
                intermissionSeconds: 10,
                dailyChallenge: false,
            },
            bot: { activeDifficulty: String(botDifficulty) },
            player: { vehicles: { PLAYER_1: 'aircraft' } },
            session: { mapKey: 'standard', numBots: 2 },
        },
    };
}

function createSupport(botDifficulty = 'NORMAL') {
    const runtimeState = createRuntimeState(botDifficulty);
    const support = new GameRuntimeArcadeSupport({
        getGame: () => null,
        getRuntimeState: () => runtimeState,
        nowMs: () => 1_000_000,
        logger: { warn() {}, error() {}, debug() {} },
        // Der Sektorwechsel schreibt sein Profil normalerweise in die Sitzung zurück.
        applySectorRuntimeProfile: (profile) => {
            if (!profile) return;
            if (profile.mapKey) runtimeState.runtimeConfig.session.mapKey = String(profile.mapKey);
            if (Number.isFinite(profile.botCount)) {
                runtimeState.runtimeConfig.session.numBots = Number(profile.botCount);
            }
            // Wie GameRuntimeFacade._applySectorRuntimeProfile: die Sektorstufe wird
            // zur neuen Laufzeit-Schwierigkeit der Bots.
            if (profile.botDifficulty) {
                runtimeState.runtimeConfig.bot.activeDifficulty = String(profile.botDifficulty);
            }
        },
    });
    return { support, runtimeState };
}

/** Ein lebender menschlicher Spieler: so wertet die Runtime den Sektor als bestanden. */
function createLivingHuman() {
    return { index: 0, isBot: false, alive: true, hp: 100 };
}

test('a sector transition that rebuilds the session keeps the running arcade run', () => {
    const { support, runtimeState } = createSupport();
    support.syncRuntimeConfig();
    support.startRunIfEnabled();

    const started = support.getRunState();
    assert.equal(started.sectorIndex, 1, 'the run starts in sector 1');

    // Sektor 1 gewinnen: kein Abbruchgrund, ein lebender Mensch.
    const roundEndPlan = support.arcadeRunRuntime.deriveRoundEndPlan({
        players: [createLivingHuman()],
        inputs: { winsNeeded: 1 },
        baseController: runtimeState.roundStateController,
    });
    assert.equal(
        roundEndPlan?.outcome?.state,
        'ROUND_END',
        'a won sector ends the round, not the run'
    );

    const afterSector = support.getRunState();
    assert.equal(afterSector.completedSectors, 1, 'sector 1 counts as completed');
    const scoreAfterSector = Number(afterSector.score?.total) || 0;

    // Die Rundensteuerung zieht in den nächsten Sektor weiter; dabei meldet die
    // Runtime den Kartenwechsel, aus dem der Sitzungs-Neuaufbau entsteht.
    support.arcadeRunRuntime.beginNextSector();
    const transition = support.consumePendingSectorTransition();
    assert.ok(transition, 'the sector transition is queued for the session');
    assert.equal(
        transition.requiresSessionRebuild,
        true,
        'a new map or bot count forces the session to be rebuilt'
    );

    // Genau das tut der Neuaufbau: teardownRuntimeSession() räumt den Arcade-Zustand ab
    // und die neue Sitzung startet den Run über startRunIfEnabled() erneut.
    support.resetRunState({ preserveRecords: true });
    support.startRunIfEnabled();

    const resumed = support.getRunState();
    assert.equal(resumed.runId, started.runId, 'the sector transition continues the same run');
    assert.equal(resumed.sectorIndex, 2, 'the run continues in sector 2');
    assert.equal(resumed.completedSectors, 1, 'the completed sector survives the rebuild');
    assert.equal(
        Number(resumed.score?.total) || 0,
        scoreAfterSector,
        'the score earned in sector 1 survives the rebuild'
    );
});

test('leaving the match clears the arcade run even mid-transition', () => {
    const { support, runtimeState } = createSupport();
    support.syncRuntimeConfig();
    support.startRunIfEnabled();
    support.arcadeRunRuntime.deriveRoundEndPlan({
        players: [createLivingHuman()],
        inputs: { winsNeeded: 1 },
        baseController: runtimeState.roundStateController,
    });
    support.arcadeRunRuntime.beginNextSector();
    support.consumePendingSectorTransition();

    // Rückkehr ins Menü: hier muss der Run verschwinden, sonst setzt der nächste
    // Arcade-Start den alten Lauf fort statt neu zu beginnen.
    support.resetRunState({ preserveRecords: true, force: true });
    support.startRunIfEnabled();

    const restarted = support.getRunState();
    assert.equal(restarted.sectorIndex, 1, 'a forced reset starts the next run in sector 1');
    assert.equal(restarted.completedSectors, 0, 'a forced reset drops the completed sectors');
});

test('normal Arcade ignores global HARD through the sector transition', () => {
    const { support, runtimeState } = createSupport('HARD');
    support.syncRuntimeConfig();
    // Der Matchstart schreibt das Profil von Sektor 1 in die Laufzeit-Konfiguration.
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();
    assert.equal(
        runtimeState.runtimeConfig.bot.activeDifficulty,
        'NORMAL',
        'sector 1 uses the normal run tier independently of global HARD'
    );

    support.arcadeRunRuntime.deriveRoundEndPlan({
        players: [createLivingHuman()],
        inputs: { winsNeeded: 1 },
        baseController: runtimeState.roundStateController,
    });
    support.arcadeRunRuntime.beginNextSector();
    const transition = support.consumePendingSectorTransition();

    assert.equal(
        transition.botDifficulty,
        'NORMAL',
        'the normal run tier survives the sector transition'
    );
    assert.equal(
        runtimeState.runtimeConfig.bot.activeDifficulty,
        'NORMAL',
        'sector 2 is independent of global HARD'
    );
});

test('normal Arcade also ignores global EASY through the sector transition', () => {
    const { support, runtimeState } = createSupport('EASY');
    // Seed 2 fuehrt auf einen Sektor 2 mit niedrigem Druck (0.405): dort darf EASY bleiben.
    runtimeState.runtimeConfig.arcade.seed = 2;
    support.syncRuntimeConfig();
    support.prepareMatchStartRuntime();
    support.startRunIfEnabled();

    support.arcadeRunRuntime.deriveRoundEndPlan({
        players: [createLivingHuman()],
        inputs: { winsNeeded: 1 },
        baseController: runtimeState.roundStateController,
    });
    support.arcadeRunRuntime.beginNextSector();
    const transition = support.consumePendingSectorTransition();

    // Der Sektordruck darf die Stufe anheben, ein fester Ersatzwert darf sie nicht ersetzen.
    const pressure = Number(transition.pressure) || 0;
    assert.ok(pressure <= 0.72, 'the chosen seed stays below HARD pressure');
    assert.equal(
        transition.botDifficulty,
        'NORMAL',
        'the normal run tier is independent of global EASY'
    );
});
