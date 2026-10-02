// ============================================
// ArcadeStoneWorkshopContract.js - Paket 3: werkstattweiter Steinpool und seine XP-Käufe
// Eine Steinart. Jeder Stein gehört der Werkstatt, hat eine eigene Stufe und steckt in höchstens
// einem Platz eines Fahrzeugs (placement). Der Pool ist die einzige Wahrheit für den Run.
// Kaufergebnisse: { ok, reason, cost, next, pool } - next ist das Profil des bezahlenden Fahrzeugs.
// Rein: keine Importe aus core/ui/state und nicht aus dem Profilvertrag (der importiert von hier).
// ============================================

import {
    ARCADE_STONE_FREE_COUNT,
    ARCADE_STONE_MAX_OWNED,
    ARCADE_STONE_PRICE_XP,
    ARCADE_STONE_SLOT_PACKAGES,
    ARCADE_STONE_TIER_LEVEL_INTERVAL,
    ARCADE_STONE_UPGRADE_COST_FACTOR_XP,
} from './ArcadeVehicleBalanceContract.js';
import { spendArcadeVehicleXp } from './ArcadeVehicleBuildContract.js';

export const ARCADE_STONE_WORKSHOP_SCHEMA_VERSION = 'arcade-stone-workshop.v1';
export const ARCADE_STONE_WORKSHOP_STORAGE_KEY = 'cuviosclash.arcade-stone-workshop.v1';
/** Die sieben Steinplätze eines Fahrzeugs in fester Reihenfolge. */
export const ARCADE_STONE_SLOT_IDS = Object.freeze([
    'core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right', 'utility',
]);
/** Kaufbare Steinplatz-Pakete in fester Reihenfolge (base ist immer frei). */
export const ARCADE_STONE_PACKAGE_IDS = Object.freeze(['wings', 'engines', 'utility']);
const PACKAGE_LABELS = Object.freeze({ base: 'Rumpf und Nase', wings: 'Flügelpaar', engines: 'Antriebspaar', utility: 'Utility' });

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const STONE_ID_PATTERN = /^stone-(\d+)$/;
// A level jump over thousands of levels would otherwise list thousands of tiers.
const MAX_LISTED_TIERS = 20;

/**
 * @typedef {{ vehicleId: string, slotId: string }} ArcadeStonePlacement
 * @typedef {{ stoneId: string, level: number, placement: ArcadeStonePlacement|null }} ArcadeStone
 * @typedef {{ schemaVersion: string, nextSerial: number, stones: ArcadeStone[], updatedAt: string }} ArcadeStoneWorkshop
 * @typedef {{ ok: boolean, reason: string, cost: number, next: Record<string, any>|null,
 *   pool?: ArcadeStoneWorkshop|null, requiredLevel?: number }} ArcadeStoneRuleResult
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whole number in [min, MAX_SAFE_INTEGER]; +Infinity saturates, NaN and smaller values give min.
 * @param {unknown} value
 * @param {number} min
 */
function clampWhole(value, min) {
    const n = Math.floor(Number(value));
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(MAX_SAFE, n));
}

/** @param {unknown} nowMs */
function toIsoString(nowMs) {
    return new Date(Math.max(0, Number(nowMs) || 0)).toISOString();
}

/** @param {number} serial */
function formatStoneId(serial) {
    return `stone-${String(serial).padStart(4, '0')}`;
}

/**
 * Gültige Stein-ID (`stone-<Ziffern>`) oder null.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeArcadeStoneId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return STONE_ID_PATTERN.test(id) ? id : null;
}

/**
 * Steinstufe als ganze Zahl in [1, MAX_SAFE_INTEGER]; 0 oder NaN wird 1.
 * @param {unknown} value
 */
export function normalizeArcadeStoneLevel(value) {
    return clampWhole(value, 1);
}

/**
 * Level eines Fahrzeugs aus seinem Profil (mindestens 1).
 * @param {unknown} profile
 */
