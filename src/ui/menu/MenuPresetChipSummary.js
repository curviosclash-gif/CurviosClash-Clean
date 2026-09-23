import { resolveMapPreview } from './MenuPreviewCatalog.js';

const GAME_MODE_TO_MODE_PATH = Object.freeze({ ARCADE: 'arcade', HUNT: 'fight', CLASSIC: 'normal' });

// A preset belongs to the play style its game mode starts; the start setup only offers those,
// so a chip can no longer switch the style (and the map) behind the player's back.
export function resolveMenuPresetModePath(preset) {
    const values = preset?.values || {};
    const explicitModePath = String(values['localSettings.modePath'] || '').trim().toLowerCase();
    if (explicitModePath) return explicitModePath;
    return GAME_MODE_TO_MODE_PATH[String(values.gameMode || '').trim().toUpperCase()] || '';
}

function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

// One line naming what a preset changes, shown on its chip before it is applied.
export function formatMenuPresetChangeSummary(values = {}, resolveMapName = (mapKey) => resolveMapPreview(mapKey)?.name || mapKey) {
    const parts = [];
    if (values.mapKey) parts.push(resolveMapName(values.mapKey));
    if (values.mode === '2p') parts.push('Geteilter Bildschirm');
    if (values.numBots !== undefined) {
        const bots = Math.max(0, Number(values.numBots) || 0);
        parts.push(bots === 0 ? 'Ohne Bots' : countLabel(bots, 'Bot', 'Bots'));
    }
    const isArcade = String(values.gameMode || '').toUpperCase() === 'ARCADE';
    if (values['hunt.respawnEnabled'] === true) {
        const killLimit = Number(values['hunt.deathmatchKillLimit']) || 0;
        const targetLabel = String(values['hunt.winCondition'] || '').toLowerCase() === 'score_target'
            ? 'Punkte'
            : 'Abschüsse';
        parts.push(killLimit > 0 ? `${killLimit} ${targetLabel}` : 'Deathmatch');
    } else if (!isArcade && Number(values.winsNeeded) > 0) {
        parts.push(countLabel(Number(values.winsNeeded), 'Sieg', 'Siege'));
    }
    if (values['gameplay.speed'] !== undefined) parts.push(`Tempo ${values['gameplay.speed']}`);
    return parts.join(' · ');
}
