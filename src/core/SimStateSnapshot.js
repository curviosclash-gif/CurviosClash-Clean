// ============================================
// SimStateSnapshot.js - zero-alloc ring-buffer for deterministic state snapshots
// ============================================
// N6: Pre-allocated ring buffer capturing per-tick game state for future rollback.
// All storage is allocated once at init — capture/read produce zero GC pressure.

const RING_SIZE = 30;
const MAX_PLAYERS = 16;
const MAX_EFFECTS = 6;
const MAX_INVENTORY = 6;
const MAX_PROJECTILES = 64;

function _createPlayerSlot() {
    return {
        index: 0,
        alive: false,
        isBot: false,
        score: 0,
        // transform
        px: 0, py: 0, pz: 0,
        qx: 0, qy: 0, qz: 0, qw: 1,
        // velocity
        vx: 0, vy: 0, vz: 0,
        speed: 0,
        // boost
        boostCharge: 0,
        boostTimer: 0,
        boostCooldown: 0,
        manualBoostActive: false,
        // health
        hp: 0,
        maxHp: 0,
        shieldHP: 0,
        hasShield: false,
        // status
        isGhost: false,
        spawnProtectionTimer: 0,
        // effects (fixed-size, effectCount marks how many are active)
        effectCount: 0,
        effectTypes: new Array(MAX_EFFECTS).fill(''),
        effectRemaining: new Float64Array(MAX_EFFECTS),
        // inventory (fixed-size, inventoryCount marks how many are active)
        inventoryCount: 0,
        inventoryItems: new Array(MAX_INVENTORY).fill(''),
        selectedItemIndex: 0,
        // trail metadata
        trailSegmentCount: 0,
        trailWriteIndex: 0,
    };
}

function _createProjectileSlot() {
    return {
        type: '',
        ownerIndex: -1,
        px: 0, py: 0, pz: 0,
        vx: 0, vy: 0, vz: 0,
        ttl: 0,
        targetIndex: -1,
    };
}

function _createFrame() {
    const players = new Array(MAX_PLAYERS);
    for (let i = 0; i < MAX_PLAYERS; i++) {
        players[i] = _createPlayerSlot();
    }
    const projectiles = new Array(MAX_PROJECTILES);
    for (let i = 0; i < MAX_PROJECTILES; i++) {
        projectiles[i] = _createProjectileSlot();
    }
    return {
        tick: -1,
        time: 0,
        playerCount: 0,
        players,
        projectileCount: 0,
        projectiles,
    };
}

function _capturePlayer(slot, player) {
    slot.index = player.index | 0;
    slot.alive = !!player.alive;
    slot.isBot = !!player.isBot;
    slot.score = player.score | 0;

    const pos = player.position;
    if (pos) { slot.px = pos.x; slot.py = pos.y; slot.pz = pos.z; }

    const q = player.quaternion;
    if (q) { slot.qx = q.x; slot.qy = q.y; slot.qz = q.z; slot.qw = q.w; }

    const vel = player.velocity;
    if (vel) { slot.vx = vel.x; slot.vy = vel.y; slot.vz = vel.z; }

    slot.speed = player.speed || 0;

    slot.boostCharge = player.boostCharge || 0;
    slot.boostTimer = player.boostTimer || 0;
    slot.boostCooldown = player.boostCooldown || 0;
    slot.manualBoostActive = !!player.manualBoostActive;

    slot.hp = player.hp || 0;
    slot.maxHp = player.maxHp || 0;
    slot.shieldHP = player.shieldHP || 0;
    slot.hasShield = !!player.hasShield;

    slot.isGhost = !!player.isGhost;
    slot.spawnProtectionTimer = player.spawnProtectionTimer || 0;

    // effects — copy up to MAX_EFFECTS
    const effects = player.activeEffects;
    let ec = 0;
    if (effects) {
        const len = Math.min(effects.length, MAX_EFFECTS);
        for (let i = 0; i < len; i++) {
            const e = effects[i];
            if (e) {
                slot.effectTypes[ec] = e.type || '';
                slot.effectRemaining[ec] = e.remaining || 0;
                ec++;
            }
        }
    }
    slot.effectCount = ec;

    // inventory — copy up to MAX_INVENTORY
    const inv = player.inventory;
    let ic = 0;
    if (inv) {
        const len = Math.min(inv.length, MAX_INVENTORY);
        for (let i = 0; i < len; i++) {
            slot.inventoryItems[ic] = inv[i] || '';
            ic++;
        }
    }
    slot.inventoryCount = ic;
    slot.selectedItemIndex = player.selectedItemIndex | 0;

    // trail metadata
    const trail = player.trail;
    if (trail) {
        slot.trailSegmentCount = trail.segmentCount | 0;
        slot.trailWriteIndex = trail.writeIndex | 0;
    } else {
        slot.trailSegmentCount = 0;
        slot.trailWriteIndex = 0;
    }
}

