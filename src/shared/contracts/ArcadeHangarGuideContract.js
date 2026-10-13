import { ARCADE_PART_SIZE_GROUPS } from './ArcadeVehicleSizeContract.js';
import { normalizeArcadeSizeProfileFields, resolveArcadeSpendableXp, evaluateArcadeSizeUnlock, evaluateArcadeSizeStepPurchase, resolveArcadeStorageOffer } from './ArcadeVehicleBuildContract.js';
import { ARCADE_STONE_SLOT_IDS, ARCADE_STONE_PACKAGE_IDS, readArcadeStoneWorkshopRecord, resolveArcadeStoneSlotStatus, evaluateArcadeStonePurchase, evaluateArcadeStoneSlotPackagePurchase, evaluateArcadeStoneUpgrade } from './ArcadeStoneWorkshopContract.js';
import { ARCADE_COLOR_REQUIREMENTS, loadArcadeColors, listUnlockedArcadeColors } from './ArcadeColorProgressContract.js';
import { loadArcadeDifficultyProgress, ARCADE_DIFFICULTY_TIERS } from './ArcadeDifficultyContract.js';
import { evaluateArcadeLabUnlock, normalizeArcadeLabUnlockRecord, ARCADE_LAB_UNLOCK_STORAGE_KEY } from './ArcadeLabUnlockContract.js';
import { arcadeVehicleXpForLevel } from './ArcadeVehicleProfileContract.js';
import { ARCADE_MACHINE_GUN_MODELS, evaluateArcadeWeaponLevelPurchase, resolveArcadeMachineGunUnlockLevel } from './ArcadeMachineGunContract.js';

export const ARCADE_HANGAR_GUIDE_STORAGE_KEY = 'cuviosclash.arcade-hangar-guide.v1';
export const ARCADE_HANGAR_GUIDE_SCHEMA_VERSION = 'arcade-hangar-guide.v1';
export const ARCADE_HANGAR_TUTORIAL_STEPS = Object.freeze([
    { areaId: 'vehicles', title: 'Deine Flotte', text: 'Jedes Schiff sammelt eigene XP. Wähle hier das Schiff für deinen nächsten Run.' },
    { areaId: 'stones', title: 'Steine einsetzen', text: 'Drei Steine sind kostenlos. Setze sie in freie Fassungen. Erst Aktivieren übernimmt deinen Entwurf für den nächsten Run.' },
    { areaId: 'size', title: 'Mit XP ausbauen', text: 'Größe und Lager verbessern echte Flugwerte. Gekaufte Größenschritte kannst du kostenlos umverteilen; die Vorschau zeigt die Folgen.' },
    { areaId: 'weapons', title: 'Deine Waffen', text: 'Wähle ein freigeschaltetes MG. MG, Raketen und Schild besitzen getrennte Ausbaustufen.' },
    { areaId: 'colors', title: 'Dein Aussehen', text: 'Run-Erfolge öffnen Farben für alle deine Schiffe. Titel, Abzeichen und Muster kosten keine XP. Der Testflug vergibt weder XP noch Rekorde.' },
]);

export function toArcadeGuideTimeMs(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value ? Date.parse(value) : NaN;
}

/** Snapshot reads contracts only; it never initializes or saves records.
 * @param {{store:any, profile:any, profiles:any, draft:any, previousVisitAt:any}} options */
