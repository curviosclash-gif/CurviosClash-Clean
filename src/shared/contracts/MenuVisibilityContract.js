export const MENU_VISIBILITY_CONTRACT_VERSION = 'menu-visibility.v1';

const SESSION_TYPES = Object.freeze(['single', 'splitscreen', 'multiplayer']);
const VARIANTS = Object.freeze(['ffa', 'team', 'flags', 'escort', 'classic']);
const LOBBY_ROLES = Object.freeze(['none', 'host', 'guest']);
const PLATFORMS = Object.freeze(['desktop', 'browser', 'mobile']);

export const MENU_VISIBILITY_KEYS = Object.freeze([
    'planarEntry',
    'arcadeJourney',
    'freePlay',
    'variantTeam',
    'variantFlags',
    'variantEscort',
    'deviceAssignment',
    'profileSlots',
    'ghostDuel',
    'lobbyLocalPlayers',
    'matchRulesEditable',
    'pauseRestart',
    'lobbyArcadeTab',
    'customMapsSelectable',
    'developerTools',
    'telemetryPanel',
    'tuningConsoleHint',
    'mobileControlsTab',
    'quitButton',
]);

export const MENU_VISIBILITY_REASONS = Object.freeze({
    THREE_PLAYERS_NO_TEAMS: 'three_players_no_teams',
    FOUR_PLAYERS_PLANAR_ONLY: 'four_players_planar_only',
    SPLITSCREEN_FOUR_ONLY: 'splitscreen_four_only',
    SPLITSCREEN_TWO_OR_THREE_ONLY: 'splitscreen_two_or_three_only',
    SINGLE_PLAYER_ONLY: 'single_player_only',
    HOST_ONLY: 'host_only',
    NOT_IN_LOBBY: 'not_in_lobby',
    COMING_SOON: 'coming_soon',
    CUSTOM_MAPS_LOCAL_ONLY: 'custom_maps_local_only',
    DEV_ONLY: 'dev_only',
    MOBILE_ONLY: 'mobile_only',
    DESKTOP_ONLY: 'desktop_only',
});

const R = MENU_VISIBILITY_REASONS;

function pick(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

/**
 * Pulls raw menu state into the closed set of values the resolver understands.
 * @param {*} raw
 */
export function normalizeMenuVisibilityContext(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const sessionType = pick(source.sessionType, SESSION_TYPES, 'single');
    let playerCount = 1;
    if (sessionType !== 'single') {
        const minimum = sessionType === 'splitscreen' ? 2 : 1;
        const parsed = Math.floor(Number(source.playerCount));
        playerCount = Number.isFinite(parsed) ? Math.min(4, Math.max(minimum, parsed)) : minimum;
    }
    return {
        sessionType,
        playerCount,
        variant: pick(source.variant, VARIANTS, 'ffa'),
        lobbyRole: sessionType === 'multiplayer' ? pick(source.lobbyRole, LOBBY_ROLES, 'none') : 'none',
        devEnvironment: source.devEnvironment === true,
        platform: pick(source.platform, PLATFORMS, 'desktop'),
    };
}

const HIDE = (reason) => ({ visible: false, reason });
const DISABLE = (reason) => ({ visible: true, reason });
const teamVariantRule = (c) =>
    c.sessionType === 'splitscreen' && c.playerCount === 3 ? DISABLE(R.THREE_PLAYERS_NO_TEAMS) : null;
const sharedScreenSlotsRule = (c) =>
    c.sessionType === 'splitscreen' && c.playerCount >= 2 && c.playerCount <= 3
        ? null
        : HIDE(R.SPLITSCREEN_TWO_OR_THREE_ONLY);
// Four players exist only on the shared screen as planar flight; network lobbies of four play normally.
const isSharedScreenOfFour = (c) => c.sessionType === 'splitscreen' && c.playerCount === 4;
const fourPlayerRule = (c) => (isSharedScreenOfFour(c) ? HIDE(R.FOUR_PLAYERS_PLANAR_ONLY) : null);
const planarEntryRule = (c) => (isSharedScreenOfFour(c) ? null : HIDE(R.SPLITSCREEN_FOUR_ONLY));
const devRule = (c) => (c.devEnvironment ? null : HIDE(R.DEV_ONLY));

// A rule returns null (visible and enabled) or { visible, reason }.
const RULES = Object.freeze({
    planarEntry: planarEntryRule,
    arcadeJourney: fourPlayerRule,
    freePlay: fourPlayerRule,
    variantTeam: teamVariantRule,
    variantFlags: teamVariantRule,
    variantEscort: teamVariantRule,
    deviceAssignment: sharedScreenSlotsRule,
    profileSlots: sharedScreenSlotsRule,
    ghostDuel: (c) => (c.sessionType === 'single' ? null : HIDE(R.SINGLE_PLAYER_ONLY)),
    lobbyLocalPlayers: (c) => (c.lobbyRole === 'host' ? null : HIDE(R.HOST_ONLY)),
    // Guests see the rules read-only; the pause restart is hidden for them.
    matchRulesEditable: (c) => (c.lobbyRole === 'guest' ? DISABLE(R.HOST_ONLY) : null),
    pauseRestart: (c) => (c.lobbyRole === 'guest' ? HIDE(R.HOST_ONLY) : null),
    lobbyArcadeTab: (c) => (c.lobbyRole === 'none' ? HIDE(R.NOT_IN_LOBBY) : DISABLE(R.COMING_SOON)),
    customMapsSelectable: (c) => (c.sessionType === 'multiplayer' ? DISABLE(R.CUSTOM_MAPS_LOCAL_ONLY) : null),
    developerTools: devRule,
    telemetryPanel: devRule,
    tuningConsoleHint: devRule,
    mobileControlsTab: (c) => (c.platform === 'mobile' ? null : HIDE(R.MOBILE_ONLY)),
    quitButton: (c) => (c.platform === 'desktop' ? null : HIDE(R.DESKTOP_ONLY)),
});

/**
 * The single place that decides which menu elements are visible and enabled.
 * Reasons are codes, never texts.
 * @param {*} rawContext
 */
export function resolveMenuVisibility(rawContext) {
    const context = normalizeMenuVisibilityContext(rawContext);
    const visible = {};
    const enabled = {};
    const reasons = {};
    for (const key of MENU_VISIBILITY_KEYS) {
        const verdict = RULES[key](context);
        visible[key] = verdict ? verdict.visible : true;
        enabled[key] = !verdict;
        if (verdict) reasons[key] = verdict.reason;
    }
    return Object.freeze({
        visible: Object.freeze(visible),
        enabled: Object.freeze(enabled),
        reasons: Object.freeze(reasons),
    });
}
