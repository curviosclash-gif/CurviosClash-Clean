import { ARCADE_FACTORY_VEHICLE_IDS } from './ArcadeVehicleBalanceContract.js';
import { normalizeVehicleLabConfig } from './VehicleLabConfigContract.js';
import { buildArcadeHitboxShape, ARCADE_HITBOX_MAX_BOXES } from './ArcadeVehicleHitboxContract.js';
import { ARCADE_PART_SIZE_GROUPS } from './ArcadeVehicleSizeContract.js';
import { resolveArcadePartCostBasis } from './ArcadeBlueprintContract.js';
import { getPlayerShipPartConfig, listPlayerShipPartDonors } from '../vehicle-lab/player-ships/index.js';
import { measureArcadeLabHullVolume } from './ArcadeHullVolumeContract.js';
export { measureArcadeLabHullVolume } from './ArcadeHullVolumeContract.js';

export const ARCADE_LAB_STORAGE_KEY = 'cuviosclash.arcade-lab.v1';
export const ARCADE_LAB_SCHEMA_VERSION = 'arcade-lab.v1';
export const ARCADE_LAB_ID_PREFIX = 'arcade_lab_';
export const ARCADE_LAB_UNLOCK_COUNT = Math.ceil(ARCADE_FACTORY_VEHICLE_IDS.length * 0.75);

export const ARCADE_LAB_BUDGET = Object.freeze({ cost: 100, mass: 90, energy: 96, heat: 88, parts: 48 });
const MAX_SHIPS = 24;
const MAX_TOP_LEVEL_PARTS = 24;
// Worst-case Arcade motion: 256 samples, 0.25 core anchor, min plane scale 0.6,
// 28.395 u travelled and 0.9276439986 rad turned per step (includes altitude bonus).
export const ARCADE_LAB_MAX_SWEEP_RADIUS = Math.floor(((256 * 0.25 * 0.6 - 28.395) / (0.927643998637108 * 0.6)) * 100) / 100;

export const ARCADE_LAB_REFERENCE_VOLUMES = Object.freeze(Object.fromEntries(
    ['arrow', 'ship5', 'spaceship'].map((id) => [id, measureArcadeLabHullVolume(getPlayerShipPartConfig(id).parts)])
));

export const ARCADE_LAB_MIN_HULL_VOLUME = Math.min(...listPlayerShipPartDonors().filter(d => ['arrow','drone','ship1','ship9','lab_helix_interceptor'].includes(d.id)).map(d => measureArcadeLabHullVolume(d.parts)));

export function createArcadeLabFactoryCopy(vehicleId) {
    const donor = listPlayerShipPartDonors().find(d => d.id === vehicleId && ARCADE_FACTORY_VEHICLE_IDS.includes(d.id));
    return donor ? { label: `${donor.label} Kopie`, parts: structuredClone(donor.parts) } : null;
}

// Factory role labels do not determine Lab roles: an exact factory copy follows its volume.
// The sorted factory substance references give proportional, monotone comparison regions.
const [LOW_VOLUME, MID_VOLUME, HIGH_VOLUME] = Object.values(ARCADE_LAB_REFERENCE_VOLUMES).sort((a, b) => a - b);
const FIGHTER_CEILING = Math.sqrt(LOW_VOLUME * MID_VOLUME);
const TANK_FLOOR = Math.sqrt(MID_VOLUME * HIGH_VOLUME);

export function resolveArcadeLabRole(parts) {
    const volume = measureArcadeLabHullVolume(parts);
    return volume < FIGHTER_CEILING ? 'fighter' : volume >= TANK_FLOOR ? 'tank' : 'allrounder';
}

export function countArcadeLabUnlockShips(profiles) {
    const records = profiles && typeof profiles === 'object' ? profiles : {};
    return ARCADE_FACTORY_VEHICLE_IDS.filter((id) => {
        const profile = records[id];
        return profile?.sizeWorkshopUnlocked === true
            && ARCADE_PART_SIZE_GROUPS.every((group) => profile?.partSizes?.[group] === 125);
    }).length;
}

export function isArcadeLabUnlocked(record, profiles) {
    return record?.unlocked === true || countArcadeLabUnlockShips(profiles) >= ARCADE_LAB_UNLOCK_COUNT;
}

