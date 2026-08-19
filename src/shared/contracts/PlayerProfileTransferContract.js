import { PLAYER_PROFILE_SCHEMA_VERSION, normalizePlayerProfileName } from './PlayerProfileContract.js';
import { getPlayerProfileRecordDefinitionByKind } from './PlayerProfileStorageContract.js';

export const PLAYER_PROFILE_EXPORT_VERSION = 'player-profile-export.v1';
export const PLAYER_PROFILE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export function createPlayerProfileExport(profile, records = {}) {
    return {
        exportVersion: PLAYER_PROFILE_EXPORT_VERSION,
        schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        profile: {
            displayName: normalizePlayerProfileName(profile?.displayName, 'Spieler'),
            createdAt: String(profile?.createdAt || ''),
            preferredSettingsProfileName: normalizePlayerProfileName(profile?.preferredSettingsProfileName, ''),
        },
        records: { ...records },
    };
}

export function parsePlayerProfileImport(input) {
    const raw = typeof input === 'string' ? input : JSON.stringify(input ?? null);
    if (new TextEncoder().encode(raw).byteLength > PLAYER_PROFILE_IMPORT_MAX_BYTES) {
        return { ok: false, reason: 'file_too_large' };
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: 'invalid_json' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'invalid_root' };
    if (parsed.exportVersion !== PLAYER_PROFILE_EXPORT_VERSION || parsed.schemaVersion !== PLAYER_PROFILE_SCHEMA_VERSION) {
        return { ok: false, reason: 'unsupported_schema' };
    }
    const records = {};
    for (const [kind, value] of Object.entries(parsed.records || {})) {
        if (!getPlayerProfileRecordDefinitionByKind(kind)) return { ok: false, reason: 'unknown_record_kind' };
        records[kind] = value;
    }
    return {
        ok: true,
        value: {
            displayName: normalizePlayerProfileName(parsed.profile?.displayName, 'Spieler Import'),
            preferredSettingsProfileName: normalizePlayerProfileName(parsed.profile?.preferredSettingsProfileName, ''),
            records,
        },
    };
}
