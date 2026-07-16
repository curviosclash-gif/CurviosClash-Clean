export const EDITOR_AUTHORING_CONTRACT_VERSION = 'editor-authoring.v1';

// Authoritative placement type names: the `tool`/`type` field shared across
// EditorBuildCatalog entries, EditorMapSerializer userData, and MapSchema serialization.
// Adding a new object type here is the single authoritative place to register it.
export const EDITOR_OBJECT_TYPES = Object.freeze({
    HARD: 'hard',
    FOAM: 'foam',
    PORTAL: 'portal',
    SPAWN: 'spawn',
    ITEM: 'item',
    AIRCRAFT: 'aircraft',
    GLB: 'glb',
    TUNNEL: 'tunnel',
    CHECKPOINT: 'checkpoint',
});

// Default gameplay behavior for authored item models. `item_box` intentionally
// stays unmapped so it continues to represent a random pickup anchor.
export const EDITOR_ITEM_PICKUP_TYPE_BY_SUBTYPE = Object.freeze({
    item_arrow: 'SPEED_UP',
    item_battery: 'SPEED_UP',
    item_capsule: 'HEALTH',
    item_coin: 'GHOST',
    item_crate: 'SLOW_DOWN',
    item_crystal: 'SLOW_TIME',
    item_gem: 'SHIELD',
    item_health: 'HEALTH',
    item_orb: 'SLOW_TIME',
    item_pyramid: 'THICK',
    item_ring: 'GHOST',
    item_rocket: 'ROCKET_WEAK',
    item_shield: 'SHIELD',
    item_sphere: 'THIN',
    item_star: 'SPEED_UP',
    item_torus: 'INVERT',
});

export function getDefaultEditorItemPickupType(subType) {
    const normalized = String(subType || '').trim().toLowerCase();
    return EDITOR_ITEM_PICKUP_TYPE_BY_SUBTYPE[normalized] || null;
}

// Content-descriptor fields in EditorBuildCatalog entries that EditorMapSerializer
// and runtime map loading consume. These must stay stable across editor/serializer/runtime.
export const EDITOR_CONTENT_DESCRIPTOR_FIELDS = Object.freeze([
    'tool',    // authoritative object type; maps to `type` in serialized map JSON
    'subType', // object variant; maps to portal model, spawn role, item type, checkpoint kind
]);

// UI-metadata fields in EditorBuildCatalog entries: editor presentation only.
// EditorMapSerializer and runtime map loading do not consume these fields.
export const EDITOR_UI_METADATA_FIELDS = Object.freeze([
    'categoryId',
    'categoryLabel',
    'accentColor',
    'previewGlyph',
    'previewToken',
    'sortOrder',
    'badge',
    'isFeatured',
    'isDefault',
    'label',
    'description',
    'keywords',
]);

const _KNOWN_OBJECT_TYPES = new Set(Object.values(EDITOR_OBJECT_TYPES));

export function isKnownEditorObjectType(type) {
    return typeof type === 'string' && _KNOWN_OBJECT_TYPES.has(type);
}

export function getEditorAuthoringDescriptor() {
    return Object.freeze({
        contractVersion: EDITOR_AUTHORING_CONTRACT_VERSION,
        objectTypes: Object.values(EDITOR_OBJECT_TYPES),
        contentDescriptorFields: [...EDITOR_CONTENT_DESCRIPTOR_FIELDS],
        uiMetadataFields: [...EDITOR_UI_METADATA_FIELDS],
    });
}