export function resolveArcadeStoneVehicleLevel(profile) {
    return clampWhole(isRecord(profile) ? profile.level : 1, 1);
}

/**
 * @param {unknown} value
 * @returns {ArcadeStonePlacement|null}
 */
function normalizePlacement(value) {
    if (!isRecord(value)) return null;
    const vehicleId = String(value.vehicleId || '').trim();
    const slotId = String(value.slotId || '').trim();
    return vehicleId && ARCADE_STONE_SLOT_IDS.includes(slotId) ? { vehicleId, slotId } : null;
}

/**
 * Neuer Pool mit den Gratis-Steinen (Stufe 1, frei).
 * @param {number} [nowMs]
 * @returns {ArcadeStoneWorkshop}
 */
export function createArcadeStoneWorkshopRecord(nowMs = Date.now()) {
    const stones = [];
    for (let serial = 1; serial <= ARCADE_STONE_FREE_COUNT; serial += 1) {
        stones.push({ stoneId: formatStoneId(serial), level: 1, placement: null });
    }
    return {
        schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
        nextSerial: ARCADE_STONE_FREE_COUNT + 1,
        stones,
        updatedAt: toIsoString(nowMs),
    };
}

/**
 * Höchstens 21 Steine; bei doppelter ID gewinnt die erste, bei doppelter Platzierung verlieren
 * die späteren sie. Stufe 1..MAX_SAFE_INTEGER; nextSerial liegt über der höchsten Nummer.
 * @param {unknown} raw
 * @param {number} [nowMs]
 * @returns {ArcadeStoneWorkshop}
 */
export function normalizeArcadeStoneWorkshopRecord(raw, nowMs = Date.now()) {
    const source = isRecord(raw) ? raw : {};
    const seenIds = new Set();
    const taken = new Set();
    /** @type {ArcadeStone[]} */
    const stones = [];
    let highest = 0;
    for (const entry of Array.isArray(source.stones) ? source.stones : []) {
        if (stones.length >= ARCADE_STONE_MAX_OWNED) break;
        const stoneId = normalizeArcadeStoneId(isRecord(entry) ? entry.stoneId : null);
        if (!stoneId || seenIds.has(stoneId)) continue;
        seenIds.add(stoneId);
        let placement = normalizePlacement(entry.placement);
        const placeKey = placement ? `${placement.vehicleId}|${placement.slotId}` : '';
        if (placement && taken.has(placeKey)) placement = null;
        if (placement) taken.add(placeKey);
        stones.push({ stoneId, level: normalizeArcadeStoneLevel(entry.level), placement });
        highest = Math.max(highest, clampWhole(stoneId.slice('stone-'.length), 0));
    }
    return {
        schemaVersion: ARCADE_STONE_WORKSHOP_SCHEMA_VERSION,
        nextSerial: Math.max(clampWhole(source.nextSerial, 1), Math.min(MAX_SAFE, highest + 1)),
        stones,
        updatedAt: typeof source.updatedAt === 'string' && source.updatedAt ? source.updatedAt : toIsoString(nowMs),
    };
}

/**
 * Liest den Pool über readJsonRecordResult und schreibt nie. missing oder ein fremdes Schema liefern
 * einen neuen Pool (ohne Migration); ein Lesefehler oder kaputtes JSON sperrt die Steine
 * (unavailable: keine Käufe, kein Umstecken, nichts speichern), damit ein vorübergehender Fehler nie
 * einen ausgebauten Pool überschreibt.
 * @param {any} store
 * @param {number} [nowMs]
 * @returns {{ status: 'ok'|'created'|'unavailable', pool: ArcadeStoneWorkshop|null }}
 */
