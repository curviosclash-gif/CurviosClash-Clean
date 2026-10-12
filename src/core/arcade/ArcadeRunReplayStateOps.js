// Replay availability of the current Arcade run, moved out of ArcadeRunRuntime.getReplayState
// unchanged. `runtime` is the ArcadeRunRuntime.
export function resolveArcadeRunReplayState(runtime) {
    const replay = runtime._state?.replay && typeof runtime._state.replay === 'object'
        ? runtime._state.replay
        : {};
    const runReplayId = typeof replay.runReplayId === 'string' ? replay.runReplayId : '';
    const playbackEnabled = replay.playbackEnabled !== false;
    const snapshot = runtime._latestReplaySnapshot;
    const payloadAvailable = !!snapshot
        && typeof snapshot === 'object'
        && (
            (Array.isArray(snapshot.actions) && snapshot.actions.length >= 0)
            || (snapshot.initialState && typeof snapshot.initialState === 'object')
        );
    return {
        runReplayId,
        playbackEnabled,
        payloadAvailable,
        playbackAvailable: playbackEnabled && payloadAvailable,
        fallbackMode: playbackEnabled ? 'json_export_if_no_player' : 'disabled',
    };
}
