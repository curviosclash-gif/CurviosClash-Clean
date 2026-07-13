import process from 'node:process';

import { createRoundStateController } from '../src/state/RoundStateController.js';
import { coordinateRoundEnd } from '../src/state/RoundEndCoordinator.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createLoggerCapture() {
    const logs = [];
    const errors = [];
    return {
        logger: {
            log: (...args) => logs.push(args.map((v) => String(v)).join(' ')),
            error: (...args) => errors.push(args.map((v) => String(v)).join(' ')),
        },
        logs,
        errors,
    };
}

function createRecorderStub({ throwOnFinalize = false } = {}) {
    const calls = [];
    const recorder = {
        finalizeRound(winner, players) {
            calls.push({ type: 'finalizeRound', winnerIndex: winner?.index ?? null, playerCount: players?.length ?? 0 });
            if (throwOnFinalize) {
                throw new Error('finalize failed');
            }
            return { frames: 42, winnerIndex: winner?.index ?? null };
        },
        dump() {
            calls.push({ type: 'dump' });
        },
    };
    return { recorder, calls };
}

function runHappyPathCase() {
    const roundStateController = createRoundStateController({ defaultRoundPause: 3.0 });
    const players = [
        { index: 0, isBot: false, score: 1 },
        { index: 1, isBot: true, score: 0 },
    ];
    const winner = players[0];
    const { recorder, calls } = createRecorderStub();
    const loggerCapture = createLoggerCapture();

    const result = coordinateRoundEnd({
        recorder,
        winner,
        players,
        roundStateController,
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 3,
        logger: loggerCapture.logger,
    });

    assert(result.recording?.ok === true, 'expected recording.ok === true');
    assert(result.score?.scored === true, 'expected winner score to increment');
    assert(winner.score === 2, `expected winner score=2, got ${winner.score}`);
    assert(result.transition?.nextState === 'ROUND_END', `expected ROUND_END, got ${result.transition?.nextState}`);
    assert(result.effectsPlan?.shouldUpdateHud === true, 'expected effectsPlan.shouldUpdateHud=true');
    assert(result.effectsPlan?.reason === 'ROUND_END', `expected effects reason ROUND_END, got ${result.effectsPlan?.reason}`);
    assert(result.uiState?.visibility?.messageOverlayHidden === false, 'expected round-end overlay to be visible');
    assert(typeof result.uiState?.messageText === 'string' && result.uiState.messageText.length > 0, 'expected uiState.messageText');
    assert(typeof result.transition?.overlayMessageText === 'string' && result.transition.overlayMessageText.length > 0, 'missing overlay text');
    assert(calls.length === 2, `expected 2 recorder calls, got ${calls.length}`);
    assert(calls[0].type === 'finalizeRound', 'expected finalizeRound first');
    assert(calls[1].type === 'dump', 'expected dump second');
    assert(loggerCapture.errors.length === 0, 'expected no logger errors');

    return {
        transitionState: result.transition.nextState,
        winnerScore: winner.score,
        recorderCalls: calls.length,
    };
}

function runMatchEndCase() {
    const roundStateController = createRoundStateController({ defaultRoundPause: 3.0 });
    const players = [
        { index: 0, isBot: false, score: 2 },
        { index: 1, isBot: true, score: 0 },
    ];
    const winner = players[0];
    const { recorder } = createRecorderStub();
    const loggerCapture = createLoggerCapture();

    const result = coordinateRoundEnd({
        recorder,
        winner,
        players,
        roundStateController,
        humanPlayerCount: 1,
        totalBots: 1,
        winsNeeded: 3,
        logger: loggerCapture.logger,
    });

    assert(result.transition?.nextState === 'MATCH_END', `expected MATCH_END, got ${result.transition?.nextState}`);
    assert(result.score?.score === 3, `expected score 3, got ${result.score?.score}`);
    assert(result.effectsPlan?.shouldUpdateHud === true, 'expected HUD update on match-end roundEnd coordination');
    assert(result.uiState?.visibility?.messageOverlayHidden === false, 'expected match-end overlay visible');
    assert(String(result.uiState?.messageSub || '').includes('ENTER'), 'expected restart hint in match-end uiState');

    return {
        transitionState: result.transition.nextState,
        winnerScore: result.score.score,
    };
}

