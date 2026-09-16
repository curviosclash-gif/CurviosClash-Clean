import { createLogger } from '../../shared/logging/Logger.js';

const logger = createLogger('MatchStartRuntimeService');

function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}

export class MatchStartRuntimeService {
    constructor({ facade = null } = {}) {
        this._facade = facade || null;
        this._generation = 0;
    }

    cancel() {
        this._generation += 1;
    }

    _getPorts() {
        return this._facade?.getPorts?.() || this._facade?.ports || null;
    }

    _getSessionOrchestrator() {
        return this._facade?.getRuntimeHandle?.('matchSessionOrchestrator') || null;
    }

    _createLifecycleHandlers() {
        const ports = this._getPorts();
        return {
            onPlayerFeedback: (player, message) => {
                ports?.uiFeedbackPort?.showPlayerFeedback?.(player, message);
            },
            onPlayerDied: (player, cause) => {
                if (player?.isBot) return;
                const message = ports?.uiFeedbackPort?.getDeathMessage?.(cause) || '';
                ports?.uiFeedbackPort?.showStatusToast?.(message, 2500, 'error');
            },
            onRoundEnd: (winner, outcome) => {
                if (this._facade?.isNetworkSession?.() && !this._facade?.isHost?.()) return;
                ports?.matchUiPort?.onRoundEnd?.(winner, outcome);
            },
        };
    }

    async execute() {
        const generation = ++this._generation;
        const ports = this._getPorts();
        const matchUiPort = ports?.matchUiPort || null;
        const lifecyclePort = ports?.lifecyclePort || null;
        const orchestrator = this._getSessionOrchestrator();
        if (
            !orchestrator?.createMatchSession
            || !matchUiPort?.prepareMatchStartProjection
            || !lifecyclePort?.initializeSession
        ) {
            return false;
        }

        if (matchUiPort.prepareMatchStartProjection() === false) {
            return false;
        }
        const loadingFrame = matchUiPort.waitForMatchLoadingFrame?.();
        if (isPromiseLike(loadingFrame)) {
            await Promise.resolve(loadingFrame);
        }
        if (generation !== this._generation) {
            return false;
        }
        const sessionInitialized = await Promise.resolve(lifecyclePort?.initializeSession?.());
        if (sessionInitialized === false || generation !== this._generation) {
            return false;
        }
        matchUiPort.configureMatchInputSources?.();

        const initializedMatch = await Promise.resolve(
            orchestrator.createMatchSession(this._createLifecycleHandlers())
        );
        if (!initializedMatch || generation !== this._generation) {
            return false;
        }

        const loadGate = lifecyclePort?.waitForAllPlayersLoaded?.();
        if (isPromiseLike(loadGate)) {
            await Promise.resolve(loadGate);
        }
        if (generation !== this._generation) {
            return false;
        }

        this._facade?.startArcadeRunIfEnabled?.();
        matchUiPort.bindMatchStartRuntime?.();
        matchUiPort.startRound?.();
        matchUiPort.completeMatchStartProjection?.(initializedMatch);
        return true;
    }

    async executeSafely() {
        try {
            return await this.execute();
        } catch (error) {
            logger.error('match start failed:', error);
            this._getPorts()?.uiFeedbackPort?.showStatusToast?.(
                'Map-Start fehlgeschlagen. Fallback oder Menue wird geladen.',
                2600,
                'error'
            );
            await Promise.resolve(this._facade?.returnToMenu?.({
                reason: 'match_start_failure',
                trigger: 'match_start_failure',
            }));
            return false;
        }
    }
}
