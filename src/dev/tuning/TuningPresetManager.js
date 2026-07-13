const TUNING_PRESET_STORE_VERSION = 'tuning-preset-store.v1';
const TUNING_PRESET_DOCUMENT_VERSION = 'tuning-preset-document.v1';
const DEFAULT_STORAGE_KEY = 'curvios.tuning.presets.v1';

function safeClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeName(name, fallback = 'Preset') {
    const normalized = String(name || '').trim().replace(/\s+/g, ' ');
    return normalized || fallback;
}

function valuesEqual(left, right) {
    if (typeof left === 'number' || typeof right === 'number') {
        return Number(left) === Number(right);
    }
    return String(left) === String(right);
}

function computeDelta(valuesByPath, defaultsByPath) {
    const delta = {};
    const source = valuesByPath && typeof valuesByPath === 'object' ? valuesByPath : {};
    const defaults = defaultsByPath && typeof defaultsByPath === 'object' ? defaultsByPath : {};
    for (const [path, value] of Object.entries(source)) {
        if (!Object.prototype.hasOwnProperty.call(defaults, path)) {
            continue;
        }
        if (!valuesEqual(value, defaults[path])) {
            delta[path] = safeClone(value);
        }
    }
    return delta;
}

function normalizeStoragePayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return {
            contractVersion: TUNING_PRESET_STORE_VERSION,
            presets: {},
            order: [],
        };
    }
    const sourcePresets = payload.presets && typeof payload.presets === 'object'
        ? payload.presets
        : {};
    const sourceOrder = Array.isArray(payload.order) ? payload.order : [];
    const presets = {};
    const order = [];
    for (const rawId of sourceOrder) {
        const presetId = String(rawId || '').trim();
        const preset = sourcePresets[presetId];
        if (!preset || typeof preset !== 'object') {
            continue;
        }
        const normalizedPreset = {
            id: presetId,
            name: normalizeName(preset.name, presetId),
            createdAt: Number(preset.createdAt || 0),
            updatedAt: Number(preset.updatedAt || 0),
            delta: preset.delta && typeof preset.delta === 'object' ? safeClone(preset.delta) : {},
        };
        presets[presetId] = normalizedPreset;
        order.push(presetId);
    }
    return {
        contractVersion: TUNING_PRESET_STORE_VERSION,
        presets,
        order,
    };
}

