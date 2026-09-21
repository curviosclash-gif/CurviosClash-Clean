export const CLASSIC_TUTORIAL_CONTRACT_VERSION = 'classic-tutorial.v1';
export const CLASSIC_TUTORIAL_ROUTE_ID = 'classic_tutorial_v1';

export const CLASSIC_TUTORIAL_HINTS = Object.freeze([
    'Fliege durch den Start-Ring.',
    'Lenke ruhig nach links und rechts und folge den Ringen.',
    'Nutze Beschleunigen und Bremsen, um die Kurve sauber zu treffen.',
    'Aktiviere den Boost und halte die Flugrichtung stabil.',
    'Weiche den Hindernissen aus und achte auf deinen Trail.',
    'Sammle das Power-up ein und fliege zum Ziel.',
]);

export function isClassicTutorialRoute(routeId) {
    return String(routeId || '').trim().toLowerCase() === CLASSIC_TUTORIAL_ROUTE_ID;
}

export function resolveClassicTutorialHint(currentCheckpoint, completed = false) {
    if (completed) return 'Tutorial abgeschlossen – Classic ist bereit.';
    const index = Math.max(0, Math.min(CLASSIC_TUTORIAL_HINTS.length - 1, Math.trunc(Number(currentCheckpoint) || 0)));
    return CLASSIC_TUTORIAL_HINTS[index];
}

export function createCompletedClassicTutorialState(previous = null, nowMs = Date.now()) {
    const source = previous && typeof previous === 'object' ? previous : {};
    return Object.freeze({
        ...source,
        schemaVersion: CLASSIC_TUTORIAL_CONTRACT_VERSION,
        completed: true,
        completedAtMs: Math.max(0, Number(nowMs) || Date.now()),
    });
}

export function normalizeClassicTutorialState(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const completed = source.completed === true;
    const timestamp = Number(source.completedAtMs);
    return {
        schemaVersion: CLASSIC_TUTORIAL_CONTRACT_VERSION,
        completed,
        completedAtMs: completed && Number.isFinite(timestamp) ? Math.max(0, Math.trunc(timestamp)) : 0,
    };
}
