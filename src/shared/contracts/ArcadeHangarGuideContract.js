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
    const pending = [...savings, ...gates].sort((a, b) => a.gap - b.gap || (a.group === b.group ? tie(a, b) : a.group === 'save' ? -1 : 1));
    if (pending.length) return goal(pending[0], pending[0].group, `Noch ${Math.ceil(pending[0].gap)} XP im nächsten Run verdienen.`);
    if (snapshot.achievement) return goal(snapshot.achievement, 'run', snapshot.achievement.detail);
    const weapon = offers.filter(item => item.costXp <= bank).sort((a, b) => a.costXp - b.costXp || tie(a, b))[0];
    if (weapon) return goal(weapon, 'purchase', `${weapon.costXp} XP · verfügbar: ${bank} XP`);
    return goal({ id: 'start-run', system: 'run', areaId: 'run', label: 'Starte einen Arcade-Run' }, 'fallback', 'Fliege deinen aktiven Build und sammle XP.');
}
