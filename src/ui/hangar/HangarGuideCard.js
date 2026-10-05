import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { ARCADE_HANGAR_TUTORIAL_STEPS, loadArcadeHangarGuideRecord, saveArcadeHangarGuideRecord, finishArcadeHangarTutorial, resolveArcadeHangarNextGoal } from '../../shared/contracts/ArcadeHangarGuideContract.js';
import { createHangarGuideSnapshot } from './HangarGuideSnapshot.js';

/** @param {{shell:any, bind:Function, store:any, getState:Function, getProfile:Function}} options */
export function createHangarGuideCard({ shell, bind, store, getState, getProfile }) {
    const root = el('section', 'hangar-guide-card');
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Nächstes Ziel');
    const label = el('strong', 'hangar-guide-title'); label.setAttribute('aria-live', 'polite');
    const detail = el('span', 'hangar-guide-detail');
    const locks = el('p', 'hangar-guide-locks');
    const controls = el('div', 'hangar-guide-actions');
    const button = text => { const node = el('button', 'secondary-btn', text); node.type = 'button'; return node; };
    const show = button('Zeigen'), replay = button('Einführung');
    controls.append(show, replay);
    const goalLine = el('div', 'hangar-guide-goal'); goalLine.append(label, detail);
    const tutorial = el('section', 'hangar-guide-tutorial'); tutorial.setAttribute('aria-label', 'Hangar-Einführung');
    const tutorialText = el('p', 'hangar-guide-tutorial-text'); tutorialText.setAttribute('aria-live', 'polite');
    const next = button('Weiter'), skip = button('Überspringen');
    tutorial.append(tutorialText, next, skip);
    root.append(goalLine, controls, locks, tutorial);
    shell.container.children[0].append(root);
    let record = loadArcadeHangarGuideRecord(store);
    const previousVisitAt = record?.lastVisitAt;
    if (record) { record = { ...record, lastVisitAt: Date.now() }; saveArcadeHangarGuideRecord(store, record); }
    let step = record?.tutorial === 'pending' ? 0 : -1;
    let currentGoal = null, timer = 0, highlighted = null;

    function targetFor(areaId) {
        const external = id => document.getElementById?.(id) || null;
        if (areaId === 'run' || areaId === 'difficulty') return { tab: null, target: external('hangar-window-close'), leave: true };
        if (areaId === 'lab') return { tab: null, target: external('hangar-window-open-lab'), leave: true };
        if (areaId === 'vehicles') return { tab: null, target: shell.catalogList };
        if (areaId === 'colors') return { tab: shell.formViewButton, target: shell.formViewPanel };
        const selector = { stones: '.hangar-stone-panel', size: '.hangar-size-panel', storage: '.hangar-size-shop', weapons: '.hangar-arcade-weapons' }[areaId];
        return { tab: shell.upgradeViewButton, target: selector ? shell.upgradeViewPanel.querySelector?.(selector) || shell.upgradeViewPanel : null };
    }
    function clearHighlight() { if (timer) window.clearTimeout(timer); highlighted?.classList.remove('is-guide-highlight'); timer = 0; highlighted = null; }
    function reveal(areaId) {
        const route = targetFor(areaId);
        if (!route.target) return;
        if (route.leave) { route.target.click(); return; }
        route.tab?.click(); clearHighlight(); highlighted = route.target;
        highlighted.classList.add('is-guide-highlight'); highlighted.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        timer = window.setTimeout(clearHighlight, 2000);
    }
    function renderTutorial() {
        tutorial.classList.toggle('hidden', step < 0);
        if (step < 0) return;
        const entry = ARCADE_HANGAR_TUTORIAL_STEPS[step];
        tutorialText.textContent = `${step + 1}/${ARCADE_HANGAR_TUTORIAL_STEPS.length} · ${entry.title}: ${entry.text}`;
        next.textContent = step === ARCADE_HANGAR_TUTORIAL_STEPS.length - 1 ? 'Fertig' : 'Weiter';
    }
    function finish(outcome) {
        const updated = finishArcadeHangarTutorial(record, outcome);
        if (saveArcadeHangarGuideRecord(store, updated)) record = updated;
        step = -1; renderTutorial();
    }
    bind(show, 'click', () => { if (currentGoal) reveal(currentGoal.areaId); });
    bind(replay, 'click', () => { step = 0; renderTutorial(); reveal(ARCADE_HANGAR_TUTORIAL_STEPS[step].areaId); });
    bind(skip, 'click', () => finish('skipped'));
    bind(next, 'click', () => {
        if (step === ARCADE_HANGAR_TUTORIAL_STEPS.length - 1) finish('completed');
        else { step += 1; renderTutorial(); reveal(ARCADE_HANGAR_TUTORIAL_STEPS[step].areaId); }
    });
    renderTutorial();
    return { render() {
        const state = getState();
        const snapshot = createHangarGuideSnapshot({ store, profiles: state.profiles, profile: getProfile(), draft: state.draft, previousVisitAt });
        currentGoal = resolveArcadeHangarNextGoal(snapshot);
        root.dataset.goalId = currentGoal.id;
        label.textContent = `Nächstes Ziel: ${currentGoal.title}`; detail.textContent = currentGoal.detail;
        locks.textContent = snapshot.lockedSummary;
        show.disabled = !targetFor(currentGoal.areaId).target;
        const labButton = document.getElementById?.('hangar-window-open-lab');
        if (labButton) { labButton.textContent = snapshot.labUnlocked ? 'Arcade-Lab' : `Arcade-Lab · ${snapshot.fleet.qualifiedIds.length}/${snapshot.fleet.required}`; labButton.title = snapshot.labUnlocked ? 'Eigene Arcade-Schiffe bauen' : 'Sechs Werksschiffe in allen Gruppen gleichzeitig auf 125 % ausbauen.'; }
    }, dispose: clearHighlight };
}