export function readArcadeLabRecord(raw) {
    if (raw == null) return { schemaVersion: ARCADE_LAB_SCHEMA_VERSION, unlocked: false, nextSerial: 1, ships: [] };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== ARCADE_LAB_SCHEMA_VERSION || !Array.isArray(raw.ships)) return null;
    // Keep invalid entries intact in storage; they remain visible for repair, but cannot deploy.
    const highestId = raw.ships.reduce((max, ship) => Math.max(max, Number(String(ship?.id || '').match(/^arcade_lab_([1-9][0-9]*)$/)?.[1]) || 0), 0);
    return { ...raw, unlocked: raw.unlocked === true,
        nextSerial: Math.max(1, Math.floor(Number(raw.nextSerial) || 1), highestId + 1), ships: raw.ships.slice() };
}

export function validateArcadeLabShip(entry) {
    const errors = [];
    if (!/^arcade_lab_[1-9][0-9]*$/.test(String(entry?.id || ''))) errors.push('Ungültige Arcade-Lab-ID.');
    const normalized = normalizeVehicleLabConfig(entry?.config, { requireParts: true });
    if (!normalized.ok) errors.push(...normalized.errors);
    const config = normalized.config ? {
        label: normalized.config.label,
        parts: normalized.config.parts.map(cleanPart),
    } : null;
    if (config) {
        if (config.baseVehicleId && config.baseMeshMode !== 'reference') errors.push('Ein Grundmodell darf nur Referenz sein.');
        const shape = buildArcadeHitboxShape(config.parts, null);
        const partCount = countParts(config.parts);
        if (config.parts.length > MAX_TOP_LEVEL_PARTS) errors.push(`Höchstens ${MAX_TOP_LEVEL_PARTS} oberste Bauteile erlaubt.`);
        if (partCount > ARCADE_LAB_BUDGET.parts) errors.push('Bauteilbudget überschritten.');
        if (shape.count > ARCADE_HITBOX_MAX_BOXES) errors.push('Kollisionsboxen überschritten.');
        const roles = new Map();
        const seenNames = new Set();
        const inspect = (parts, child = false) => parts.forEach((part) => {
            if (seenNames.has(part.name)) errors.push(`Bauteilname ${part.name} doppelt.`);
            seenNames.add(part.name);
            if (part.role && child) errors.push(`Rolle ${part.role} nur oben erlaubt.`);
            if (part.role) roles.set(part.role, (roles.get(part.role) || 0) + 1);
            if (['flame', 'forcefield'].includes(part.geo) && (!child || part.children?.length)) errors.push('Effektteile nur als Kinder ohne Unterteile erlaubt.');
            if (part.children) inspect(part.children, true);
        });
        inspect(config.parts);
        for (const role of ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right']) {
            if (!roles.has(role)) errors.push(`Bauteilrolle ${role} fehlt.`);
            if ((roles.get(role) || 0) > 1) errors.push(`Bauteilrolle ${role} doppelt.`);
        }
        if ((roles.get('utility') || 0) > 1) errors.push('Utility-Rolle doppelt.');
        const usage = evaluateArcadeLabBudgets(config);
        if (usage.parts > ARCADE_LAB_BUDGET.parts) errors.push('Bauteilbudget einschließlich Spiegelungen überschritten.');
        if (measureArcadeLabHullVolume(config.parts) + 1e-6 < ARCADE_LAB_MIN_HULL_VOLUME) errors.push('Rumpf kleiner als der kleinste Werksjäger.');
        for (const key of ['cost', 'mass', 'energy', 'heat']) if (usage[key] > ARCADE_LAB_BUDGET[key] + 1e-6) errors.push(`${key} überschritten.`);
        const sweep = buildArcadeHitboxShape(config.parts, Object.fromEntries(ARCADE_PART_SIZE_GROUPS.map((group) => [group, 125])));
        if (sweep.boundRadius > ARCADE_LAB_MAX_SWEEP_RADIUS) errors.push('Kollisionsform bei 125 % zu groß.');
        if (shape.count === 0) errors.push('Keine Kollisionsform vorhanden.');
    }
    return { ok: errors.length === 0, errors, config, role: config ? resolveArcadeLabRole(config.parts) : null, usage: config ? evaluateArcadeLabBudgets(config) : null };
}