function runRecorderFailureCase() {
    const roundStateController = createRoundStateController({ defaultRoundPause: 3.0 });
    const players = [{ index: 0, isBot: false, score: 0 }];
    const winner = players[0];
    const { recorder, calls } = createRecorderStub({ throwOnFinalize: true });
    const loggerCapture = createLoggerCapture();

    const result = coordinateRoundEnd({
        recorder,
        winner,
        players,
        roundStateController,
        humanPlayerCount: 1,
        totalBots: 0,
        winsNeeded: 2,
        logger: loggerCapture.logger,
    });

    assert(result.recording?.ok === false, 'expected recording failure to be captured');
    assert(winner.score === 1, 'winner score should still increment after recorder failure');
    assert(calls.length === 1 && calls[0].type === 'finalizeRound', 'dump should not run after finalize exception');
    assert(loggerCapture.errors.length >= 1, 'expected logger error entry');
    assert(result.effectsPlan?.shouldUpdateHud === true, 'expected HUD update even on recorder failure');
    assert(result.uiState?.visibility?.messageOverlayHidden === false, 'expected uiState despite recorder failure');

    return {
        recordingOk: result.recording.ok,
        winnerScore: winner.score,
        errorLogs: loggerCapture.errors.length,
    };
}

function runTickCases() {
    const controller = createRoundStateController({ defaultRoundPause: 3.0 });

    const roundWait = controller.deriveRoundEndTick({
        dt: 0.1,
        roundPause: 2.3,
        enterPressed: false,
        escapePressed: false,
    });
    const roundStart = controller.deriveRoundEndTick({
        dt: 0.2,
        roundPause: 0.1,
        enterPressed: false,
        escapePressed: false,
    });
    const roundReturn = controller.deriveRoundEndTick({
        dt: 0.1,
        roundPause: 1.0,
        enterPressed: false,
        escapePressed: true,
    });
    const matchRestart = controller.deriveMatchEndTick({ enterPressed: true, escapePressed: false });
    const matchReturn = controller.deriveMatchEndTick({ enterPressed: false, escapePressed: true });

    assert(roundWait.action === 'WAIT', `expected WAIT, got ${roundWait.action}`);
    assert(roundStart.action === 'START_ROUND', `expected START_ROUND, got ${roundStart.action}`);
    assert(roundReturn.action === 'RETURN_TO_MENU', `expected RETURN_TO_MENU, got ${roundReturn.action}`);
    assert(matchRestart.action === 'RESTART_MATCH', `expected RESTART_MATCH, got ${matchRestart.action}`);
    assert(matchReturn.action === 'RETURN_TO_MENU', `expected RETURN_TO_MENU, got ${matchReturn.action}`);
    assert(typeof roundWait.countdownMessageSub === 'string' && roundWait.countdownMessageSub.includes('Naechste Runde'), 'expected roundWait countdown text');
    assert(roundStart.shouldUpdateCameras === true, 'expected cameras=true on START_ROUND');
    assert(roundReturn.shouldUpdateCameras === false, 'expected cameras=false on round RETURN_TO_MENU');
    assert(matchRestart.shouldUpdateCameras === true, 'expected cameras=true on RESTART_MATCH');
    assert(matchReturn.shouldUpdateCameras === false, 'expected cameras=false on match RETURN_TO_MENU');

    return {
        roundWait: roundWait.action,
        roundStart: roundStart.action,
        roundReturn: roundReturn.action,
        matchRestart: matchRestart.action,
        matchReturn: matchReturn.action,
    };
}

function main() {
    const summary = {
        happyPath: runHappyPathCase(),
        matchEnd: runMatchEndCase(),
        recorderFailure: runRecorderFailureCase(),
        ticks: runTickCases(),
    };

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
}
