// The run result uses this bounded sidecar to name notable gameplay moments. It deliberately
// stays outside the cloned Arcade state and uses simulation time for deterministic ordering.
export const ARCADE_MOMENT_LOG_LIMIT = 512;
export const ARCADE_LOW_HP_RATIO = 0.2;

export function createArcadeMomentLog(runId = '') {
    return {
        runId: String(runId || ''),
        entries: [],
        lowHp: {},
        lowHpSector: -1,
        before: { multiplier: 1, objectiveCompleted: false, missionsAllCompleted: false },
    };
}

function ensureLog(runtime) {
    const runId = String(runtime?._state?.runId || '');
    if (!runtime._momentLog || runtime._momentLog.runId !== runId) runtime._momentLog = createArcadeMomentLog(runId);
    return runtime._momentLog;
}

function readFrame(runtime, frame) {
    frame.multiplier = Math.max(1, Math.round(Number(runtime._state?.score?.multiplier) || 1));
    frame.objectiveCompleted = runtime._state?.objectiveState?.completed === true;
    frame.missionsAllCompleted = runtime._missionState?.allCompleted === true;
    return frame;
}

export function beginArcadeMoment(runtime) {
    if (!runtime?._state) return;
    const log = ensureLog(runtime);
    const sector = Math.max(0, Math.floor(Number(runtime._state.sectorIndex) || 0));
    if (log.lowHpSector !== sector) {
        log.lowHp = {};
        log.lowHpSector = sector;
    }
    readFrame(runtime, log.before);
}

function push(log, tMs, sector, type, a = 0, b = 0) {
    if (log.entries.length >= ARCADE_MOMENT_LOG_LIMIT) log.entries.shift();
    log.entries.push({ tMs, sector, type, a, b });
}

export function recordArcadeMoments(runtime, event) {
    if (!runtime?._state || !event) return;
    const log = ensureLog(runtime);
    const tMs = Math.max(0, Number(runtime._state.gameplayTimeMs) || 0);
    const sector = Math.max(0, Math.floor(Number(runtime._state.sectorIndex) || 0));
    if (event.type === 'kill' && Number(event.count) > 0) {
        push(log, tMs, sector, 'kill', Number(event.victimIndex) || 0, event.companion === true ? 1 : 0);
    } else if (event.type === 'damage' || event.type === 'health_update') {
        const hp = Math.max(0, Number(event.hp) || 0);
        const ratio = hp / Math.max(1, Number(event.maxHp) || 1);
        const key = String(event.playerIndex ?? 0);
        const isLow = ratio < ARCADE_LOW_HP_RATIO;
        if (isLow && hp > 0 && log.lowHp[key] !== true) push(log, tMs, sector, 'low_hp', Number(key) || 0, Math.round(ratio * 100));
        log.lowHp[key] = isLow;
    }
    const before = log.before;
    const multiplier = Math.max(1, Math.round(Number(runtime._state.score?.multiplier) || 1));
    if (multiplier > before.multiplier) {
        push(log, tMs, sector, 'combo_tier_up', multiplier, Math.max(0, Math.floor(Number(runtime._state.score?.combo) || 0)));
    }
    if (!before.missionsAllCompleted && runtime._missionState?.allCompleted === true) push(log, tMs, sector, 'missions_all_complete');
    if (!before.objectiveCompleted && runtime._state.objectiveState?.completed === true) push(log, tMs, sector, 'objective_complete');
}

export function readArcadeMoments(runtime) {
    const log = runtime?._momentLog;
    if (!log || log.runId !== String(runtime?._state?.runId || '')) return [];
    return log.entries.map((entry) => ({ ...entry }));
}
