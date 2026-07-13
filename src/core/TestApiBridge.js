// @ts-check

import { sanitizeBotAction } from '../entities/ai/actions/BotActionContract.js';
import * as ItemSlotEncoder from '../entities/ai/observation/ItemSlotEncoder.js';
import * as ModeFeatureEncoder from '../entities/ai/observation/ModeFeatureEncoder.js';
import * as ObservationSchemaV1 from '../entities/ai/observation/ObservationSchemaV1.js';
import * as ObservationSemantics from '../entities/ai/observation/ObservationSemantics.js';
import * as ObservationSystem from '../entities/ai/observation/ObservationSystem.js';
import { BotPolicyRegistry } from '../entities/ai/BotPolicyRegistry.js';
import { BOT_POLICY_TYPES } from '../entities/ai/BotPolicyTypes.js';
import { ClassicBridgePolicy } from '../entities/ai/ClassicBridgePolicy.js';
import { HuntBridgePolicy } from '../entities/ai/HuntBridgePolicy.js';
import { ObservationBridgePolicy } from '../entities/ai/ObservationBridgePolicy.js';
import { decideItemUsage } from '../entities/ai/BotDecisionOps.js';
import { HuntBotPolicy } from '../hunt/HuntBotPolicy.js';
import { applyTrailDamageFromProjectile } from '../hunt/DestructibleTrail.js';
import { updatePlayerHealthRegen } from '../hunt/HealthSystem.js';
import { createRuntimeConfigSnapshot } from './RuntimeConfig.js';
import * as AppInitializerTestHooksModule from './AppInitializerTestHooks.js';
import * as GameLoopModule from './GameLoop.js';
import * as RuntimePerfProfilerModule from './perf/RuntimePerfProfiler.js';
import * as MediaRecorderSystemModule from './MediaRecorderSystem.js';
import * as RecordingCaptureContractModule from '../shared/contracts/RecordingCaptureContract.js';
import * as RecordingCapturePipelineModule from './renderer/RecordingCapturePipeline.js';
import * as RecordingOrbitCameraDirectorModule from './renderer/camera/RecordingOrbitCameraDirector.js';
import * as DownloadServiceModule from './recording/DownloadService.js';
import * as WebCodecsRecorderEngineModule from './recording/engines/WebCodecsRecorderEngine.js';
import * as RuntimeSessionLifecycleServiceModule from './runtime/RuntimeSessionLifecycleService.js';
import * as MatchStartValidationServiceModule from './runtime/MatchStartValidationService.js';
import * as TelemetryHistoryStoreModule from '../state/TelemetryHistoryStore.js';

/**
 * @typedef {Window & typeof globalThis & { CURVIOS_TEST_API?: any }} RuntimeWindow
 */

const TEST_MODULE_EXPORTS = Object.freeze({
    '/src/core/AppInitializerTestHooks.js': Object.freeze({ ...AppInitializerTestHooksModule }),
    '/src/core/GameLoop.js': Object.freeze({ ...GameLoopModule }),
    '/src/core/perf/RuntimePerfProfiler.js': Object.freeze({ ...RuntimePerfProfilerModule }),
    '/src/core/MediaRecorderSystem.js': Object.freeze({ ...MediaRecorderSystemModule }),
    '/src/shared/contracts/RecordingCaptureContract.js': Object.freeze({ ...RecordingCaptureContractModule }),
    '/src/core/renderer/RecordingCapturePipeline.js': Object.freeze({ ...RecordingCapturePipelineModule }),
    '/src/core/renderer/camera/RecordingOrbitCameraDirector.js': Object.freeze({ ...RecordingOrbitCameraDirectorModule }),
    '/src/core/recording/DownloadService.js': Object.freeze({ ...DownloadServiceModule }),
    '/src/core/recording/engines/WebCodecsRecorderEngine.js': Object.freeze({ ...WebCodecsRecorderEngineModule }),
    '/src/core/runtime/RuntimeSessionLifecycleService.js': Object.freeze({ ...RuntimeSessionLifecycleServiceModule }),
    '/src/core/runtime/MatchStartValidationService.js': Object.freeze({ ...MatchStartValidationServiceModule }),
    '/src/state/TelemetryHistoryStore.js': Object.freeze({ ...TelemetryHistoryStoreModule }),
});

export async function importCurviosTestModule(moduleSpecifier) {
    const normalizedSpecifier = String(moduleSpecifier || '').trim();
    if (normalizedSpecifier && Object.prototype.hasOwnProperty.call(TEST_MODULE_EXPORTS, normalizedSpecifier)) {
        return TEST_MODULE_EXPORTS[normalizedSpecifier];
    }
    return import(normalizedSpecifier);
}

export function buildCurviosTestApi() {
    return Object.freeze({
        sanitizeBotAction,
        ItemSlotEncoder,
        ModeFeatureEncoder,
        ObservationSchemaV1,
        ObservationSemantics,
        ObservationSystem,
        BotPolicyRegistry,
        BOT_POLICY_TYPES,
        ClassicBridgePolicy,
        HuntBridgePolicy,
        ObservationBridgePolicy,
        decideItemUsage,
        HuntBotPolicy,
        applyTrailDamageFromProjectile,
        updatePlayerHealthRegen,
        createRuntimeConfigSnapshot,
        importCurviosTestModule,
        testModuleExports: TEST_MODULE_EXPORTS,
    });
}

/**
 * @param {RuntimeWindow} runtimeWindow
 */
export function attachCurviosTestApi(runtimeWindow) {
    if (!runtimeWindow || typeof runtimeWindow !== 'object') return;
    const fullApi = buildCurviosTestApi();
    const existingApi = runtimeWindow.CURVIOS_TEST_API && typeof runtimeWindow.CURVIOS_TEST_API === 'object'
        ? runtimeWindow.CURVIOS_TEST_API
        : null;
    if (existingApi) {
        runtimeWindow.CURVIOS_TEST_API = Object.freeze({
            ...existingApi,
            ...fullApi,
        });
        return;
    }
    runtimeWindow.CURVIOS_TEST_API = fullApi;
}
