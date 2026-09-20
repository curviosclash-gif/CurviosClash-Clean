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

function finiteNumber(value, fallback, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeStaticTurretDefinition(entry, index = 0, { spatialScale = 1, preserveSpatialRange = false } = {}) {
    const weaponCandidate = normalizeString(entry?.weapon, 'mg').toLowerCase();
    const weapon = VALID_TURRET_WEAPONS.has(weaponCandidate) ? weaponCandidate : 'mg';
    const rocketCandidate = normalizeString(entry?.rocketType, 'ROCKET_WEAK').toUpperCase();
    const pos = Array.isArray(entry?.pos) ? entry.pos : [entry?.x, entry?.y, entry?.z];
    const modes = Array.isArray(entry?.allowedModes)
        ? [...new Set(entry.allowedModes.filter((mode) => mode === 'HUNT' || mode === 'ARCADE'))]
        : ['HUNT'];
    const definition = {
        id: normalizeString(entry?.id, `turret_${index + 1}`),
        weapon,
        pos: Object.freeze([0, 1, 2].map((axis) => finiteNumber(pos[axis], 0))),
        range: finiteNumber(entry?.range, (weapon === 'rocket' ? 90 : 64) * spatialScale, preserveSpatialRange ? 0.001 : 8 * spatialScale, preserveSpatialRange ? 1000000 : 180 * spatialScale),
        cooldown: finiteNumber(entry?.cooldown, weapon === 'rocket' ? 3.4 : 0.8, 0.2, 12),
        damage: finiteNumber(entry?.damage, 4, 1, 40),
        phase: finiteNumber(entry?.phase, 0, 0),
        rocketType: VALID_TURRET_ROCKETS.has(rocketCandidate) ? rocketCandidate : 'ROCKET_WEAK',
        destructible: entry?.destructible === true,
        maxHp: finiteNumber(entry?.maxHp, 90, 1, 500),
        // Seconds until a destroyed emplacement stands there again. 0 - the fallback for a missing
        // or unusable value - keeps the old promise: destroyed is destroyed.
        respawnSeconds: finiteNumber(entry?.respawnSeconds, 0, 0, 3600),
        targetPlayers: entry?.targetPlayers === 'all' ? 'all' : 'humans',
        targetTrails: entry?.targetTrails === true,
        allowedModes: Object.freeze(modes),
    };
    const secretRoomId = normalizeString(entry?.secretRoomId, '').trim().slice(0, 80);
    if (secretRoomId) definition.secretRoomId = secretRoomId;
    return Object.freeze(definition);
}

export function resolveMapStaticTurretDefinitions(mapDefinition = null, options = {}) {
    const source = Array.isArray(mapDefinition?.staticTurrets) ? mapDefinition.staticTurrets : [];
    if (source.length > 512) throw new Error('Map collection "staticTurrets" exceeds the limit of 512.');
    const ids = new Set();
    return Object.freeze(source.map((entry, index) => {
        const definition = normalizeStaticTurretDefinition(entry, index, options);
        if (ids.has(definition.id)) throw new Error(`Duplicate static turret id: ${definition.id}`);
        ids.add(definition.id);
        return definition;
    }));
}

export default {
    resolveMapSinglePlayerScenario,
    resolveMapStaticTurretDefinitions,
};
