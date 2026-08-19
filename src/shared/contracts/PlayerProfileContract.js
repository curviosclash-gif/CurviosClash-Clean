export const PLAYER_PROFILE_SCHEMA_VERSION = 'player-profiles.v1';
export const PLAYER_PROFILE_MAX_NAME_LENGTH = 32;
export const PLAYER_PROFILE_MAX_PROFILES = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlayerProfileId(value) {
    return UUID_PATTERN.test(String(value || '').trim());
}

export function normalizePlayerProfileName(value, fallback = '') {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    const clipped = Array.from(normalized).slice(0, PLAYER_PROFILE_MAX_NAME_LENGTH).join('');
    return clipped || String(fallback || '').trim();
}

function normalizeIso(value, fallback) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export function createPlayerProfile(source = {}, options = {}) {
    const now = String(options.now || new Date().toISOString());
    return {
        id: String(source.id || options.id || '').trim(),
        displayName: normalizePlayerProfileName(source.displayName, options.displayName || 'Spieler 1'),
        createdAt: normalizeIso(source.createdAt, now),
        updatedAt: normalizeIso(source.updatedAt, now),
        preferredSettingsProfileName: normalizePlayerProfileName(
            source.preferredSettingsProfileName,
            options.preferredSettingsProfileName || ''
        ),
        archivedAt: source.archivedAt ? normalizeIso(source.archivedAt, now) : null,
    };
}

export function normalizePlayerProfileRegistry(source, options = {}) {
    const createId = typeof options.createId === 'function' ? options.createId : () => crypto.randomUUID();
    const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
    if (source?.schemaVersion && source.schemaVersion !== PLAYER_PROFILE_SCHEMA_VERSION) {
        return { ok: false, reason: 'unsupported_schema', registry: null };
    }

    const profiles = [];
    const usedIds = new Set();
    const usedNames = new Set();
    for (const candidate of Array.isArray(source?.profiles) ? source.profiles.slice(0, PLAYER_PROFILE_MAX_PROFILES) : []) {
        if (!isPlayerProfileId(candidate?.id) || usedIds.has(candidate.id)) continue;
        const profile = createPlayerProfile(candidate, { now: now() });
        let name = profile.displayName;
        let key = name.toLocaleLowerCase('de');
        if (usedNames.has(key)) {
            let suffix = 2;
            while (usedNames.has(`${name} ${suffix}`.toLocaleLowerCase('de'))) suffix += 1;
            name = normalizePlayerProfileName(`${name} ${suffix}`, `Spieler ${suffix}`);
            key = name.toLocaleLowerCase('de');
        }
        profile.displayName = name;
        usedIds.add(profile.id);
        usedNames.add(key);
        profiles.push(profile);
    }

    if (profiles.length === 0) {
        profiles.push(createPlayerProfile({}, {
            id: createId(),
            now: now(),
            displayName: 'Spieler 1',
            preferredSettingsProfileName: options.preferredSettingsProfileName,
        }));
    }
    const activeProfiles = profiles.filter((profile) => !profile.archivedAt);
    if (activeProfiles.length === 0) profiles[0].archivedAt = null;
    const usable = profiles.filter((profile) => !profile.archivedAt);
    const activeProfileId = usable.some((profile) => profile.id === source?.activeProfileId)
        ? source.activeProfileId
        : usable[0].id;
    const defaultProfileId = usable.some((profile) => profile.id === source?.defaultProfileId)
        ? source.defaultProfileId
        : activeProfileId;
    return {
        ok: true,
        reason: 'ok',
        registry: {
            schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
            activeProfileId,
            defaultProfileId,
            profiles,
        },
    };
}

export function resolveUniquePlayerProfileName(profiles, requestedName, fallback = 'Spieler') {
    const base = normalizePlayerProfileName(requestedName, fallback);
    const names = new Set((Array.isArray(profiles) ? profiles : []).map((profile) => (
        normalizePlayerProfileName(profile?.displayName).toLocaleLowerCase('de')
    )));
    if (!names.has(base.toLocaleLowerCase('de'))) return base;
    let index = 2;
    while (names.has(`${base} ${index}`.toLocaleLowerCase('de'))) index += 1;
    return normalizePlayerProfileName(`${base} ${index}`, `${fallback} ${index}`);
}

export function resolvePlayerProfileMultiplayerIdentity(profile, fallbackActorId = 'player') {
    const profileId = isPlayerProfileId(profile?.id) ? String(profile.id) : '';
    const actorId = profileId || String(fallbackActorId || 'player').trim() || 'player';
    return Object.freeze({
        profileId,
        actorId,
        displayName: normalizePlayerProfileName(profile?.displayName, actorId),
    });
}
