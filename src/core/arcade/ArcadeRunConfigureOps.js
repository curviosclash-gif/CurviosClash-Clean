// Configuration of the Arcade run (config, records, leaderboard, ghost library budget), moved out of
// ArcadeRunRuntime.configure unchanged. `runtime` is the ArcadeRunRuntime.
import { cloneArcadeRunState, createArcadeRunConfig } from '../../state/arcade/ArcadeRunState.js';
import { loadLeaderboard } from '../../state/arcade/ArcadeLeaderboard.js';
import {
    ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET,
    bootstrapGhostLibraryFromLeaderboard,
    loadGhostLibrary,
} from '../../state/arcade/ArcadeGhostLibrary.js';
import { LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY } from '../../shared/contracts/ArcadeRunSettingsContract.js';
import { hasBlockingArcadePersistenceFailures } from './ArcadeRunPersistenceOps.js';

function toSafeBudgetLimit(value, fallback = 0) {
    const numeric = Math.trunc(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function resolveArcadeGhostLibraryBudgetOptions(runtime, source = null) {
    const budgetSource = source && typeof source === 'object'
        ? source
        : runtime._config;
    return {
        maxRoutes: toSafeBudgetLimit(
            budgetSource?.ghostLibraryMaxRoutes,
            ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET.maxRoutes
        ),
        maxFramesPerRoute: toSafeBudgetLimit(
            budgetSource?.ghostLibraryMaxFramesPerRoute,
            ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET.maxFramesPerRoute
        ),
        maxBytes: toSafeBudgetLimit(
            budgetSource?.ghostLibraryMaxBytes,
            ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET.maxBytes
        ),
    };
}

export function configureArcadeRun(runtime, runtimeConfig = null) {
    runtime.flushPersistenceSaves();
    if (hasBlockingArcadePersistenceFailures(runtime)) {
        throw new Error('Der vorherige Arcade-Fortschritt konnte noch nicht gespeichert werden.');
    }
    const nextConfig = createArcadeRunConfig(runtimeConfig?.arcade || null);
    if (!nextConfig.enabled && runtime._state && !runtime._state.finishedAtIso) {
        runtime._finalizeRun(runtime.now());
        runtime.flushPersistenceSaves();
    }
    const continuing = nextConfig.enabled && runtime._state && !runtime._state.finishedAtIso;
    if (!continuing && !runtime._playerProfileBindingsActive) {
        runtime._primaryRecordStore = undefined;
        runtime._primaryPlayerProfileId = '';
    }
    const store = runtime._resolveSettingsRecordStore();
    if (continuing && runtime._state.config.dailyChallenge) {
        nextConfig.seed = runtime._state.config.seed;
        runtimeConfig.arcade.seed = nextConfig.seed;
    }
    runtime._config = nextConfig;
    const ghostLibraryBudget = runtime._resolveGhostLibraryBudgetOptions(runtimeConfig?.arcade);
    runtime._enabled = nextConfig.enabled === true;
    if (!continuing) runtime._records = runtime._readRecordsFromStorage();
    const legacy = store?.loadJsonRecord?.(LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, null);
    runtime._legacyRecords = legacy?.scoreModel === 'arcade-score.v2' ? {
        bestScore: Math.max(0, Number(legacy.bestScore) || 0),
        runsPlayed: Math.max(0, Number(legacy.runsPlayed) || 0),
    } : null;
    runtime._leaderboard = loadLeaderboard(store);
    runtime._ghostLibrary = loadGhostLibrary(store, ghostLibraryBudget, {
        onMigrationWrite: ({ telemetryDelta }) => runtime._mergeGhostLibraryTelemetryDelta(telemetryDelta),
    });
    const ghostLibraryBootstrap = bootstrapGhostLibraryFromLeaderboard(
        runtime._ghostLibrary,
        runtime._leaderboard,
        { budgetOptions: ghostLibraryBudget }
    );
    runtime._ghostLibrary = ghostLibraryBootstrap.ghostLibrary;
    runtime._mergeGhostLibraryTelemetryDelta(ghostLibraryBootstrap.telemetryDelta);
    if (ghostLibraryBootstrap.changed) {
        runtime._scheduleGhostLibrarySave(store, ghostLibraryBudget);
    }
    if (!runtime._enabled) {
        runtime.resetRunState({ preserveRecords: true });
    }
    return cloneArcadeRunState(runtime._state);
}