function cleanPart(part) {
    const allowed = ['name', 'geo', 'size', 'pos', 'rot', 'scale', 'material', 'role', 'mirrorAxis', 'color', 'opacity', 'emissive', 'emissiveIntensity', 'anim'];
    const cleaned = Object.fromEntries(allowed.filter((key) => part[key] !== undefined).map((key) => [key, part[key]]));
    if (part.children?.length) cleaned.children = part.children.map(cleanPart);
    return cleaned;
}

export function evaluateArcadeLabBudgets(config) {
    const usage = { cost: 10, mass: 0, energy: 0, heat: 0, parts: 0 };
    const visit = (parts, parentScale = [1, 1, 1], inheritedCopies = 1) => (parts || []).forEach((part) => {
        const scale = [0, 1, 2].map((axis) => parentScale[axis] * (Number(part.scale?.[axis]) || 1));
        const { rates, size } = resolveArcadePartCostBasis(part);
        const factor = Math.max(0.5, size.x * size.y * size.z * scale[0] * scale[1] * scale[2] / 2.8);
        const copies = inheritedCopies * (part.mirrorAxis || part.mirror === true ? 2 : 1);
        usage.cost += rates.budget * factor * copies;
        usage.mass += rates.mass * factor * copies;
        usage.energy += rates.power * factor * copies;
        usage.heat += rates.heat * factor * copies;
        usage.parts += copies;
        visit(part.children, scale, copies);
    });
    visit(config.parts);
    return usage;
}

export function createArcadeLabStarterConfig(role = 'fighter') {
    const base = [
        { name: 'Rumpf', role: 'core', size: [1, 0.5, 2], pos: [0, 0, 0] },
        { name: 'Nase', role: 'nose', size: [0.45, 0.35, 0.8], pos: [0, 0, 1.2] },
        { name: 'Flügel links', role: 'wing_left', size: [0.8, 0.12, 1], pos: [-0.85, 0, 0] },
        { name: 'Flügel rechts', role: 'wing_right', size: [0.8, 0.12, 1], pos: [0.85, 0, 0] },
        { name: 'Antrieb links', role: 'engine_left', size: [0.3, 0.3, 0.6], pos: [-0.35, 0, -1.1] },
        { name: 'Antrieb rechts', role: 'engine_right', size: [0.3, 0.3, 0.6], pos: [0.35, 0, -1.1] },
    ];
    const scale = role === 'tank' ? 1.8 : role === 'allrounder' ? 1.3 : 1.03;
    return { label: role === 'tank' ? 'Bollwerk' : role === 'allrounder' ? 'Kreuzer' : 'Jäger',
        parts: base.map((part) => ({ ...part, geo: 'box', rot: [0, 0, 0], scale: [1, 1, 1], material: 'primary',
            size: part.size.map((value) => value * scale), pos: part.pos.map((value) => value * scale) })) };
}

function countParts(parts) {
    return (Array.isArray(parts) ? parts : []).reduce((count, part) => count + 1 + countParts(part?.children), 0);
}

export function listValidArcadeLabShips(record) {
    return (readArcadeLabRecord(record)?.ships || []).filter((entry) => validateArcadeLabShip(entry).ok);
}

export function saveArcadeLabShip(record, entry) {
    const source = readArcadeLabRecord(record);
    if (!source) return { ok: false, reason: 'unknown_record_schema' };
    if (!source.unlocked) return { ok: false, reason: 'locked' };
    const validation = validateArcadeLabShip(entry);
    if (!validation.ok) return { ok: false, reason: validation.errors.join(' '), validation };
    const existing = source.ships.find((ship) => ship.id === entry.id);
    if (!existing && source.ships.length >= MAX_SHIPS) return { ok: false, reason: 'ship_limit' };
    const ship = { ...entry, id: entry.id, label: validation.config.label, config: validation.config, role: validation.role };
    return { ok: true, ship, record: { ...source, ships: [ship, ...source.ships.filter((item) => item.id !== ship.id)] } };
}