export function createArcadeHangarGuideSnapshot({ store, profile, profiles, draft, previousVisitAt }) {
    const previous = toArcadeGuideTimeMs(previousVisitAt);
    const isNew = value => Number.isFinite(previous) && previous > 0 && toArcadeGuideTimeMs(value) > previous;
    const sizes = normalizeArcadeSizeProfileFields(profile);
    const spent = ARCADE_PART_SIZE_GROUPS.reduce((sum, group) => sum + Math.max(0, (sizes.partSizes[group] - 100) / 5), 0);
    const read = readArcadeStoneWorkshopRecord(store);
    const available = read.status !== 'unavailable';
    const stones = read.pool?.stones || [];
    const draftStoneIds = new Set(Object.values(draft?.stoneSlots || {}).filter(Boolean));
    const unplacedCount = stones.filter(stone => !stone.placement && !draftStoneIds.has(stone.stoneId)).length;
    const freeSlots = ARCADE_STONE_SLOT_IDS.filter(id => resolveArcadeStoneSlotStatus(profile, id).unlocked && !draft?.stoneSlots?.[id]);
    const offers = [], levelGates = [];
    const offer = (id, system, areaId, label, result, finite = true) => { if (result.cost > 0 && ['ok','insufficient_xp'].includes(result.reason)) offers.push({ id, system, areaId, label, costXp: result.cost, finite }); };
    if (!sizes.sizeWorkshopUnlocked) offer('size-unlock', 'size', 'size', 'Größenumbau freischalten', evaluateArcadeSizeUnlock(profile));
    else {
        offer('size-step', 'size', 'size', 'Einen Größenschritt kaufen', evaluateArcadeSizeStepPurchase(profile));
        for (const storage of ['items','rockets']) {
            const next = resolveArcadeStorageOffer(profile, storage);
            if (next?.utilityReached) offers.push({ id: storage, system: 'storage', areaId: 'storage', label: `${storage === 'items' ? 'Item' : 'Raketen'}-Lager erweitern`, costXp: next.cost });
        }
    }
    const gate = (id, system, areaId, label, level, finite = true) => { if (level > profile.level) levelGates.push({ id, system, areaId, label, finite, xpNeeded: Math.max(0, arcadeVehicleXpForLevel(level) - profile.xp) }); };
    const milestoneLevel = Math.min(Number.MAX_SAFE_INTEGER, (Math.floor(profile.level / 10) + 1) * 10);
    gate('next-milestone', 'cosmetics', 'colors', `Nächsten Meilenstein auf Level ${milestoneLevel} erreichen`, milestoneLevel, false);
    for (const gun of ARCADE_MACHINE_GUN_MODELS) gate(`unlock-${gun.id}`, 'weapons', 'weapons', `${gun.label} freischalten`, resolveArcadeMachineGunUnlockLevel(profile.vehicleId, gun.id));
    if (available) {
        if (unplacedCount === 0 && freeSlots.length) offer('buy-stone', 'stones', 'stones', 'Einen Stein für eine freie Fassung kaufen', evaluateArcadeStonePurchase(read.pool, profile));
        for (const id of ARCADE_STONE_PACKAGE_IDS) {
            const result = evaluateArcadeStoneSlotPackagePurchase(profile, id);
            offer(`slots-${id}`, 'stones', 'stones', `Weitere ${id === 'wings' ? 'Flügel' : id === 'engines' ? 'Antrieb' : 'Utility'}-Fassungen kaufen`, result);
            if (result.reason === 'package_level_locked') gate(`slots-${id}`, 'stones', 'stones', `Neue Fassungen ab Level ${result.requiredLevel}`, result.requiredLevel);
        }
        for (const stone of stones.filter(stone => stone.placement?.vehicleId === profile.vehicleId || draftStoneIds.has(stone.stoneId))) {
            const result = evaluateArcadeStoneUpgrade(read.pool, profile, stone.stoneId);
            offer(`stone-${stone.stoneId}`, 'stones', 'stones', 'Einen eingebauten Stein aufwerten', result, false);
            if (result.reason === 'stone_level_locked') gate(`stone-${stone.stoneId}`, 'stones', 'stones', `Steine aufwerten ab Level ${result.requiredLevel}`, result.requiredLevel, false);
        }
    }
    for (const [kind, label] of [['mg', 'MG'], ['rocket', 'Raketen'], ['shield', 'Schild']]) {
        const result = evaluateArcadeWeaponLevelPurchase(profile, kind);
        if (result.cost > 0) offers.push({ id: `weapon-${kind}`, system: 'weapons', areaId: 'weapons', label: `${label} um eine Stufe ausbauen`, costXp: result.cost, finite: false });
    }
    const colors = loadArcadeColors(store);
    const unlockedColors = listUnlockedArcadeColors(colors);
    const missingColor = Object.keys(ARCADE_COLOR_REQUIREMENTS).find(id => !unlockedColors.includes(id));
    const difficulty = loadArcadeDifficultyProgress(store).progress;
    const newDifficulty = ARCADE_DIFFICULTY_TIERS.findLast(tier => difficulty?.unlockedTierIds.includes(tier.id) && isNew(difficulty.unlockedAt?.[tier.id]));
    let lab = null;
    try { lab = normalizeArcadeLabUnlockRecord(store?.loadJsonRecord?.(ARCADE_LAB_UNLOCK_STORAGE_KEY, null)); } catch { /* unavailable */ }
    const fleet = evaluateArcadeLabUnlock(profiles);
    return { vehicleId: profile.vehicleId, xpBank: resolveArcadeSpendableXp(profile),
        stones: { available, unplacedCount, freeSlotCount: freeSlots.length },
        size: { unlocked: sizes.sizeWorkshopUnlocked, freeSteps: Math.max(0, sizes.purchasedSizeSteps - spent), canPlace: ARCADE_PART_SIZE_GROUPS.some(group => sizes.partSizes[group] < 125) },
        offers, levelGates, newDifficulty, newColorIds: unlockedColors.filter(id => isNew(colors?.unlockedAt?.[id])),
        labUnlockedNew: lab?.unlocked === true && isNew(lab.unlockedAtMs), labUnlocked: lab?.unlocked === true, fleet,
        achievement: missingColor ? { id: missingColor, system: 'cosmetics', areaId: 'colors', label: `${missingColor[0].toUpperCase() + missingColor.slice(1)} freispielen`, detail: ARCADE_COLOR_REQUIREMENTS[missingColor] } : null,
        lockedSummary: `Hart/Albtraum: vorherige Stufe gewinnen (Gauntlet: 5 Sektoren, Arena: 8 abgeschlossene Wellen, Endless: 5). Lab: ${fleet.qualifiedIds.length}/${fleet.required} Werksschiffe in allen Gruppen bei 125 %.` };
}
export function createArcadeHangarGuideRecord() {
    return { schemaVersion: ARCADE_HANGAR_GUIDE_SCHEMA_VERSION, tutorial: 'pending', tutorialFinishedAt: '', lastVisitAt: 0 };
}
/** @param {any} raw */
export function normalizeArcadeHangarGuideRecord(raw) {
    if (raw == null) return createArcadeHangarGuideRecord();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== ARCADE_HANGAR_GUIDE_SCHEMA_VERSION) return null;
    return { ...raw, tutorial: ['pending', 'completed', 'skipped'].includes(raw.tutorial) ? raw.tutorial : 'pending' };
}
/** @param {any} store */
export function loadArcadeHangarGuideRecord(store) {
    try {
        const read = store?.readJsonRecordResult?.(ARCADE_HANGAR_GUIDE_STORAGE_KEY);
        if (read && read.status !== 'missing' && (read.status !== 'found' || read.value == null)) return null;
        return normalizeArcadeHangarGuideRecord(read?.status === 'found' ? read.value : store?.loadJsonRecord?.(ARCADE_HANGAR_GUIDE_STORAGE_KEY, null));
    } catch { return null; }
}
/** @param {any} store @param {any} record */
export function saveArcadeHangarGuideRecord(store, record) {
    if (!record || !loadArcadeHangarGuideRecord(store)) return false;
    try { const result = store?.saveJsonRecord?.(ARCADE_HANGAR_GUIDE_STORAGE_KEY, record); return result === true || result?.success === true || result?.ok === true; }
    catch { return false; }
}
/** @param {any} record @param {'completed'|'skipped'} outcome */
export function finishArcadeHangarTutorial(record, outcome, nowMs = Date.now()) {
    const previous = normalizeArcadeHangarGuideRecord(record);
    return previous ? { ...previous, tutorial: outcome, tutorialFinishedAt: new Date(nowMs).toISOString() } : null;
}
const SYSTEMS = ['size', 'storage', 'stones', 'weapons', 'difficulty', 'lab', 'cosmetics'];
/** @param {any} a @param {any} b */
function tie(a, b) { return SYSTEMS.indexOf(a.system) - SYSTEMS.indexOf(b.system) || String(a.id).localeCompare(String(b.id)); }
/** @param {any} item */
function goal(item, group, detail = '') { return { id: item.id, system: item.system, areaId: item.areaId, title: item.label, group, detail }; }