export function readArcadeStoneWorkshopRecord(store, nowMs = Date.now()) {
    const read = typeof store?.readJsonRecordResult === 'function'
        ? store.readJsonRecordResult(ARCADE_STONE_WORKSHOP_STORAGE_KEY)
        : null;
    if (read?.status === 'missing') return { status: 'created', pool: createArcadeStoneWorkshopRecord(nowMs) };
    if (read?.status !== 'found') return { status: 'unavailable', pool: null };
    if (!isRecord(read.value) || read.value.schemaVersion !== ARCADE_STONE_WORKSHOP_SCHEMA_VERSION) {
        return { status: 'created', pool: createArcadeStoneWorkshopRecord(nowMs) };
    }
    return { status: 'ok', pool: normalizeArcadeStoneWorkshopRecord(read.value, nowMs) };
}

/**
 * @param {any} store
 * @param {unknown} pool
 */
export function saveArcadeStoneWorkshopRecord(store, pool) {
    if (!isRecord(pool) || typeof store?.saveJsonRecord !== 'function') {
        return { success: false, reason: 'storage_unavailable' };
    }
    return store.saveJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, normalizeArcadeStoneWorkshopRecord(pool));
}

/** @param {any} result */
function isSaved(result) {
    return result === undefined || result === true || result?.success === true || result?.ok === true;
}

/**
 * Speichert ein Kaufergebnis in fester Reihenfolge: erst der Pool, dann das Profil. Scheitert der
 * Profilsave, wird der zuvor gelesene Pool zurückgeschrieben; scheitert auch das, meldet der Status
 * die verbleibende Pooländerung. Ergebnisse ohne Pool (Steinplatz-Pakete) speichern nur das Profil.
 * @param {any} store
 * @param {Partial<ArcadeStoneRuleResult>|null|undefined} result
 * @param {(profile: Record<string, any>) => unknown} saveProfile
 * @returns {{ ok: boolean, reason: string }}
 */
export function commitArcadeStoneWorkshopResult(store, result, saveProfile) {
    if (!result?.ok) return { ok: false, reason: String(result?.reason || 'invalid_result') };
    const previous = result.pool ? readArcadeStoneWorkshopRecord(store) : null;
    if (result.pool && previous?.status === 'unavailable') return { ok: false, reason: 'pool_read_failed' };
    if (result.pool && !isSaved(saveArcadeStoneWorkshopRecord(store, result.pool))) {
        return { ok: false, reason: 'pool_save_failed' };
    }
    if (result.next && typeof saveProfile === 'function') {
        const saved = saveProfile(result.next);
        if (!isSaved(saved)) {
            if (!result.pool) return { ok: false, reason: 'profile_save_failed' };
            return isSaved(saveArcadeStoneWorkshopRecord(store, previous.pool))
                ? { ok: false, reason: 'profile_save_failed' }
                : { ok: false, reason: 'profile_save_failed_pool_rollback_failed' };
        }
    }
    return { ok: true, reason: 'ok' };
}

/**
 * Gekaufte Steinplatz-Pakete eines Profils: bekannte IDs, ohne Doppel, in fester Reihenfolge.
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeArcadeStoneSlotPackages(value) {
    const owned = new Set(Array.isArray(value) ? value.map((entry) => String(entry)) : []);
    return ARCADE_STONE_PACKAGE_IDS.filter((packageId) => owned.has(packageId));
}

/** @param {unknown} packageId */
export function formatArcadeStonePackageLabel(packageId) {
    return PACKAGE_LABELS[/** @type {keyof typeof PACKAGE_LABELS} */ (String(packageId))] || String(packageId || '');
}

/**
 * Status eines Steinplatzes für ein Fahrzeug: frei nutzbar oder das Paket, das ihn öffnet.
 * @param {unknown} profile
 * @param {unknown} slotId
 * @returns {{ unlocked: boolean, packageId: string|null, requiredLevel: number, costXp: number }}
 */
