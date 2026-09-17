// ============================================
// BotRocketDefenseOps.js - bot side of the rocket defence shot (S2.5)
// ============================================
//
// Contract:
// - Inputs: bot runtime (profile, seeded rng, defence memory) + its player
// - Outputs: whether the bot presses the rocket key this tick
// - Side effects: writes into the bot's fixed-size defence memory only
// - Hotpath guardrail: one tracker call per bot and tick, no allocations per frame
//
// A human shoots an inbound rocket down by pressing the rocket key; S2.1 turns that
// shot into a defence rocket by itself. Bots press the very same key - nothing fires
// on its own (E76), and A10 only lets the bot decide it earlier than a human could.

/** Beyond this distance a defence shot is guesswork unless the rocket closes fast. */
export const ROCKET_DEFENSE_MAX_DISTANCE = 90;
/** Below this distance the two rockets can no longer meet before the hit lands. */
export const ROCKET_DEFENSE_MIN_DISTANCE = 6;
/** A far rocket still counts as worth defending while it arrives within this time. */
export const ROCKET_DEFENSE_MAX_TIME_TO_IMPACT = 2.5;
/** How many rockets a bot remembers its answer for. Fixed size: this never grows. */
export const ROCKET_DEFENSE_MEMORY_SIZE = 4;

const SHOOT_READY_EPSILON = 0.001;

function clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric >= 1 ? 1 : numeric;
}

/**
 * The small ring a bot keeps its per-rocket answers in.
 *
 * A bot judges every chasing rocket exactly once - rolling the dice each frame would
 * make it stutter on the key. The ring holds the last few rockets and overwrites the
 * oldest entry, so the memory never grows during a match.
 */
export function createRocketDefenseMemory() {
    return {
        ids: new Array(ROCKET_DEFENSE_MEMORY_SIZE).fill(''),
        answers: new Array(ROCKET_DEFENSE_MEMORY_SIZE).fill(false),
        next: 0,
    };
}

/** Empties the ring without replacing it, for a round restart or a bot reset. */
export function resetRocketDefenseMemory(memory) {
    if (!memory || !Array.isArray(memory.ids) || !Array.isArray(memory.answers)) return null;
    for (let i = 0; i < memory.ids.length; i += 1) {
        memory.ids[i] = '';
        memory.answers[i] = false;
    }
    memory.next = 0;
    return memory;
}

function ensureMemory(bot) {
    if (!bot._rocketDefenseMemory) {
        bot._rocketDefenseMemory = createRocketDefenseMemory();
    }
    return bot._rocketDefenseMemory;
}

/**
 * One answer per rocket: remembered if the bot already judged this rocket, drawn from
 * the seeded generator otherwise. `projectileAwareness` is the same difficulty knob
 * that decides whether a bot notices an incoming shot at all, so an EASY bot (0) never
 * defends and a HARD bot (0.95) almost always does.
 */
function decideOnce(bot, rocketId, awareness) {
    const memory = ensureMemory(bot);
    for (let i = 0; i < memory.ids.length; i += 1) {
        if (memory.ids[i] === rocketId) return memory.answers[i];
    }

    const answer = awareness >= 1
        ? true
        : (typeof bot._random === 'function' ? bot._random() < awareness : false);
    const slot = memory.next % memory.ids.length;
    memory.ids[slot] = rocketId;
    memory.answers[slot] = answer;
    memory.next = (slot + 1) % memory.ids.length;
    return answer;
}

/**
 * Whether the bot presses the rocket key this tick to shoot an inbound rocket down.
 *
 * The threat comes from the shared tracker, never from a second search of its own:
 * one call per bot and tick, and the very same answer the HUD warning uses. A9 keeps
 * exclusion zone rockets out of it - they cannot be shot down, so they never trigger
 * a wasted rocket.
 */
export function shouldBotDefendWithRocket(bot, player) {
    if (!bot || !player || player.alive === false) return false;

    const rocketInventory = Array.isArray(player.rocketInventory) ? player.rocketInventory : null;
    if (!rocketInventory || rocketInventory.length === 0) return false;
    if ((Number(player.shootCooldown) || 0) > SHOOT_READY_EPSILON) return false;

    const awareness = clamp01(bot.profile?.projectileAwareness);
    if (awareness <= 0) return false;

    const index = Number(player.index);
    if (!Number.isInteger(index) || index < 0) return false;
    const system = player.entityManager?._projectileSystem;
    if (typeof system?.getRocketThreat !== 'function') return false;

    const threat = system.getRocketThreat(index);
    if (!threat?.active) return false;

    const rocketId = String(threat.nearestInterceptableId || '');
    if (!rocketId) return false;

    const interceptableDistance = Number(threat.nearestInterceptableDistance) || 0;
    const distance = interceptableDistance > 0
        ? interceptableDistance
        : (Number(threat.nearestDistance) || 0);
    if (distance < ROCKET_DEFENSE_MIN_DISTANCE) return false;

    const timeToImpact = Number(threat.timeToImpactSeconds) || 0;
    const worthDefending = distance <= ROCKET_DEFENSE_MAX_DISTANCE
        || (timeToImpact > 0 && timeToImpact <= ROCKET_DEFENSE_MAX_TIME_TO_IMPACT);
    if (!worthDefending) return false;

    return decideOnce(bot, rocketId, awareness);
}

/**
 * Presses the rocket key on the bot's decision when a defence shot is due.
 * Returns whether it did, so the caller can skip its own weapon choice this tick.
 */
export function applyRocketDefenseDecision(bot, player) {
    if (!bot?._decision) return false;
    if (!shouldBotDefendWithRocket(bot, player)) return false;
    bot._decision.shootRocket = true;
    return true;
}
