function clampFinite(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function resolveOwnerIndex(turret) {
    return Number.isInteger(turret?.ownerIndex)
        ? turret.ownerIndex
        : (Number.isInteger(turret?.ownerPlayer?.index) ? turret.ownerPlayer.index : -1);
}

function findOwnerPlayer(players, ownerIndex) {
    if (ownerIndex < 0) return null;
    return players.find((player) => Number(player?.index) === ownerIndex) || null;
}

export function createStaticTurretNetworkSnapshot(turrets = []) {
    const entries = [];
    for (const turret of turrets) {
        if (!turret) continue;
        entries.push({
            id: String(turret.id || ''),
            weapon: String(turret.weapon || 'mg'),
            rocketType: String(turret.rocketType || 'ROCKET_WEAK'),
            pos: turret.position.toArray(),
            aim: turret.aimDirection.toArray(),
            owner: resolveOwnerIndex(turret),
            deployed: turret.deployed === true,
            destructible: turret.destructible === true,
            targetPlayers: turret.targetPlayers,
            targetTrails: turret.targetTrails === true,
            allowedModes: turret.allowedModes,
            authoredScale: turret.authoredScale,
            range: Number(turret.range) || 0,
            cooldown: Number(turret.cooldown) || 0,
            cooldownRemaining: Math.max(0, Number(turret.cooldownRemaining) || 0),
            damage: Number(turret.damage) || 0,
            ttl: Number.isFinite(turret.expiresRemaining) ? Math.max(0, turret.expiresRemaining) : -1,
            hp: Number.isFinite(turret.hp) ? Math.max(0, turret.hp) : -1,
            maxHp: Number.isFinite(turret.maxHp) ? Math.max(1, turret.maxHp) : -1,
            radius: Math.max(0.5, Number(turret.hitboxRadius) || 2.2),
            shotsFired: Math.max(0, Math.trunc(Number(turret.shotsFired) || 0)),
            flashRemaining: Math.max(0, Number(turret.flashRemaining) || 0),
        });
    }
    return entries;
}

function createNetworkTurret(system, entry, players) {
    const ownerIndex = Number.isInteger(entry?.owner) ? entry.owner : Math.trunc(Number(entry?.owner) || -1);
    const ownerPlayer = findOwnerPlayer(players, ownerIndex);
    const turret = system._createTurret({
        id: String(entry?.id || `replica_${system._nextTurretId++}`),
        weapon: String(entry?.weapon || 'mg') === 'rocket' ? 'rocket' : 'mg',
        pos: Array.isArray(entry?.pos) ? entry.pos : [0, 0, 0],
        range: clampFinite(entry?.range, 58, 0.001, 180000),
        cooldown: clampFinite(entry?.cooldown, 0.24, 0.05, 12),
        damage: clampFinite(entry?.damage, 3, 0, 500),
        phase: Math.max(0, Number(entry?.cooldownRemaining) || 0),
        rocketType: String(entry?.rocketType || 'ROCKET_WEAK'),
        deployed: entry?.deployed === true,
        destructible: entry?.destructible ?? entry?.deployed === true,
        targetPlayers: entry?.targetPlayers === 'all' ? 'all' : 'humans',
        targetTrails: entry?.targetTrails === true,
        allowedModes: entry?.allowedModes,
        ownerIndex,
        ownerColor: ownerPlayer?.color,
        maxHp: Number(entry?.maxHp),
        hp: Number(entry?.hp),
        hitboxRadius: Number(entry?.radius),
    });
    turret.ownerPlayer = ownerPlayer;
    turret.source = ownerPlayer || turret.source;
    turret.expiresRemaining = Number(entry?.ttl) >= 0 ? Number(entry.ttl) : Number.POSITIVE_INFINITY;
    return turret;
}

function applyTurretEntry(system, turret, entry, players) {
    const previousShotsFired = turret.shotsFired;
    const shotsWereInitialized = turret.networkShotsInitialized === true;
    const pos = Array.isArray(entry.pos) ? entry.pos : [0, 0, 0];
    const aim = Array.isArray(entry.aim) ? entry.aim : [1, 0, 0];
    turret.position.set(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
    turret.root?.position.copy?.(turret.position);
    turret.aimDirection.set(Number(aim[0]) || 0, Number(aim[1]) || 0, Number(aim[2]) || 0);
    if (turret.aimDirection.lengthSq() > 0.000001) {
        system._tmpPoint.copy(turret.position).add(turret.aimDirection);
        turret.root?.userData?.headPivot?.lookAt?.(system._tmpPoint);
    }
    turret.ownerIndex = Number.isInteger(entry.owner) ? entry.owner : Math.trunc(Number(entry.owner) || -1);
    turret.ownerPlayer = findOwnerPlayer(players, turret.ownerIndex);
    turret.source = turret.ownerPlayer || turret.source;
    turret.deployed = entry.deployed === true;
    turret.destructible = entry.destructible ?? turret.deployed;
    turret.authoredScale = clampFinite(entry.authoredScale, 1, 0.001, 1000);
    turret.root?.scale.setScalar(turret.authoredScale);
    turret.rocketType = String(entry.rocketType || turret.rocketType || 'ROCKET_WEAK');
    turret.range = clampFinite(entry.range, turret.range, 0.001, 180000);
    turret.cooldown = clampFinite(entry.cooldown, turret.cooldown, 0.05, 12);
    turret.cooldownRemaining = Math.max(0, Number(entry.cooldownRemaining) || 0);
    turret.damage = clampFinite(entry.damage, turret.damage, 0, 500);
    turret.expiresRemaining = Number(entry.ttl) >= 0 ? Number(entry.ttl) : Number.POSITIVE_INFINITY;
    turret.maxHp = Number(entry.maxHp) >= 0 ? Math.max(1, Number(entry.maxHp)) : Number.POSITIVE_INFINITY;
    turret.hp = Number(entry.hp) >= 0 ? Math.max(0, Number(entry.hp)) : turret.maxHp;
    turret.hitboxRadius = clampFinite(entry.radius, turret.hitboxRadius, 0.5, 8);
    turret.shotsFired = Math.max(0, Math.trunc(Number(entry.shotsFired) || 0));
    turret.flashRemaining = Math.max(0, Number(entry.flashRemaining) || 0);
    if (turret.root?.userData?.muzzleFlash) {
        turret.root.userData.muzzleFlash.visible = turret.flashRemaining > 0;
    }
    if (shotsWereInitialized && turret.shotsFired > previousShotsFired) {
        system._playReplicatedShot?.(turret);
    }
    turret.networkShotsInitialized = true;
}

export function applyStaticTurretNetworkSnapshot(system, entries, players = []) {
    if (!Array.isArray(entries)) return;
    system.networkReplica = true;
    const incomingById = new Map();
    for (const entry of entries) {
        const id = String(entry?.id || '');
        if (id) incomingById.set(id, entry);
    }

    for (let index = system.turrets.length - 1; index >= 0; index -= 1) {
        if (!incomingById.has(String(system.turrets[index]?.id || ''))) {
            system._removeTurretAt(index, 'network-removed');
        }
    }

    for (const [id, entry] of incomingById) {
        let turret = system.turrets.find((candidate) => String(candidate?.id || '') === id);
        if (!turret) {
            turret = createNetworkTurret(system, entry, players);
            system.turrets.push(turret);
        }
        applyTurretEntry(system, turret, entry, players);
    }
}
