function buildLookup(entries) {
    const lookup = Object.create(null);
    const safeEntries = Array.isArray(entries) ? entries : [];
    for (let index = 0; index < safeEntries.length; index++) {
        const entry = safeEntries[index];
        lookup[String(entry?.id ?? index)] = entry;
    }
    return lookup;
}

export function buildReplaySceneFrames(frames, rawFrames = null) {
    const safeFrames = Array.isArray(frames) ? frames : [];
    const playbackFrames = new Array(safeFrames.length);
    for (let frameIndex = 0; frameIndex < safeFrames.length; frameIndex++) {
        const sourceFrame = safeFrames[frameIndex];
        const rawFrame = Array.isArray(rawFrames) ? rawFrames[frameIndex] : sourceFrame;
        const sourcePlayers = Array.isArray(sourceFrame?.players) ? sourceFrame.players : [];
        const rawPlayers = Array.isArray(rawFrame?.players) ? rawFrame.players : [];
        const playerLookup = Object.create(null);
        for (let poseIndex = 0; poseIndex < sourcePlayers.length; poseIndex++) {
            const normalizedPose = sourcePlayers[poseIndex];
            const rawPose = rawPlayers.find(
                (entry) => Number(entry?.idx) === Number(normalizedPose?.idx)
            );
            const pose = rawPose ? { ...normalizedPose, ...rawPose } : normalizedPose;
            sourcePlayers[poseIndex] = pose;
            playerLookup[pose.idx] = pose;
        }
        const projectiles = Array.isArray(rawFrame?.projectiles) ? rawFrame.projectiles : [];
        const powerups = Array.isArray(rawFrame?.powerups) ? rawFrame.powerups : [];
        playbackFrames[frameIndex] = {
            time: Number(sourceFrame?.time) || 0,
            players: sourcePlayers,
            playerLookup,
            projectiles,
            projectileLookup: buildLookup(projectiles),
            powerups,
            powerupLookup: buildLookup(powerups),
            particles: rawFrame?.particles || null,
        };
    }
    return playbackFrames;
}
