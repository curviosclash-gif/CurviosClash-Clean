import { normalizeText } from './ContractNormalizeUtils.js';

export const CONTENT_DESCRIPTOR_VERSION = 'content-descriptor.v1';

export const CONTENT_DESCRIPTOR_TYPES = Object.freeze({
    RUNTIME_MAP_PRESETS: 'runtime-map-presets',
    EDITOR_BUILD_CATALOG: 'editor-build-catalog',
    EDITOR_TEMPLATES: 'editor-templates',
    ARCADE_MISSIONS: 'arcade-missions',
    ARCADE_REWARDS: 'arcade-rewards',
    ARCADE_MODIFIERS: 'arcade-modifiers',
    VEHICLES: 'vehicles',
});

function cloneObjectShallow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...value };
}

function normalizeEntry(entry, index, idPrefix) {
    const source = cloneObjectShallow(entry);
    const fallbackId = `${idPrefix}-${index + 1}`;
    source.id = normalizeText(source.id, fallbackId);
    return Object.freeze(source);
}

export function createContentRegistryDescriptor(options = {}) {
    const descriptorType = normalizeText(options.descriptorType, 'content-registry');
    const source = normalizeText(options.source, 'unknown');
    const status = normalizeText(options.status, 'ready');
    const idPrefix = descriptorType.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'entry';
    const entries = Array.isArray(options.entries)
        ? options.entries.map((entry, index) => normalizeEntry(entry, index, idPrefix))
        : [];
    const metadata = cloneObjectShallow(options.metadata);

    return Object.freeze({
        descriptorVersion: CONTENT_DESCRIPTOR_VERSION,
        descriptorType,
        source,
        status,
        entryCount: entries.length,
        entries: Object.freeze(entries),
        metadata: Object.freeze(metadata),
    });
}
