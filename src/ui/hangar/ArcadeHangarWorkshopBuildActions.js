import { resolveHangarPart } from './HangarPartCatalog.js';
import { installHangarPart, removeHangarPart } from './HangarBuildDraftState.js';
import { describeHangarDropFailure as describeDropFailure } from './HangarBuildValidation.js';
import { createHangarStarterBuild } from './HangarStarterBuildCatalog.js';
import { validateFightHangarDrop } from './FightHangarValidation.js';
import { normalizeFightMachineGunId, resolveFightMachineGunModel } from '../../shared/contracts/FightMachineGunContract.js';

/**
 * Edits of the draft build: installing and removing stones or parts, the quick upgrade, the
 * part and slot selection, the starter builds and the Fight machine gun.
 *
 * Call it after the shell exists. The functions reach the other modules through `api`, which
 * the controller fills before anything runs.
 */
export function createWorkshopBuildActions(st, api) {
    const { hangarMode, audio } = st;
    const { pairToggle } = st.shell;

    function installWithPair(build, partId, slotId) {
        const part = resolveHangarPart(partId);
        return installHangarPart(build, partId, slotId, { pair: pairToggle.checked && part?.symmetric === true });
    }

    function evaluateInstall(partId, slotId) {
        return hangarMode === 'fight'
            ? validateFightHangarDrop(st.draft, partId, slotId, installWithPair)
            : st.stonePanel.evaluateInstall(st.draft, partId, slotId);
    }

    function applyInstall(partId, slotId) {
        const result = evaluateInstall(partId, slotId);
        if (!result.ok) {
            api.toast(describeDropFailure(result), 'warning');
            return false;
        }
        st.selectedSlotId = slotId;
        st.selectedPartId = '';
        st.previewPartId = '';
        api.setDraft(result.build, { changedSlots: result.changedSlots });
        audio.play('drop');
        api.toast(`${(st.stonePanel?.resolveStone(partId) || resolveHangarPart(partId))?.label || partId} eingesetzt`, 'success');
        return true;
    }

    function evaluateRemoval(slotId) {
        if (st.stonePanel) return st.stonePanel.evaluateRemoval(st.draft, slotId);
        const removal = removeHangarPart(st.draft, slotId, { pair: pairToggle.checked });
        if (!removal.ok) return removal;
        const profile = api.profileFor(st.draft.vehicleId);
        const validation = api.validateForMode(removal.build, profile.level, profile);
        return validation.ok
            ? { ...validation, ok: true, build: removal.build }
            : { ...validation, ok: false, code: validation.errors[0]?.code, message: validation.errors[0]?.message };
    }

    function applyRemoval(slotId) {
        const result = evaluateRemoval(slotId);
        if (!result.ok) {
            api.toast(describeDropFailure(result), 'warning');
            return false;
        }
        api.setDraft(result.build, { changedSlots: result.changedSlots });
        audio.play('drop');
        api.toast('Stein entfernt');
        return true;
    }

    function quickUpgrade(slotId) {
        const part = resolveHangarPart(st.draft.slots[slotId]);
        if (part?.upgradeTo) applyInstall(part.upgradeTo, slotId);
    }

    function selectPart(partId) {
        const part = st.stonePanel ? st.stonePanel.resolveStone(partId) : resolveHangarPart(partId);
        if (!part) return;
        st.buildView = st.slotView;
        st.selectedPartId = st.selectedPartId === part.id ? '' : part.id;
        st.previewPartId = st.selectedPartId;
        if (st.selectedPartId && !part.compatibleSlots.includes(st.selectedSlotId)) st.selectedSlotId = part.compatibleSlots[0];
        api.toast(st.selectedPartId ? `${part.label} ausgewählt · jetzt Fassung anklicken` : 'Steinauswahl aufgehoben');
        api.syncDisplay();
    }

    function selectMachineGun(machineGunId) {
        if (hangarMode !== 'fight') return;
        const id = normalizeFightMachineGunId(machineGunId);
        if (st.draft.machineGunId === id) return;
        api.setDraft({ ...st.draft, machineGunId: id, updatedAtMs: Math.max(st.draft.updatedAtMs + 1, Date.now()) });
        api.toast(`${resolveFightMachineGunModel(id).label} ausgewählt`, 'success');
    }

    function handleSlotSelection(slotId) {
        st.buildView = st.slotView;
        if (st.selectedPartId) {
            applyInstall(st.selectedPartId, slotId);
            return;
        }
        st.selectedSlotId = slotId;
        st.viewport.setSelectedSlot(slotId);
        api.syncDisplay();
    }

    function applyStarterBuild(presetId) {
        const profile = api.profileFor(st.draft.vehicleId);
        const level = profile.level;
        const starter = createHangarStarterBuild(st.draft, presetId, level);
        if (!starter) return;
        const validation = api.validateForMode(starter, level, profile);
        if (!validation.ok) {
            api.toast(`Starter-Build ist noch gesperrt: ${validation.errors[0]?.message || ''}`, 'warning');
            return;
        }
        st.selectedPartId = '';
        st.previewPartId = '';
        api.setDraft(starter, { changedSlots: Object.keys(starter.slots) });
        api.toast(`${starter.name} geladen`, 'success');
    }

    return {
        evaluateInstall,
        applyInstall,
        evaluateRemoval,
        applyRemoval,
        quickUpgrade,
        selectPart,
        selectMachineGun,
        handleSlotSelection,
        applyStarterBuild,
    };
}
