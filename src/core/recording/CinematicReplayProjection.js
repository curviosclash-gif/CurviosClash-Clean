// @ts-nocheck

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function lerp(left, right, alpha) {
    return left + ((right - left) * alpha);
}

function interpolateQuaternion(out, left, right, alpha) {
    const leftValues = Array.isArray(left) ? left : [0, 0, 0, 1];
    const rightValues = Array.isArray(right) ? right : leftValues;
    const leftX = toFiniteNumber(leftValues[0]);
    const leftY = toFiniteNumber(leftValues[1]);
    const leftZ = toFiniteNumber(leftValues[2]);
    const leftW = toFiniteNumber(leftValues[3], 1);
    let rightX = toFiniteNumber(rightValues[0]);
    let rightY = toFiniteNumber(rightValues[1]);
    let rightZ = toFiniteNumber(rightValues[2]);
    let rightW = toFiniteNumber(rightValues[3], 1);
    if ((leftX * rightX) + (leftY * rightY) + (leftZ * rightZ) + (leftW * rightW) < 0) {
        rightX = -rightX;
        rightY = -rightY;
        rightZ = -rightZ;
        rightW = -rightW;
    }
    out.x = lerp(leftX, rightX, alpha);
    out.y = lerp(leftY, rightY, alpha);
    out.z = lerp(leftZ, rightZ, alpha);
    out.w = lerp(leftW, rightW, alpha);
    const length = Math.hypot(out.x, out.y, out.z, out.w);
    if (length <= 0.000001) {
        out.x = 0;
        out.y = 0;
        out.z = 0;
        out.w = 1;
        return out;
    }
    out.x /= length;
    out.y /= length;
    out.z /= length;
    out.w /= length;
    return out;
}

function ensureProjectionPlayer(outPlayers, index) {
    while (outPlayers.length <= index) {
        outPlayers.push({
            playerIndex: 0,
            isBot: false,
            alive: true,
            color: 0xffffff,
            score: 0,
            speed: 0,
            boostCharge: 0,
            boostCapacity: 1,
            isBoosting: false,
            hp: 100,
            maxHp: 100,
            trailWidth: 0.6,
            trailInGap: false,
            inventory: [],
            effects: [],
            hasShield: false,
            shieldHP: 0,
            maxShieldHp: 0,
            shieldHitFeedback: 0,
            modelScale: 1,
            vehicleId: '',
            skinId: '',
            animation: '',
            weapon: '',
            cockpitCamera: false,
            planarMode: false,
            cameraModeId: 'THIRD_PERSON',
            renderDiscontinuityVersion: 0,
            exclusionZoneState: { phase: 'SAFE', elapsedSeconds: 0, countdownSeconds: 0, stage: '' },
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            direction: { x: 0, y: 0, z: -1 },
            firstPersonAnchor: { x: 0, y: 0, z: -1 },
        });
    }
    return outPlayers[index];
}

function findByIndex(entries, playerIndex, fallbackIndex) {
    const list = Array.isArray(entries) ? entries : [];
    for (let index = 0; index < list.length; index++) {
        if (Number(list[index]?.index) === Number(playerIndex)) return list[index];
    }
    return list[fallbackIndex] || null;
}

