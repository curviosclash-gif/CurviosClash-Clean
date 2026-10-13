/**
 * Menu funnel contract: the vocabulary and the path counter used to measure how
 * many interactions a player needs from opening the menu to the match start.
 * Time is injected, so this module stays deterministic and testable.
 */

export const MENU_FUNNEL_CONTRACT_VERSION = 1;

export const MENU_FUNNEL_EVENTS = Object.freeze([
    'continue_pressed',
    'first_flight_pressed',
    'session_selected',
    'hub_opened',
    'freeplay_opened',
    'stage_selected',
    'stage_started',
    'freeplay_started',
    'lobby_create',
    'lobby_join',
    'settings_opened',
    'back_pressed',
    'match_started',
    'menu_aborted',
]);

export const MENU_FUNNEL_ABORT_REASONS = Object.freeze([
    'back_to_start',
    'quit',
    'lobby_left',
    'start_failed',
    'unknown',
]);

/** Upper bound for stored path entries, so a long menu session cannot grow without limit. */
export const MENU_FUNNEL_PATH_MAX_LENGTH = 32;

/** Clicks stop counting here; further interactions add no information. */
export const MENU_FUNNEL_MAX_CLICKS = 999;

export const MENU_FUNNEL_CLICK_BUCKETS = Object.freeze([
    Object.freeze({ id: '1-2', max: 2 }),
    Object.freeze({ id: '3-4', max: 4 }),
    Object.freeze({ id: '5-6', max: 6 }),
    Object.freeze({ id: '7-9', max: 9 }),
    Object.freeze({ id: '10+', max: Infinity }),
]);

const EVENT_SET = new Set(MENU_FUNNEL_EVENTS);
const ABORT_REASON_SET = new Set(MENU_FUNNEL_ABORT_REASONS);
const TERMINAL_EVENTS = new Set(['match_started', 'menu_aborted']);

/**
 * Returns `{ type, reason? }` for a known event, or null for anything else.
 * `reason` is only kept for `menu_aborted` and falls back to `unknown`.
 */
export function normalizeMenuFunnelEvent(raw) {
    const rawType = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.type : null;
    const type = typeof rawType === 'string' ? rawType.trim() : '';
    if (!EVENT_SET.has(type)) return null;
    if (type !== 'menu_aborted') return { type };
    const reason = typeof raw?.reason === 'string' ? raw.reason.trim() : '';
    return { type, reason: ABORT_REASON_SET.has(reason) ? reason : 'unknown' };
}

export function getMenuFunnelClickBucket(clicks) {
    const value = Number(clicks);
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    return MENU_FUNNEL_CLICK_BUCKETS.find((bucket) => safe <= bucket.max).id;
}

function readClock(now) {
    if (typeof now !== 'function') return 0;
    const value = Number(now());
    return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Counts menu interactions from the moment the menu opens until a terminal event
 * (`match_started` or `menu_aborted`). Terminal events do not count as clicks.
 * After a terminal event the path stays closed until `reset()`.
 */
export function createMenuFunnelPath({ now } = {}) {
    let startedAt = readClock(now);
    let clicks = 0;
    let steps = [];
    let closed = null;

    function durationNow() {
        const duration = readClock(now) - startedAt;
        return Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0;
    }

    function build() {
        return { clicks, durationMs: durationNow(), path: steps.slice() };
    }

    return {
        record(raw) {
            if (closed) return null;
            const event = normalizeMenuFunnelEvent(raw);
            if (!event) return null;
            if (TERMINAL_EVENTS.has(event.type)) {
                // A full path gives up its last step so the terminal event always fits.
                if (steps.length >= MENU_FUNNEL_PATH_MAX_LENGTH) steps.pop();
                steps.push(event.type);
                closed = build();
                return { ...closed, path: closed.path.slice() };
            }
            clicks = Math.min(MENU_FUNNEL_MAX_CLICKS, clicks + 1);
            if (steps.length < MENU_FUNNEL_PATH_MAX_LENGTH) steps.push(event.type);
            return null;
        },
        snapshot() {
            return closed ? { ...closed, path: closed.path.slice() } : build();
        },
        reset() {
            startedAt = readClock(now);
            clicks = 0;
            steps = [];
            closed = null;
        },
    };
}
