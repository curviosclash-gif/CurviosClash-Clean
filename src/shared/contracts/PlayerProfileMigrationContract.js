export const PLAYER_PROFILE_MIGRATION_SCHEMA_VERSION = 'player-profile-migration.v1';

export function createPlayerProfileMigrationRecord(profileId, source = null) {
    const record = source && typeof source === 'object' ? source : {};
    return {
        schemaVersion: PLAYER_PROFILE_MIGRATION_SCHEMA_VERSION,
        profileId: String(profileId || record.profileId || '').trim(),
        recoveryTargetProfileId: String(record.recoveryTargetProfileId || '').trim(),
        status: ['pending', 'complete', 'failed'].includes(record.status) ? record.status : 'pending',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
        records: record.records && typeof record.records === 'object' ? { ...record.records } : {},
    };
}