function updateProjectionPlayer(out, left, right, alpha, fallbackIndex) {
    const leftPos = left?.pos || [0, 0, 0];
    const rightPos = right?.pos || leftPos;
    const leftRot = left?.rot || [0, 0, 0, 1];
    const rightRot = right?.rot || leftRot;
    const discrete = alpha < 0.5 ? left : right;
    const leftDiscontinuityVersion = Math.max(
        0,
        Math.trunc(toFiniteNumber(left?.renderDiscontinuityVersion, 0))
    );
    const rightDiscontinuityVersion = Math.max(
        0,
        Math.trunc(toFiniteNumber(right?.renderDiscontinuityVersion, leftDiscontinuityVersion))
    );
    const transformAlpha = leftDiscontinuityVersion === rightDiscontinuityVersion
        ? alpha
        : (alpha < 0.5 ? 0 : 1);
    out.playerIndex = Number.isInteger(left?.index) ? left.index : fallbackIndex;
    out.isBot = discrete?.isBot === true;
    out.alive = discrete?.alive !== false;
    out.color = Math.trunc(toFiniteNumber(discrete?.color, 0xffffff));
    out.score = Math.max(0, Math.round(lerp(
        toFiniteNumber(left?.score, 0),
        toFiniteNumber(right?.score, toFiniteNumber(left?.score, 0)),
        alpha
    )));
    out.speed = lerp(
        toFiniteNumber(left?.speed, 0),
        toFiniteNumber(right?.speed, toFiniteNumber(left?.speed, 0)),
        alpha
    );
    out.boostCharge = lerp(
        toFiniteNumber(left?.boostCharge, 0),
        toFiniteNumber(right?.boostCharge, toFiniteNumber(left?.boostCharge, 0)),
        alpha
    );
    out.boostCapacity = Math.max(0.001, toFiniteNumber(discrete?.boostCapacity, 1));
    out.isBoosting = discrete?.isBoosting === true;
    out.hp = lerp(
        toFiniteNumber(left?.health, 100),
        toFiniteNumber(right?.health, toFiniteNumber(left?.health, 100)),
        alpha
    );
    out.maxHp = Math.max(1, toFiniteNumber(discrete?.maxHealth, 100));
    out.trailWidth = Math.max(0.01, lerp(
        toFiniteNumber(left?.trailWidth, 0.6),
        toFiniteNumber(right?.trailWidth, toFiniteNumber(left?.trailWidth, 0.6)),
        alpha
    ));
    out.trailInGap = discrete?.trailInGap === true;
    out.renderDiscontinuityVersion = transformAlpha < 0.5
        ? leftDiscontinuityVersion
        : rightDiscontinuityVersion;
    out.position.x = lerp(toFiniteNumber(leftPos[0]), toFiniteNumber(rightPos[0]), transformAlpha);
    out.position.y = lerp(toFiniteNumber(leftPos[1]), toFiniteNumber(rightPos[1]), transformAlpha);
    out.position.z = lerp(toFiniteNumber(leftPos[2]), toFiniteNumber(rightPos[2]), transformAlpha);
    interpolateQuaternion(out.quaternion, leftRot, rightRot, transformAlpha);
    out.inventory = Array.isArray(discrete?.inventory) ? discrete.inventory.slice() : [];
    out.effects = Array.isArray(discrete?.effects)
        ? discrete.effects.map((effect) => ({ ...effect }))
        : [];
    out.hasShield = discrete?.hasShield === true;
    out.shieldHP = Math.max(0, toFiniteNumber(discrete?.shieldHP, 0));
    out.maxShieldHp = Math.max(0, toFiniteNumber(discrete?.maxShieldHp, 0));
    out.shieldHitFeedback = Math.max(0, toFiniteNumber(discrete?.shieldHitFeedback, 0));
    out.modelScale = Math.max(0.01, toFiniteNumber(discrete?.modelScale, 1));
    out.vehicleId = String(discrete?.vehicleId || '');
    out.skinId = String(discrete?.skinId || '');
    out.animation = String(discrete?.animation || '');
    out.weapon = String(discrete?.weapon || '');
    out.cockpitCamera = discrete?.cockpitCamera === true;
    out.planarMode = discrete?.planarMode === true;
    out.cameraModeId = String(discrete?.cameraModeId || 'THIRD_PERSON');
    const zone = discrete?.exclusionZone;
    out.exclusionZoneState.phase = ['SAFE', 'GRACE', 'SALVO'].includes(zone?.phase) ? zone.phase : 'SAFE';
    out.exclusionZoneState.elapsedSeconds = Math.max(0, toFiniteNumber(zone?.elapsedSeconds, 0));
    out.exclusionZoneState.countdownSeconds = Math.max(0, Math.ceil(toFiniteNumber(zone?.countdownSeconds, 0)));
    out.exclusionZoneState.stage = typeof zone?.stage === 'string' ? zone.stage : '';
    const q = out.quaternion;
    out.direction.x = -2 * ((q.x * q.z) + (q.w * q.y));
    out.direction.y = -2 * ((q.y * q.z) - (q.w * q.x));
    out.direction.z = -1 + (2 * ((q.x * q.x) + (q.y * q.y)));
    out.firstPersonAnchor.x = out.position.x + out.direction.x;
    out.firstPersonAnchor.y = out.position.y + out.direction.y + 0.5;
    out.firstPersonAnchor.z = out.position.z + out.direction.z;
}