/** Pure choice: no purchases, writes or unbounded weapon offers before finite workshop goals.
 * @param {any} snapshot */
export function resolveArcadeHangarNextGoal(snapshot = {}) {
    const bank = Math.max(0, Number(snapshot.xpBank) || 0);
    if (snapshot.stones?.available && snapshot.stones.unplacedCount > 0 && snapshot.stones.freeSlotCount > 0)
        return goal({ id: 'place-stone', system: 'stones', areaId: 'stones', label: 'Einen kostenlosen Stein einsetzen' }, 'free', `${snapshot.stones.unplacedCount} Steine warten im Vorrat. Danach den Build aktivieren.`);
    if (snapshot.size?.unlocked && snapshot.size.freeSteps > 0 && snapshot.size.canPlace)
        return goal({ id: 'place-size', system: 'size', areaId: 'size', label: 'Freie Größenschritte verteilen' }, 'free', `${snapshot.size.freeSteps} bereits gekaufte Schritte sind frei.`);
    if (snapshot.newDifficulty) return goal({ id: 'new-tier', system: 'difficulty', areaId: 'difficulty', label: `${snapshot.newDifficulty.label} ausprobieren` }, 'free', 'Die Run-Stufe ist neu freigeschaltet.');
    if (snapshot.labUnlockedNew) return goal({ id: 'new-lab', system: 'lab', areaId: 'lab', label: 'Dein erstes eigenes Schiff bauen' }, 'free', 'Das Arcade-Lab ist jetzt frei.');
    if (snapshot.newColorIds?.length) return goal({ id: 'new-color', system: 'cosmetics', areaId: 'colors', label: 'Eine neue Farbe ausprobieren' }, 'free', snapshot.newColorIds.join(', '));
    const offers = (snapshot.offers || []).filter(item => Number.isFinite(item.costXp) && item.costXp > 0);
    const finite = offers.filter(item => item.finite !== false);
    const affordable = finite.filter(item => item.costXp <= bank).sort((a, b) => a.costXp - b.costXp || tie(a, b));
    if (affordable.length) return goal(affordable[0], 'purchase', `${affordable[0].costXp} XP · verfügbar: ${bank} XP`);
    const savings = finite.filter(item => item.costXp > bank).map(item => ({ ...item, gap: item.costXp - bank, group: 'save' }));
    const gates = (snapshot.levelGates || []).filter(item => item.xpNeeded > 0).map(item => ({ ...item, gap: item.xpNeeded, group: 'level' }));
    const byGap = (a, b) => a.gap - b.gap || (a.group === b.group ? tie(a, b) : a.group === 'save' ? -1 : 1);
    const pending = [...savings, ...gates.filter(item => item.finite !== false)].sort(byGap);
    if (pending.length) return goal(pending[0], pending[0].group, `Noch ${Math.ceil(pending[0].gap)} XP im nächsten Run verdienen.`);
    if (snapshot.achievement) return goal(snapshot.achievement, 'run', snapshot.achievement.detail);
    const upgrade = offers.filter(item => item.finite === false && item.costXp <= bank).sort((a, b) => a.costXp - b.costXp || tie(a, b))[0];
    if (upgrade) return goal(upgrade, 'purchase', `${upgrade.costXp} XP · verfügbar: ${bank} XP`);
    const recurring = [...gates.filter(item => item.finite === false), ...offers.filter(item => item.finite === false && item.costXp > bank).map(item => ({ ...item, gap: item.costXp - bank, group: 'save' }))].sort(byGap);
    if (recurring.length) return goal(recurring[0], recurring[0].group, `Noch ${Math.ceil(recurring[0].gap)} XP im nächsten Run verdienen.`);
    return goal({ id: 'start-run', system: 'run', areaId: 'run', label: 'Starte einen Arcade-Run' }, 'fallback', 'Fliege deinen aktiven Build und sammle XP.');
}