export function resolveArcadeStoneSlotStatus(profile, slotId) {
    const id = String(slotId || '');
    const packageId = Object.keys(ARCADE_STONE_SLOT_PACKAGES).find((key) => (
        /** @type {Record<string, { slots: readonly string[] }>} */ (ARCADE_STONE_SLOT_PACKAGES)[key].slots.includes(id)
    )) || null;
    if (!packageId) return { unlocked: false, packageId: null, requiredLevel: 0, costXp: 0 };
    const pkg = /** @type {Record<string, { requiredLevel: number, costXp: number }>} */ (ARCADE_STONE_SLOT_PACKAGES)[packageId];
    const owned = packageId === 'base'
        || normalizeArcadeStoneSlotPackages(isRecord(profile) ? profile.stoneSlotPackages : null).includes(packageId);
    return { unlocked: owned, packageId, requiredLevel: pkg.requiredLevel, costXp: pkg.costXp };
}

/**
 * XP-Preis für das Aufwerten auf Stufe n: 100 * n², ohne Überlauf.
 * @param {unknown} level Zielstufe
 */
export function resolveArcadeStoneUpgradeCost(level) {
    const n = normalizeArcadeStoneLevel(level);
    return Math.min(MAX_SAFE, ARCADE_STONE_UPGRADE_COST_FACTOR_XP * n * n);
}

/**
 * Fahrzeuglevel, ab dem Stufe n kaufbar und voll nutzbar ist: 10 * (n - 1), T1 ab Level 1.
 * @param {unknown} level Steinstufe
 */
export function resolveArcadeStoneRequiredLevel(level) {
    const n = normalizeArcadeStoneLevel(level);
    return n <= 1 ? 1 : Math.min(MAX_SAFE, ARCADE_STONE_TIER_LEVEL_INTERVAL * (n - 1));
}

/**
 * Höchste Steinstufe, die ein Fahrzeug dieses Levels nutzen kann: 1 + floor(Level / 10).
 * @param {unknown} vehicleLevel
 */
export function resolveArcadeStoneLevelCap(vehicleLevel) {
    return Math.min(MAX_SAFE, 1 + Math.floor(clampWhole(vehicleLevel, 1) / ARCADE_STONE_TIER_LEVEL_INTERVAL));
}

/**
 * @param {string} reason
 * @param {number} [cost]
 * @returns {ArcadeStoneRuleResult}
 */
function reject(reason, cost = 0) {
    return { ok: false, reason, cost, next: null, pool: null };
}

/**
 * Kauf eines neuen Steins (Stufe 1, frei) für 200 XP des ausgewählten Fahrzeugs; höchstens 21.
 * @param {unknown} pool
 * @param {unknown} profile
 * @param {number} [nowMs]
 * @returns {ArcadeStoneRuleResult}
 */
export function evaluateArcadeStonePurchase(pool, profile, nowMs = Date.now()) {
    if (!isRecord(pool)) return reject('storage_unavailable');
    const current = normalizeArcadeStoneWorkshopRecord(pool, nowMs);
    const serial = current.nextSerial;
    // A saturated serial could only repeat an existing ID; refuse instead of paying for a lost stone.
    const taken = current.stones.some((entry) => entry.stoneId === formatStoneId(serial));
    if (current.stones.length >= ARCADE_STONE_MAX_OWNED || taken) return reject('stone_limit', ARCADE_STONE_PRICE_XP);
    const paid = spendArcadeVehicleXp(isRecord(profile) ? profile : {}, ARCADE_STONE_PRICE_XP, {});
    if (!paid.ok) return { ...paid, pool: null };
    return {
        ...paid,
        pool: {
            ...current,
            nextSerial: Math.min(MAX_SAFE, serial + 1),
            stones: [...current.stones, { stoneId: formatStoneId(serial), level: 1, placement: null }],
            updatedAt: toIsoString(nowMs),
        },
    };
}

/**
 * Aufwerten eines Steins um eine Stufe. Kaufbar, sobald das bezahlende Fahrzeug das Level der
 * Zielstufe hat; die volle Wirkung hängt davon ab, wo der Stein steckt (siehe Platzierung).
 * @param {unknown} pool
 * @param {unknown} profile
 * @param {unknown} stoneId
 * @param {number} [nowMs]
 * @returns {ArcadeStoneRuleResult}
 */