function updateReplayCamera(projection, leftSnapshot, rightSnapshot, alpha) {
    const cameraIndex = Math.max(0, Math.trunc(toFiniteNumber(projection.localPlayerIndex, 0)));
    const left = findByIndex(leftSnapshot?.cameras, cameraIndex, 0);
    const right = findByIndex(rightSnapshot?.cameras, cameraIndex, 0) || left;
    if (!left) {
        projection.recordedCamera = null;
        return;
    }
    const out = projection.recordedCamera || {
        index: cameraIndex,
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };
    const leftPosition = left.position || [0, 0, 0];
    const rightPosition = right?.position || leftPosition;
    const leftFov = toFiniteNumber(left.fov, 60);
    const leftAspect = toFiniteNumber(left.aspect, 16 / 9);
    const leftZoom = toFiniteNumber(left.zoom, 1);
    const leftPlayer = findByIndex(leftSnapshot?.players, cameraIndex, 0);
    const rightPlayer = findByIndex(rightSnapshot?.players, cameraIndex, 0) || leftPlayer;
    const leftDiscontinuityVersion = Math.max(
        0,
        Math.trunc(toFiniteNumber(leftPlayer?.renderDiscontinuityVersion, 0))
    );
    const rightDiscontinuityVersion = Math.max(
        0,
        Math.trunc(toFiniteNumber(rightPlayer?.renderDiscontinuityVersion, leftDiscontinuityVersion))
    );
    const cameraAlpha = leftDiscontinuityVersion === rightDiscontinuityVersion
        ? alpha
        : (alpha < 0.5 ? 0 : 1);
    const discreteCamera = cameraAlpha < 0.5 ? left : right;
    out.index = cameraIndex;
    out.position.x = lerp(toFiniteNumber(leftPosition[0]), toFiniteNumber(rightPosition[0]), cameraAlpha);
    out.position.y = lerp(toFiniteNumber(leftPosition[1]), toFiniteNumber(rightPosition[1]), cameraAlpha);
    out.position.z = lerp(toFiniteNumber(leftPosition[2]), toFiniteNumber(rightPosition[2]), cameraAlpha);
    interpolateQuaternion(out.quaternion, left.quaternion, right?.quaternion, cameraAlpha);
    out.fov = Math.max(1, lerp(leftFov, toFiniteNumber(right?.fov, leftFov), cameraAlpha));
    out.aspect = Math.max(0.01, lerp(leftAspect, toFiniteNumber(right?.aspect, leftAspect), cameraAlpha));
    out.near = Math.max(0.001, toFiniteNumber(discreteCamera?.near, 0.1));
    out.far = Math.max(1, toFiniteNumber(discreteCamera?.far, 200));
    out.zoom = Math.max(0.01, lerp(leftZoom, toFiniteNumber(right?.zoom, leftZoom), cameraAlpha));
    projection.recordedCamera = out;
}

export function updateReplayProjection(projection, leftSnapshot, rightSnapshot, alpha, metadata) {
    const leftPlayers = Array.isArray(leftSnapshot?.players) ? leftSnapshot.players : [];
    const rightPlayers = Array.isArray(rightSnapshot?.players) ? rightSnapshot.players : leftPlayers;
    const leftTime = toFiniteNumber(leftSnapshot?.timeMs, 0);
    projection.updatedAt = Math.max(
        0,
        lerp(leftTime, toFiniteNumber(rightSnapshot?.timeMs, leftTime), alpha)
    );
    projection.gameStateId = String(
        (alpha < 0.5 ? leftSnapshot?.gameStateId : rightSnapshot?.gameStateId)
        || 'playing'
    );
    projection.modeId = String(metadata?.activeGameMode || metadata?.modeId || '');
    projection.localPlayerIndex = Math.max(0, Math.trunc(toFiniteNumber(
        metadata?.localPlayerIndex
        ?? metadata?.runtimeConfig?.session?.localPlayerIndex,
        projection.localPlayerIndex
    )));
    projection.localHumanCount = Math.max(1, Math.trunc(toFiniteNumber(metadata?.numHumans, 1)));
    const fogSnapshot = alpha < 0.5 ? leftSnapshot?.globalFog : rightSnapshot?.globalFog;
    const fogRemaining = Math.max(0, toFiniteNumber(fogSnapshot?.remainingSeconds, 0));
    projection.globalFog = {
        active: fogSnapshot?.active === true && fogRemaining > 0,
        remainingSeconds: fogRemaining,
        visibilityRange: Math.max(0, toFiniteNumber(fogSnapshot?.visibilityRange, 0)),
    };
    for (let index = 0; index < leftPlayers.length; index++) {
        const left = leftPlayers[index];
        const playerIndex = Number.isInteger(left?.index) ? left.index : index;
        const right = findByIndex(rightPlayers, playerIndex, index) || left;
        updateProjectionPlayer(
            ensureProjectionPlayer(projection.players, index),
            left,
            right,
            alpha,
            index
        );
    }
    projection.players.length = leftPlayers.length;
    updateReplayCamera(projection, leftSnapshot, rightSnapshot, alpha);
    return projection;
}
