// Pure deterministic selection of up to three moments that made a run notable.
export const ARCADE_HIGHLIGHT_LIMIT = 3;
const KIND_ORDER = Object.freeze(['new_record', 'ghost_beaten', 'close_escape', 'multi_kill', 'combo_peak', 'missions_complete']);
const BURST_WINDOW_MS = 6000;
const ESCAPE_FOLLOW_MS = 10000;

function closeEscape(moments, completedSectors) {
    let best = null;
    for (let i = 0; i < moments.length; i += 1) {
        const low = moments[i];
        if (low.type !== 'low_hp' || low.sector > completedSectors) continue;
        let killsAfter = 0;
        for (let j = i + 1; j < moments.length && moments[j].tMs - low.tMs <= ESCAPE_FOLLOW_MS; j += 1) {
            if (moments[j].sector !== low.sector) break;
            if (moments[j].type === 'kill') killsAfter += 1;
        }
        const score = Math.min(85, 50 + (20 - low.b) * 1.5 + killsAfter * 5);
        if (!best || score > best.score) best = { kind: 'close_escape', sector: low.sector, tMs: low.tMs, score, metrics: { hpPct: low.b, killsAfter } };
    }
    return best;
}

function killBurst(moments) {
    const kills = moments.filter((entry) => entry.type === 'kill');
    let best = null;
    for (let i = 0, j = 0; i < kills.length; i += 1) {
        j = Math.max(j, i);
        while (j + 1 < kills.length
            && kills[j + 1].sector === kills[i].sector
            && kills[j + 1].tMs - kills[i].tMs <= BURST_WINDOW_MS) j += 1;
        const count = j - i + 1;
        if (count >= 3 && (!best || count > best.metrics.kills)) {
            best = {
                kind: 'multi_kill', sector: kills[i].sector, tMs: kills[i].tMs, score: Math.min(80, 30 + count * 10),
                metrics: { kills: count, seconds: Math.round((kills[j].tMs - kills[i].tMs) / 100) / 10 },
            };
        }
    }
    return best;
}

function comboPeak(moments) {
    let best = null;
    for (const entry of moments) {
        if (entry.type !== 'combo_tier_up' || entry.a < 3 || (best && entry.a <= best.metrics.multiplier)) continue;
        best = { kind: 'combo_peak', sector: entry.sector, tMs: entry.tMs, score: 10 + entry.a * 10, metrics: { multiplier: entry.a, combo: entry.b } };
    }
    return best;
}

export function selectArcadeRunHighlights(input = {}) {
    const moments = Array.isArray(input.moments) ? input.moments : [];
    const completedSectors = Math.max(0, Math.floor(Number(input.completedSectors) || 0));
    const score = Math.max(0, Math.round(Number(input.score) || 0));
    const previousBestScore = Math.max(0, Math.round(Number(input.previousBestScore) || 0));
    const missions = moments.find((entry) => entry.type === 'missions_all_complete');
    const candidates = [
        previousBestScore > 0 && score > previousBestScore
            ? { kind: 'new_record', sector: 0, tMs: 0, score: 100, metrics: { score, margin: score - previousBestScore } } : null,
        input.parcoursResult?.status === 'new_best' && input.parcoursResult?.previousGhostAvailable === true
            ? { kind: 'ghost_beaten', sector: 0, tMs: 0, score: 90, metrics: { seconds: Math.round((Number(input.parcoursResult.improvementMs) || 0) / 10) / 100 } } : null,
        closeEscape(moments, completedSectors),
        killBurst(moments),
        comboPeak(moments),
        missions ? { kind: 'missions_complete', sector: missions.sector, tMs: missions.tMs, score: 35, metrics: { sector: missions.sector } } : null,
    ].filter(Boolean);
    return candidates
        .sort((a, b) => b.score - a.score || a.tMs - b.tMs || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
        .slice(0, ARCADE_HIGHLIGHT_LIMIT);
}