export function evaluateArcadeStoneUpgrade(pool, profile, stoneId, nowMs = Date.now()) {
    if (!isRecord(pool)) return reject('storage_unavailable');
    const current = normalizeArcadeStoneWorkshopRecord(pool, nowMs);
    const id = normalizeArcadeStoneId(stoneId);
    const index = current.stones.findIndex((entry) => entry.stoneId === id);
    if (index < 0) return reject('unknown_stone');
    const stone = current.stones[index];
    const target = Math.min(MAX_SAFE, stone.level + 1);
    const cost = resolveArcadeStoneUpgradeCost(target);
    const requiredLevel = resolveArcadeStoneRequiredLevel(target);
    if (target === stone.level || resolveArcadeStoneVehicleLevel(profile) < requiredLevel) {
        return { ...reject('stone_level_locked', cost), requiredLevel };
    }
    const paid = spendArcadeVehicleXp(isRecord(profile) ? profile : {}, cost, {});
    if (!paid.ok) return { ...paid, pool: null, requiredLevel };
    const stones = current.stones.slice();
    stones[index] = { ...stone, level: target };
    return { ...paid, pool: { ...current, stones, updatedAt: toIsoString(nowMs) }, requiredLevel };
}

/**
 * Kauf eines Steinplatz-Pakets (Flügel, Antriebe, Utility) ab seinem Level mit XP.
 * @param {unknown} profile
 * @param {unknown} packageId
 * @returns {ArcadeStoneRuleResult}
 */
export function evaluateArcadeStoneSlotPackagePurchase(profile, packageId) {
    const id = String(packageId || '').trim();
    if (id === 'base') return reject('already_owned');
    if (!ARCADE_STONE_PACKAGE_IDS.includes(id)) return reject('unknown_package');
    const pkg = /** @type {Record<string, { requiredLevel: number, costXp: number }>} */ (ARCADE_STONE_SLOT_PACKAGES)[id];
    const source = isRecord(profile) ? profile : {};
    const owned = normalizeArcadeStoneSlotPackages(source.stoneSlotPackages);
    if (owned.includes(id)) return reject('already_owned');
    if (resolveArcadeStoneVehicleLevel(source) < pkg.requiredLevel) {
        return { ...reject('package_level_locked', pkg.costXp), requiredLevel: pkg.requiredLevel };
    }
    const paid = spendArcadeVehicleXp(source, pkg.costXp, { stoneSlotPackages: normalizeArcadeStoneSlotPackages([...owned, id]) });
    return { ...paid, pool: null, requiredLevel: pkg.requiredLevel };
}

/**
 * Was ein Level-Aufstieg von priorLevel auf newLevel neu erreichbar macht: kaufbare Steinplatz-
 * Pakete und nutzbare Steinstufen (T2 ab Level 10 ...). Riesige Sprünge listen höchstens 20 Stufen.
 * @param {unknown} priorLevel
 * @param {unknown} newLevel
 * @returns {{ packages: string[], tiers: string[] }}
 */
export function listArcadeStoneUnlocksBetween(priorLevel, newLevel) {
    const from = clampWhole(priorLevel, 1);
    const to = clampWhole(newLevel, 1);
    const packages = ARCADE_STONE_PACKAGE_IDS.filter((id) => {
        const required = /** @type {Record<string, { requiredLevel: number }>} */ (ARCADE_STONE_SLOT_PACKAGES)[id].requiredLevel;
        return required > from && required <= to;
    });
    const tiers = [];
    const lastTier = resolveArcadeStoneLevelCap(to);
    for (let tier = resolveArcadeStoneLevelCap(from) + 1; tier <= lastTier && tiers.length < MAX_LISTED_TIERS; tier += 1) {
        tiers.push(`T${tier}`);
    }
    return { packages, tiers };
}
