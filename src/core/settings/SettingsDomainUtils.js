import { cloneJsonValue } from '../../shared/utils/JsonClone.js';

export function deepClone(value) {
    return cloneJsonValue(value);
}

export function normalizePresetId(rawValue) {
    const base = String(rawValue || '')
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9\-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    return base || '';
}

export function normalizeModePath(value, fallback = 'normal') {
    const normalized = String(value || fallback).trim().toLowerCase();
    if (normalized === 'quick_action'
        || normalized === 'arcade'
        || normalized === 'fight'
        || normalized === 'normal') {
        return normalized;
    }
    return fallback;
}

export function isPersistenceSuccess(result) {
    return result === undefined || result === true || result?.success === true;
}
