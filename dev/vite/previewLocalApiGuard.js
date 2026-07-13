export const LOCAL_MUTATION_APIS_ENV = 'ENABLE_LOCAL_MUTATION_APIS';
export const LOCAL_ARTIFACT_APIS_ENV = 'ENABLE_LOCAL_ARTIFACT_APIS';
export const PREVIEW_LOCAL_MUTATION_DISABLED_ERROR = 'preview-local-mutation-disabled';
export const PREVIEW_LOCAL_ARTIFACT_DISABLED_ERROR = 'preview-local-artifact-disabled';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const LOCAL_API_ROUTE_CLASS = Object.freeze({
    ARTIFACT_READ: 'artifact-read',
    DISK_WRITE: 'disk-write',
    LOCAL_MUTATION: 'local-mutation',
    PROCESS_CONTROL: 'process-control',
    TEST_HEALTH: 'test-health',
    TRAINING_PROCESS: 'training-process',
});

export const LOCAL_API_PREVIEW_ACCESS = Object.freeze({
    ACTIVE: 'preview-active',
    LOCAL_ARTIFACT_FLAG: 'preview-local-artifact-flag',
    LOCAL_MUTATION_FLAG: 'preview-local-mutation-flag',
    INACTIVE: 'preview-inactive',
});

function createRouteDecision(decision) {
    return Object.freeze({
        ...decision,
        classes: Object.freeze([...decision.classes]),
    });
}

export const LOCAL_API_ROUTE_DECISIONS = Object.freeze([
    createRouteDecision({
        method: 'GET',
        route: '/_pw/health',
        classes: [LOCAL_API_ROUTE_CLASS.TEST_HEALTH],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.ACTIVE,
        reason: 'Vite readiness probe only; no local artifact or mutation surface.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/editor/save-map-disk',
        classes: [LOCAL_API_ROUTE_CLASS.DISK_WRITE, LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Writes generated editor map artifacts.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/editor/save-vehicle-disk',
        classes: [LOCAL_API_ROUTE_CLASS.DISK_WRITE, LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Writes generated editor vehicle artifacts.',
    }),
    createRouteDecision({
        method: 'GET',
        route: '/api/editor/list-vehicles-disk',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.ACTIVE,
        reason: 'Bounded generated-vehicle index; no arbitrary path input or checkpoint payload.',
    }),
    createRouteDecision({
        method: 'GET',
        route: '/api/editor/get-vehicle-disk',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.ACTIVE,
        reason: 'Bounded generated-vehicle config read guarded by generated vehicle ids.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/editor/rename-vehicle-disk',
        classes: [LOCAL_API_ROUTE_CLASS.DISK_WRITE, LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Renames generated editor vehicle artifacts.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/editor/delete-vehicle-disk',
        classes: [LOCAL_API_ROUTE_CLASS.DISK_WRITE, LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Deletes generated editor vehicle artifacts.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/editor/save-video-disk',
        classes: [LOCAL_API_ROUTE_CLASS.DISK_WRITE, LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Writes recording video artifacts.',
    }),
    createRouteDecision({
        method: 'GET',
        route: '/api/bot/latest-checkpoint',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_ARTIFACT_FLAG,
        reason: 'Returns local training checkpoint payloads from data/training.',
    }),
    createRouteDecision({
        method: 'GET',
        route: '/api/training/status',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_ARTIFACT_FLAG,
        reason: 'Returns local run metadata, checkpoint paths and trainer stats.',
    }),
    createRouteDecision({
        method: 'GET',
        route: '/api/training/history',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_ARTIFACT_FLAG,
        reason: 'Lists local training run artifacts.',
    }),
    createRouteDecision({
        method: 'GET',
        route: '/api/training/progress',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_ARTIFACT_FLAG,
        reason: 'Returns live local training log lines.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/training/start',
        classes: [LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION, LOCAL_API_ROUTE_CLASS.PROCESS_CONTROL, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Spawns local training processes.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/training/stop',
        classes: [LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION, LOCAL_API_ROUTE_CLASS.PROCESS_CONTROL, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Stops local training processes.',
    }),
    createRouteDecision({
        method: 'POST',
        route: '/api/training/schedule',
        classes: [LOCAL_API_ROUTE_CLASS.DISK_WRITE, LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG,
        reason: 'Writes schedule config and controls local training process scheduling.',
    }),
    createRouteDecision({
        method: 'UPGRADE',
        route: '/ws/training',
        classes: [LOCAL_API_ROUTE_CLASS.ARTIFACT_READ, LOCAL_API_ROUTE_CLASS.TRAINING_PROCESS],
        previewAccess: LOCAL_API_PREVIEW_ACCESS.INACTIVE,
        reason: 'Preview server does not register the training websocket upgrade handler.',
    }),
]);

const LOCAL_API_ROUTE_DECISION_BY_KEY = new Map(LOCAL_API_ROUTE_DECISIONS.map((decision) => [
    createRouteKey(decision.method, decision.route),
    decision,
]));

function isEnabledEnvValue(value) {
    if (value === true) return true;
    if (value === 1) return true;
    return ENABLED_VALUES.has(String(value || '').trim().toLowerCase());
}

function normalizeRoutePath(route) {
    return String(route || '').split('?')[0];
}

function createRouteKey(method = 'GET', route = '') {
    return `${String(method || 'GET').toUpperCase()} ${normalizeRoutePath(route)}`;
}

export function isLocalMutationApiEnabled(env = process.env) {
    return isEnabledEnvValue(env?.[LOCAL_MUTATION_APIS_ENV]);
}

export function isLocalArtifactApiEnabled(env = process.env) {
    return isEnabledEnvValue(env?.[LOCAL_ARTIFACT_APIS_ENV]);
}

export function getLocalApiRouteDecision({ method = 'GET', route = '' } = {}) {
    return LOCAL_API_ROUTE_DECISION_BY_KEY.get(createRouteKey(method, route)) || null;
}

export function shouldBlockPreviewLocalMutation({ isPreviewServer = false, env = process.env } = {}) {
    return isPreviewServer === true && !isLocalMutationApiEnabled(env);
}

export function shouldBlockPreviewLocalArtifactRead({
    isPreviewServer = false,
    method = 'GET',
    route = '',
    env = process.env,
} = {}) {
    if (isPreviewServer !== true) return false;
    const decision = getLocalApiRouteDecision({ method, route });
    return decision?.previewAccess === LOCAL_API_PREVIEW_ACCESS.LOCAL_ARTIFACT_FLAG
        && !isLocalArtifactApiEnabled(env);
}

export function createPreviewLocalMutationDisabledPayload(extra = {}) {
    return {
        ok: false,
        error: PREVIEW_LOCAL_MUTATION_DISABLED_ERROR,
        ...extra,
    };
}

export function createPreviewLocalMutationDisabledResponse(extra = {}) {
    return {
        statusCode: 403,
        payload: createPreviewLocalMutationDisabledPayload(extra),
    };
}

export function createPreviewLocalArtifactDisabledPayload(extra = {}) {
    return {
        ok: false,
        error: PREVIEW_LOCAL_ARTIFACT_DISABLED_ERROR,
        ...extra,
    };
}

export function createPreviewLocalArtifactDisabledResponse(extra = {}) {
    return {
        statusCode: 403,
        payload: createPreviewLocalArtifactDisabledPayload(extra),
    };
}
