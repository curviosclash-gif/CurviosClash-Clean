export const MENU_MULTIPLAYER_HEARTBEAT_INTERVAL_MS = 4000;

const MEMBER_STALE_AFTER_MS = 15000;
const MEMBER_PRESENCE_LEASE_MS = 45000;
const HOST_PRESENCE_LEASE_MS = 60000;

export function normalizeMultiplayerMemberSnapshot(member, fallbackRole, now, helpers) {
    const peerId = helpers.normalizeString(member?.peerId, '');
    if (!peerId) return null;
    const role = helpers.normalizeString(member?.role, fallbackRole) === 'host' ? 'host' : 'client';
    const joinedAt = helpers.toTimestamp(member?.joinedAt, now);
    const lastSeenAt = helpers.toTimestamp(member?.lastSeenAt, now);
    const staleAfterAt = Math.max(0, lastSeenAt + MEMBER_STALE_AFTER_MS);
    const leaseWindowMs = role === 'host' ? HOST_PRESENCE_LEASE_MS : MEMBER_PRESENCE_LEASE_MS;
    const leaseBaseTime = lastSeenAt > 0 ? lastSeenAt : now;
    const leaseExpiresAt = Math.max(
        helpers.toTimestamp(member?.leaseExpiresAt, 0),
        leaseBaseTime + leaseWindowMs
    );
    return {
        peerId,
        actorId: helpers.normalizeString(member?.actorId, role === 'host' ? 'host' : 'player'),
        role,
        ready: member?.ready === true,
        joinedAt,
        lastSeenAt,
        staleAfterAt,
        leaseExpiresAt,
        stale: now > staleAfterAt,
    };
}

export function normalizeMultiplayerMembers(members, hostPeerId, now, helpers) {
    const hostId = helpers.normalizeString(hostPeerId, '');
    const normalizedMembers = (Array.isArray(members) ? members : [])
        .map((member) => normalizeMultiplayerMemberSnapshot(
            member,
            member?.peerId === hostId ? 'host' : 'client',
            now,
            helpers
        ))
        .filter((member) => member && helpers.toTimestamp(member.leaseExpiresAt, 0) > 0 && now <= member.leaseExpiresAt);

    if (normalizedMembers.length === 0) return [];

    const resolvedHostPeerId = hostId || helpers.normalizeString(normalizedMembers[0]?.peerId, '');
    const hostPresent = !!(resolvedHostPeerId && normalizedMembers.some((member) => member.peerId === resolvedHostPeerId));
    return normalizedMembers
        .map((member) => ({
            ...member,
            role: hostPresent && member.peerId === resolvedHostPeerId ? 'host' : 'client',
        }))
        .sort((left, right) => {
            if (hostPresent && left.role !== right.role) return left.role === 'host' ? -1 : 1;
            if (left.joinedAt !== right.joinedAt) return left.joinedAt - right.joinedAt;
            return left.peerId.localeCompare(right.peerId);
        });
}

export function extendMultiplayerPresenceLease(member, now) {
    return {
        ...member,
        lastSeenAt: now,
        leaseExpiresAt: now + (member?.role === 'host' ? HOST_PRESENCE_LEASE_MS : MEMBER_PRESENCE_LEASE_MS),
    };
}