function _captureProjectile(slot, proj) {
    slot.type = proj.type || '';
    slot.ownerIndex = proj.owner ? (proj.owner.index | 0) : -1;

    const pos = proj.position;
    if (pos) { slot.px = pos.x; slot.py = pos.y; slot.pz = pos.z; }

    const vel = proj.velocity;
    if (vel) { slot.vx = vel.x; slot.vy = vel.y; slot.vz = vel.z; }

    slot.ttl = proj.ttl || 0;
    slot.targetIndex = proj.target ? (proj.target.index | 0) : -1;
}

export class SimStateSnapshot {
    constructor() {
        this._frames = new Array(RING_SIZE);
        for (let i = 0; i < RING_SIZE; i++) {
            this._frames[i] = _createFrame();
        }
        this._writeIndex = 0;
        this._count = 0;
        this._enabled = false;
    }

    get enabled() { return this._enabled; }
    get count() { return this._count; }
    get capacity() { return RING_SIZE; }

    enable() { this._enabled = true; }

    disable() {
        this._enabled = false;
        this._count = 0;
        this._writeIndex = 0;
    }

    capture(tick, time, entityManager) {
        if (!this._enabled) return;

        const frame = this._frames[this._writeIndex];
        frame.tick = tick | 0;
        frame.time = time;

        // capture players
        const players = entityManager.players;
        const pLen = players ? Math.min(players.length, MAX_PLAYERS) : 0;
        frame.playerCount = pLen;
        for (let i = 0; i < pLen; i++) {
            _capturePlayer(frame.players[i], players[i]);
        }

        // capture projectiles
        const projectiles = entityManager.projectiles;
        const prLen = projectiles ? Math.min(projectiles.length, MAX_PROJECTILES) : 0;
        frame.projectileCount = prLen;
        for (let i = 0; i < prLen; i++) {
            _captureProjectile(frame.projectiles[i], projectiles[i]);
        }

        // advance ring buffer
        this._writeIndex = (this._writeIndex + 1) % RING_SIZE;
        if (this._count < RING_SIZE) this._count++;
    }

    getFrame(ticksAgo) {
        if (ticksAgo < 0 || ticksAgo >= this._count) return null;
        const idx = (this._writeIndex - 1 - ticksAgo + RING_SIZE * 2) % RING_SIZE;
        return this._frames[idx];
    }

    getLatestFrame() {
        if (this._count === 0) return null;
        const idx = (this._writeIndex - 1 + RING_SIZE) % RING_SIZE;
        return this._frames[idx];
    }

    getFrameByTick(tick) {
        for (let i = 0; i < this._count; i++) {
            const idx = (this._writeIndex - 1 - i + RING_SIZE * 2) % RING_SIZE;
            if (this._frames[idx].tick === tick) return this._frames[idx];
        }
        return null;
    }

    clear() {
        this._count = 0;
        this._writeIndex = 0;
    }
}
