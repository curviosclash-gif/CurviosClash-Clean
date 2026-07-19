import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMatchRenderProjection } from '../src/shared/runtime/MatchRenderProjectionBuilder.js';
import { buildMatchRuntimeProjection } from '../src/shared/runtime/MatchRuntimeProjectionBuilder.js';
import { TouchInputSource } from '../src/ui/TouchInputSource.js';

test('TouchInputSource reuses the playing-state projection before requesting a new snapshot', () => {
    const cachedProjection = { contractVersion: 'match-runtime-projection.v1', players: [] };
    let snapshotBuilds = 0;
    const source = new TouchInputSource({
        game: {
            playingStateSystem: {
                getMatchRuntimeProjection: () => cachedProjection,
            },
        },
        getMatchRuntimeProjection() {
            snapshotBuilds += 1;
            return { players: [] };
        },
    });

    assert.equal(source._getMatchRuntimeProjection(), cachedProjection);
    assert.equal(snapshotBuilds, 0);
});

test('TouchInputSource dispose is idempotent', () => {
    const source = new TouchInputSource();

    source.dispose();
    assert.doesNotThrow(() => source.dispose());
    assert.equal(source._disposed, true);
});

test('match projections resolve only needed config sections while preserving fallback precedence', () => {
    const player = {
        index: 0,
        alive: true,
        cameraMode: 0,
        position: { x: 1, y: 2, z: 3 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        entityRuntimeConfig: {
            PLAYER: { BOOST_DURATION: 9 },
            CAMERA: { MODES: ['CUSTOM_CAMERA'] },
            GAMEPLAY: { PLANAR_MODE: true },
        },
        getAimDirection(target) {
            return target.set(0, 0, -1);
        },
        getFirstPersonCameraAnchor(target) {
            return target.set(1, 2, 2);
        },
        view: {
            copyRenderTransform(position, quaternion) {
                position.set(1, 2, 3);
                quaternion.set(0, 0, 0, 1);
                return true;
            },
        },
    };
    const entityManager = { players: [player] };
    const args = {
        game: { entityManager, huntState: {} },
        runtimeState: {
            entityManager,
            config: { PLAYER: { BOOST_DURATION: 2 } },
        },
        facade: {
            session: { getPlayers: () => [] },
            isNetworkSession: () => false,
        },
        sessionRuntime: { lifecycle: { gameStateId: 'PLAYING' } },
    };

    const runtimePlayer = buildMatchRuntimeProjection(args).players[0];
    const renderPlayer = buildMatchRenderProjection(args).players[0];
    for (const projectedPlayer of [runtimePlayer, renderPlayer]) {
        assert.equal(projectedPlayer.boostCapacity, 2);
        assert.equal(projectedPlayer.cameraModeId, 'CUSTOM_CAMERA');
        assert.equal(projectedPlayer.planarMode, true);
    }
});

test('runtime projection reuses scoreboard rows when formatting the Hunt summary', () => {
    const rows = [{ playerIndex: 0, label: 'P1', kills: 2, deaths: 1, assists: 0 }];
    let scoreboardBuilds = 0;
    let summaryRows = null;
    const entityManager = {
        players: [],
        activeGameMode: 'HUNT',
        getHuntScoreboard() {
            scoreboardBuilds += 1;
            return rows;
        },
        getHuntScoreboardSummary(_maxEntries, passedRows) {
            summaryRows = passedRows;
            return 'P1 K2/T1/A0';
        },
    };

    const projection = buildMatchRuntimeProjection({
        game: { entityManager, huntState: {} },
        runtimeState: { entityManager, activeGameMode: 'HUNT' },
        facade: {
            session: { getPlayers: () => [] },
            isNetworkSession: () => false,
        },
        sessionRuntime: { lifecycle: { gameStateId: 'PLAYING' } },
    });

    assert.equal(scoreboardBuilds, 1);
    assert.equal(summaryRows, rows);
    assert.equal(projection.hunt.scoreboardSummary, 'P1 K2/T1/A0');
});
