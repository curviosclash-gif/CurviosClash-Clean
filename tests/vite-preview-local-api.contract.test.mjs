import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LOCAL_API_PREVIEW_ACCESS,
    LOCAL_API_ROUTE_CLASS,
    LOCAL_API_ROUTE_DECISIONS,
    LOCAL_ARTIFACT_APIS_ENV,
    LOCAL_MUTATION_APIS_ENV,
    PREVIEW_LOCAL_ARTIFACT_DISABLED_ERROR,
    PREVIEW_LOCAL_MUTATION_DISABLED_ERROR,
    createPreviewLocalArtifactDisabledResponse,
    createPreviewLocalMutationDisabledResponse,
    getLocalApiRouteDecision,
    isLocalArtifactApiEnabled,
    isLocalMutationApiEnabled,
    shouldBlockPreviewLocalArtifactRead,
    shouldBlockPreviewLocalMutation,
} from '../dev/vite/previewLocalApiGuard.js';
import { EDITOR_API_ROUTES } from '../src/shared/contracts/EditorPathContract.js';

test('preview local mutation APIs are disabled by default', () => {
    assert.equal(isLocalMutationApiEnabled({}), false);
    assert.equal(shouldBlockPreviewLocalMutation({ isPreviewServer: true, env: {} }), true);
});

test('preview local mutation APIs accept explicit opt-in values', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) {
        assert.equal(isLocalMutationApiEnabled({ [LOCAL_MUTATION_APIS_ENV]: value }), true);
        assert.equal(shouldBlockPreviewLocalMutation({
            isPreviewServer: true,
            env: { [LOCAL_MUTATION_APIS_ENV]: value },
        }), false);
    }
});

test('dev server local mutation APIs are not blocked by preview guard', () => {
    assert.equal(shouldBlockPreviewLocalMutation({ isPreviewServer: false, env: {} }), false);
});

test('preview local mutation disabled response is stable', () => {
    assert.deepEqual(createPreviewLocalMutationDisabledResponse({ route: '/api/example' }), {
        statusCode: 403,
        payload: {
            ok: false,
            error: PREVIEW_LOCAL_MUTATION_DISABLED_ERROR,
            route: '/api/example',
        },
    });
});

test('preview route matrix covers local API classes and route contracts', () => {
    assert.ok(LOCAL_API_ROUTE_DECISIONS.length >= 16);

    const health = getLocalApiRouteDecision({ method: 'GET', route: '/_pw/health' });
    assert.equal(health.previewAccess, LOCAL_API_PREVIEW_ACCESS.ACTIVE);
    assert.deepEqual(health.classes, [LOCAL_API_ROUTE_CLASS.TEST_HEALTH]);

    for (const route of [EDITOR_API_ROUTES.LIST_VEHICLES_DISK, EDITOR_API_ROUTES.GET_VEHICLE_DISK]) {
        const decision = getLocalApiRouteDecision({ method: 'GET', route });
        assert.equal(decision.previewAccess, LOCAL_API_PREVIEW_ACCESS.ACTIVE);
        assert.ok(decision.classes.includes(LOCAL_API_ROUTE_CLASS.ARTIFACT_READ));
    }

    for (const route of [
        EDITOR_API_ROUTES.SAVE_MAP_DISK,
        EDITOR_API_ROUTES.SAVE_VEHICLE_DISK,
        EDITOR_API_ROUTES.RENAME_VEHICLE_DISK,
        EDITOR_API_ROUTES.DELETE_VEHICLE_DISK,
        EDITOR_API_ROUTES.SAVE_VIDEO_DISK,
        '/api/training/start',
        '/api/training/stop',
        '/api/training/schedule',
    ]) {
        const decision = getLocalApiRouteDecision({ method: 'POST', route });
        assert.equal(decision.previewAccess, LOCAL_API_PREVIEW_ACCESS.LOCAL_MUTATION_FLAG);
        assert.ok(decision.classes.includes(LOCAL_API_ROUTE_CLASS.LOCAL_MUTATION));
    }

    for (const route of [
        '/api/bot/latest-checkpoint',
        '/api/training/status',
        '/api/training/history',
        '/api/training/progress',
    ]) {
        const decision = getLocalApiRouteDecision({ method: 'GET', route });
        assert.equal(decision.previewAccess, LOCAL_API_PREVIEW_ACCESS.LOCAL_ARTIFACT_FLAG);
        assert.ok(decision.classes.includes(LOCAL_API_ROUTE_CLASS.ARTIFACT_READ));
    }

    assert.equal(
        getLocalApiRouteDecision({ method: 'UPGRADE', route: '/ws/training' }).previewAccess,
        LOCAL_API_PREVIEW_ACCESS.INACTIVE,
    );
});

test('preview local artifact read APIs require explicit opt-in', () => {
    assert.equal(isLocalArtifactApiEnabled({}), false);
    assert.equal(shouldBlockPreviewLocalArtifactRead({
        isPreviewServer: true,
        method: 'GET',
        route: '/api/bot/latest-checkpoint',
        env: {},
    }), true);

    assert.equal(shouldBlockPreviewLocalArtifactRead({
        isPreviewServer: false,
        method: 'GET',
        route: '/api/bot/latest-checkpoint',
        env: {},
    }), false);

    assert.equal(shouldBlockPreviewLocalArtifactRead({
        isPreviewServer: true,
        method: 'GET',
        route: '/api/bot/latest-checkpoint',
        env: { [LOCAL_ARTIFACT_APIS_ENV]: '1' },
    }), false);

    assert.equal(shouldBlockPreviewLocalArtifactRead({
        isPreviewServer: true,
        method: 'GET',
        route: EDITOR_API_ROUTES.GET_VEHICLE_DISK,
        env: {},
    }), false);
});

test('preview local artifact disabled response is stable', () => {
    assert.deepEqual(createPreviewLocalArtifactDisabledResponse({ route: '/api/bot/latest-checkpoint' }), {
        statusCode: 403,
        payload: {
            ok: false,
            error: PREVIEW_LOCAL_ARTIFACT_DISABLED_ERROR,
            route: '/api/bot/latest-checkpoint',
        },
    });
});
