import { normalizeString } from './ContractNormalizeUtils.js';

const VALID_MODE_PATHS = new Set(['normal', 'arcade', 'fight']);
const VALID_GAME_MODES = new Set(['CLASSIC', 'HUNT', 'ARCADE']);
const VALID_BOT_ROLES = new Set(['guard', 'flanker', 'pursuer', 'interceptor']);
const VALID_TURRET_WEAPONS = new Set(['mg', 'rocket']);
const VALID_TURRET_ROCKETS = new Set(['ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY']);

export function resolveMapSinglePlayerScenario(mapDefinition = null) {
    const source = mapDefinition?.singlePlayerScenario;
    if (!source || typeof source !== 'object' || source.enabled !== true) {
        return null;
    }

    const modePathCandidate = normalizeString(source.modePath, 'fight').toLowerCase();
    const gameModeCandidate = normalizeString(source.gameMode, 'HUNT').toUpperCase();
    const minBots = Math.max(0, Math.min(12, Math.trunc(Number(source.minBots) || 0)));
    const requestedBotCount = Number(source.botCount);
    const botCount = Number.isFinite(requestedBotCount)
        ? Math.max(0, Math.min(12, Math.trunc(requestedBotCount)))
        : null;
    const botRoles = Array.isArray(source.botRoles)
        ? source.botRoles
            .map((entry) => normalizeString(entry, '').toLowerCase())
            .filter((entry) => VALID_BOT_ROLES.has(entry))
        : [];

    const scenario = {
        id: normalizeString(source.id, 'single-player-scenario'),
        modePath: VALID_MODE_PATHS.has(modePathCandidate) ? modePathCandidate : 'fight',
        gameMode: VALID_GAME_MODES.has(gameModeCandidate) ? gameModeCandidate : 'HUNT',
        minBots,
        botRoles: Object.freeze(botRoles),
    };
    if (botCount !== null) scenario.botCount = botCount;
    return Object.freeze(scenario);
}

function normalizePosition(source) {
    const raw = Array.isArray(source?.pos)
        ? source.pos
        : [source?.x, source?.y, source?.z];
    return Object.freeze([
        Number(raw?.[0]) || 0,
        Number(raw?.[1]) || 0,
        Number(raw?.[2]) || 0,
    ]);
}

export function resolveMapStaticTurretDefinitions(mapDefinition = null) {
    const source = Array.isArray(mapDefinition?.staticTurrets) ? mapDefinition.staticTurrets : [];
    return Object.freeze(source.map((entry, index) => {
        const weaponCandidate = normalizeString(entry?.weapon, 'mg').toLowerCase();
        const weapon = VALID_TURRET_WEAPONS.has(weaponCandidate) ? weaponCandidate : 'mg';
        const rocketCandidate = normalizeString(entry?.rocketType, 'ROCKET_WEAK').toUpperCase();
        return Object.freeze({
            id: normalizeString(entry?.id, `turret_${index + 1}`),
            weapon,
            pos: normalizePosition(entry),
            range: Math.max(8, Math.min(180, Number(entry?.range) || (weapon === 'rocket' ? 90 : 64))),
            cooldown: Math.max(0.2, Math.min(12, Number(entry?.cooldown) || (weapon === 'rocket' ? 3.4 : 0.8))),
            damage: Math.max(1, Math.min(40, Number(entry?.damage) || 4)),
            phase: Math.max(0, Number(entry?.phase) || 0),
            rocketType: VALID_TURRET_ROCKETS.has(rocketCandidate) ? rocketCandidate : 'ROCKET_WEAK',
        });
    }));
}

export default {
    resolveMapSinglePlayerScenario,
    resolveMapStaticTurretDefinitions,
};
