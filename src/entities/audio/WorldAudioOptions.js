function resolvePrimaryListener(owner) {
    const players = owner?.players || [];
    const requestedIndex = Number(owner?.renderer?.viewportSystem?.localPlayerIndex);
    const localPlayerIndex = Number.isInteger(requestedIndex) ? requestedIndex : 0;
    const player = players.find((entry) => entry?.index === localPlayerIndex && entry.isBot !== true)
        || players.find((entry) => entry?.isBot !== true)
        || null;
    const camera = owner?.renderer?.cameras?.[localPlayerIndex]
        || owner?.renderer?.cameras?.[0]
        || null;
    const orientation = camera?.quaternion || player?.quaternion || null;
    const listenerPosition = camera?.position || player?.position || null;

    return listenerPosition && orientation
        ? { position: listenerPosition, orientation }
        : { position: player?.position || null, orientation: null };
}

function resolveListenerSpace(relative, quaternion) {
    const qx = Number(quaternion?.x);
    const qy = Number(quaternion?.y);
    const qz = Number(quaternion?.z);
    const qw = Number(quaternion?.w);
    const length = Math.hypot(qx, qy, qz, qw);
    if (![qx, qy, qz, qw, length].every(Number.isFinite) || length <= 0) return null;

    const x = qx / length;
    const y = qy / length;
    const z = qz / length;
    const w = qw / length;
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const xw = x * w;
    const yw = y * w;
    const zw = z * w;

    return {
        x: relative.x * (1 - 2 * (yy + zz))
            + relative.y * (2 * (xy + zw))
            + relative.z * (2 * (xz - yw)),
        y: relative.x * (2 * (xy - zw))
            + relative.y * (1 - 2 * (xx + zz))
            + relative.z * (2 * (yz + xw)),
        z: relative.x * (2 * (xz + yw))
            + relative.y * (2 * (yz - xw))
            + relative.z * (1 - 2 * (xx + yy)),
    };
}

export function resolveWorldAudioOptions(owner, position, options = {}) {
    if (!position) return options;
    const listener = resolvePrimaryListener(owner);
    if (!listener.position) return options;

    const relative = {
        x: (Number(position.x) || 0) - (Number(listener.position.x) || 0),
        y: (Number(position.y) || 0) - (Number(listener.position.y) || 0),
        z: (Number(position.z) || 0) - (Number(listener.position.z) || 0),
    };
    const distance = Math.hypot(relative.x, relative.y, relative.z);
    const listenerSpace = resolveListenerSpace(relative, listener.orientation);
    if (!listenerSpace) return { ...options, distance };

    const horizontalDistance = Math.hypot(listenerSpace.x, listenerSpace.z);
    const pan = horizontalDistance > 0
        ? Math.min(1, Math.max(-1, listenerSpace.x / horizontalDistance))
        : 0;
    return {
        ...options,
        distance,
        pan,
        spatialPosition: listenerSpace,
    };
}