function createPresetId(name, nowMs) {
    const slug = normalizeName(name, 'preset')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${slug || 'preset'}-${nowMs}`;
}

export class TuningPresetManager {
    constructor({
        storage = globalThis?.localStorage || null,
        storageKey = DEFAULT_STORAGE_KEY,
        now = () => Date.now(),
    } = {}) {
        this._storage = storage;
        this._storageKey = String(storageKey || DEFAULT_STORAGE_KEY);
        this._now = typeof now === 'function' ? now : (() => Date.now());
        this._state = this._loadState();
    }

    _loadState() {
        if (!this._storage || typeof this._storage.getItem !== 'function') {
            return normalizeStoragePayload(null);
        }
        try {
            const raw = this._storage.getItem(this._storageKey);
            if (!raw) {
                return normalizeStoragePayload(null);
            }
            return normalizeStoragePayload(JSON.parse(raw));
        } catch {
            return normalizeStoragePayload(null);
        }
    }

    _persistState() {
        if (!this._storage || typeof this._storage.setItem !== 'function') {
            return false;
        }
        try {
            this._storage.setItem(this._storageKey, JSON.stringify(this._state));
            return true;
        } catch {
            return false;
        }
    }

    listPresets() {
        return this._state.order
            .map((presetId) => this._state.presets[presetId])
            .filter(Boolean)
            .map((preset) => safeClone(preset));
    }

    getPreset(presetId) {
        const key = String(presetId || '').trim();
        if (!key || !this._state.presets[key]) {
            return null;
        }
        return safeClone(this._state.presets[key]);
    }

    savePreset({ name, valuesByPath, defaultsByPath, presetId = null } = {}) {
        const nowMs = this._now();
        const normalizedName = normalizeName(name, 'Preset');
        const delta = computeDelta(valuesByPath, defaultsByPath);
        const targetId = String(presetId || '').trim() || createPresetId(normalizedName, nowMs);
        const existing = this._state.presets[targetId];
        const nextPreset = {
            id: targetId,
            name: normalizedName,
            createdAt: existing?.createdAt || nowMs,
            updatedAt: nowMs,
            delta,
        };
        this._state.presets[targetId] = nextPreset;
        if (!this._state.order.includes(targetId)) {
            this._state.order.unshift(targetId);
        }
        this._persistState();
        return {
            ok: true,
            reason: 'saved',
            preset: safeClone(nextPreset),
            changedCount: Object.keys(delta).length,
        };
    }

    deletePreset(presetId) {
        const key = String(presetId || '').trim();
        if (!key || !this._state.presets[key]) {
            return {
                ok: false,
                reason: 'preset_not_found',
            };
        }
        delete this._state.presets[key];
        this._state.order = this._state.order.filter((presetKey) => presetKey !== key);
        this._persistState();
        return {
            ok: true,
            reason: 'deleted',
        };
    }

    async applyPreset(presetId, applyPathValue) {
        const preset = this.getPreset(presetId);
        if (!preset) {
            return {
                ok: false,
                reason: 'preset_not_found',
                appliedCount: 0,
            };
        }
        if (typeof applyPathValue !== 'function') {
            return {
                ok: false,
                reason: 'apply_fn_missing',
                appliedCount: 0,
            };
        }

        let appliedCount = 0;
        for (const [path, value] of Object.entries(preset.delta || {})) {
            const result = await Promise.resolve(applyPathValue(path, value));
            if (result?.ok === true || result?.value?.ok === true) {
                appliedCount += 1;
            }
        }

        return {
            ok: true,
            reason: 'applied',
            appliedCount,
            preset,
        };
    }

    createExportDocument(presetId) {
        const preset = this.getPreset(presetId);
        if (!preset) {
            return {
                ok: false,
                reason: 'preset_not_found',
                document: null,
            };
        }
        return {
            ok: true,
            reason: 'ok',
            document: {
                contractVersion: TUNING_PRESET_DOCUMENT_VERSION,
                exportedAt: this._now(),
                preset,
            },
        };
    }

    importPresetDocument(documentPayload) {
        const payload = documentPayload && typeof documentPayload === 'object'
            ? documentPayload
            : null;
        if (!payload || payload.contractVersion !== TUNING_PRESET_DOCUMENT_VERSION) {
            return {
                ok: false,
                reason: 'invalid_document',
            };
        }
        const preset = payload.preset && typeof payload.preset === 'object'
            ? payload.preset
            : null;
        if (!preset || !preset.id || !preset.delta || typeof preset.delta !== 'object') {
            return {
                ok: false,
                reason: 'invalid_preset_payload',
            };
        }

        const nowMs = this._now();
        const targetId = String(preset.id || '').trim();
        const nextPreset = {
            id: targetId,
            name: normalizeName(preset.name, targetId),
            createdAt: Number(preset.createdAt || nowMs),
            updatedAt: nowMs,
            delta: safeClone(preset.delta),
        };
        this._state.presets[targetId] = nextPreset;
        if (!this._state.order.includes(targetId)) {
            this._state.order.unshift(targetId);
        }
        this._persistState();
        return {
            ok: true,
            reason: 'imported',
            preset: safeClone(nextPreset),
        };
    }

    getChangedCount(valuesByPath, defaultsByPath) {
        return Object.keys(computeDelta(valuesByPath, defaultsByPath)).length;
    }
}

export function createTuningPresetManager(options = undefined) {
    return new TuningPresetManager(options);
}

export const TUNING_PRESET_MANAGER_CONTRACT = Object.freeze({
    storeVersion: TUNING_PRESET_STORE_VERSION,
    documentVersion: TUNING_PRESET_DOCUMENT_VERSION,
    storageKey: DEFAULT_STORAGE_KEY,
});
