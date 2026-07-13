export const MATCH_LIFECYCLE_CONTRACT_VERSION = 'lifecycle.v1';

export const MATCH_LIFECYCLE_EVENT_TYPES = Object.freeze({
    MATCH_STARTED: 'match_started',
    MATCH_ENDED: 'match_ended',
    MENU_OPENED: 'menu_opened',
    RECORDING_REQUESTED: 'recording_requested',
});

export const SESSION_FINALIZE_TRIGGERS = Object.freeze({
    RETURN_TO_MENU: 'return_to_menu',
    NEW_MATCH_SESSION: 'new_match_session',
    SESSION_TEARDOWN: 'session_teardown',
    GAME_DISPOSE: 'game_dispose',
    WINDOW_SHUTDOWN: 'window_shutdown',
    STALE_SESSION_INIT: 'stale_session_init',
    APPLY_FAILED: 'apply_failed',
    ROUND_FINALIZE: 'round_finalize',
});
