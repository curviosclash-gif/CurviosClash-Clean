import { CONFIG_BASE } from '../../core/Config.js';
import { cloneJsonValue } from '../../shared/utils/JsonClone.js';

export const TUNING_PARAMETER_REGISTRY_VERSION = 'tuning-parameter-registry.v1';

const TUNING_ROOT_SECTIONS = Object.freeze({
    TICK_RATE: 'GAMEPLAY',
    TIME_STEP: 'GAMEPLAY',
    MAX_UPDATES_PER_FRAME: 'GAMEPLAY',
    PLAYER: 'PLAYER',
    TRAIL: 'TRAIL',
    ARENA: 'ARENA',
    GAMEPLAY: 'GAMEPLAY',
    POWERUP: 'POWERUP',
    HUNT: 'HUNT',
    PROJECTILE: 'PROJECTILE',
    PORTAL: 'PORTAL',
    HOMING: 'HOMING',
    CAMERA: 'CAMERA',
    RENDER: 'RENDER',
    COLORS: 'COLORS',
    BOT: 'BOT',
});

const TUNING_SECTION_LABELS = Object.freeze({
    GAMEPLAY: 'Gameplay',
    PLAYER: 'Player',
    TRAIL: 'Trail',
    ARENA: 'Arena',
    POWERUP: 'Powerup',
    HUNT: 'Hunt',
    PROJECTILE: 'Projectile',
    PORTAL: 'Portal',
    HOMING: 'Homing',
    CAMERA: 'Camera',
    RENDER: 'Render',
    COLORS: 'Farben',
    BOT: 'Bot-Profile',
});

const BOT_PROFILE_MUTABLE_IDS = new Set(['EASY', 'NORMAL', 'HARD']);
const PPO_V2_PATH_PATTERN = /^BOT\.DIFFICULTY_PROFILES\.PPO_V2(\.|$)/;

function toPath(parts) {
    return parts.join('.');
}

function toLabel(path) {
    const lastSegment = String(path.split('.').pop() || path);
    return lastSegment
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function detectParameterType(value, keyPath) {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') {
        const key = String(keyPath || '').toLowerCase();
        const colorLikeKey = /color|colour|hex|tint|theme/.test(key);
        const colorLikeValue = /^#?[0-9a-f]{3,8}$/i.test(value);
        if (colorLikeKey && colorLikeValue) return 'color';
        return 'string';
    }
    return null;
}

function buildNumberBounds(value) {
    const numericDefault = Number(value);
    if (!Number.isFinite(numericDefault)) return {};
    const absDefault = Math.abs(numericDefault);
    if (absDefault <= 1) {
        return { min: -1, max: 1, step: 0.01 };
    }
    if (absDefault <= 10) {
        return { min: -10, max: 10, step: 0.1 };
    }
    if (absDefault <= 100) {
        return { min: -100, max: 100, step: 1 };
    }
    return { min: -1000, max: 1000, step: 5 };
}

function isReadOnlyPath(path) {
    if (PPO_V2_PATH_PATTERN.test(path)) {
        return true;
    }
    const profileMatch = path.match(/^BOT\.DIFFICULTY_PROFILES\.([A-Z0-9_]+)/);
    if (profileMatch && !BOT_PROFILE_MUTABLE_IDS.has(profileMatch[1])) {
        return true;
    }
    return false;
}

function walkParameters(value, pathParts, sectionKey, output) {
    if (Array.isArray(value)) {
        return;
    }
    const type = detectParameterType(value, toPath(pathParts));
    if (type) {
        const path = toPath(pathParts);
        const descriptor = {
            id: path,
            section: sectionKey,
            sectionLabel: TUNING_SECTION_LABELS[sectionKey] || sectionKey,
            path,
            label: toLabel(path),
            type,
            defaultValue: cloneJsonValue(value),
            readOnly: isReadOnlyPath(path),
        };
        if (type === 'number') {
            Object.assign(descriptor, buildNumberBounds(value));
        }
        output.push(Object.freeze(descriptor));
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
        walkParameters(nestedValue, [...pathParts, key], sectionKey, output);
    }
}

function buildRegistry() {
    const parameters = [];
    for (const [rootKey, sectionKey] of Object.entries(TUNING_ROOT_SECTIONS)) {
        if (!Object.prototype.hasOwnProperty.call(CONFIG_BASE, rootKey)) continue;
        walkParameters(CONFIG_BASE[rootKey], [rootKey], sectionKey, parameters);
    }
    parameters.sort((left, right) => left.path.localeCompare(right.path));
    const byPath = new Map(parameters.map((descriptor) => [descriptor.path, descriptor]));
    return Object.freeze({
        contractVersion: TUNING_PARAMETER_REGISTRY_VERSION,
        sections: Object.freeze({ ...TUNING_SECTION_LABELS }),
        parameters: Object.freeze(parameters),
        byPath,
    });
}

const TUNING_PARAMETER_REGISTRY = buildRegistry();

export function getTuningParameterRegistry() {
    return TUNING_PARAMETER_REGISTRY;
}

export function getTuningParameterDescriptors() {
    return TUNING_PARAMETER_REGISTRY.parameters;
}

export function getTuningParameterDescriptor(path) {
    return TUNING_PARAMETER_REGISTRY.byPath.get(String(path || '')) || null;
}

export function hasTuningParameterPath(path) {
    return TUNING_PARAMETER_REGISTRY.byPath.has(String(path || ''));
}

export function listTuningSectionParameters(sectionKey) {
    const normalizedSection = String(sectionKey || '').trim().toUpperCase();
    return TUNING_PARAMETER_REGISTRY.parameters.filter((descriptor) => descriptor.section === normalizedSection);
}

