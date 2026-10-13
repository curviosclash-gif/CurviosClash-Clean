import { persistHangarVehicleSelection } from './HangarWindowSettingsSync.js';
import { normalizeVehicleValue as norm } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { validateFightHangarBuild } from './FightHangarValidation.js';
import { normalizeFightMachineGunId } from '../../shared/contracts/FightMachineGunContract.js';
import { loadArcadeColors } from '../../shared/contracts/ArcadeColorProgressContract.js';
import {
    selectArcadeTrailStyle,
    selectArcadeWeaponStyle,
} from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';

/**
 * Arcade vehicle profile of the hangar workshop: loading and saving through the profile port,
 * the rollback after a failed save, the vehicle writeback into the settings, the cosmetic
 * styles and the commit of a build for the next run.
 *
 * Call it after the shell exists. The functions reach the other modules through `api`, which
 * the controller fills before anything runs.
 */
export function createWorkshopProfileActions(st, api) {
    const { hangarMode, profilePort, settings, runtimeAccess, ui, store, bind } = st;

    function persistProfiles() {
        let saved = false;
        let reason = '';
        try {
            const result = profilePort.save(st.profiles);
            saved = result === true || result?.success === true || result?.ok === true;
            reason = String(result?.reason || '');
        } catch {
            saved = false;
        }
        // Another window spent the same bank XP: our copy is stale, so take the stored state.
        st.bankConflict = !saved && reason === 'bank_conflict';
        st.unsavedProfileEdits = !saved && !st.bankConflict;
        // The save merged onto the stored record; reload so XP a run earned meanwhile shows here.
        if (saved || st.bankConflict) st.profiles = profilePort.load();
        return saved;
    }

    // The hangar window stays open beside a run: pick up profile writes from the other window.
    function bindProfileStorageSync() {
        if (hangarMode !== 'arcade') return;
        bind(globalThis, 'storage', (event) => {
            if (st.disposed || st.unsavedProfileEdits) return;
            if (event?.key && !/arcade-vehicle-profile\.v\d+$/.test(String(event.key))) return;
            st.profiles = profilePort.load();
            api.syncDisplay({ preserveCatalog: true });
        });
    }

    function reportProfileSaveFailure(message = 'Profil konnte nicht gespeichert werden. Änderungen bleiben nur bis zum Schließen dieses Hangars verfügbar.') {
        api.toast(st.bankConflict ? 'Bank reicht nicht mehr – Stand neu geladen.' : message, 'error');
    }

    function profileFor(vehicleId) {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        if (hangarMode === 'fight') {
            return {
                vehicleId: id,
                level: 30,
                xp: 0,
                xpBank: 0,
                masteryMilestones: [],
                fightUnlimitedInventory: true,
            };
        }
        st.profiles[id] = profilePort.getOrCreate(st.profiles, id);
        return st.profiles[id];
    }

    function getProfile() {
        return profileFor(st.draft.vehicleId);
    }

    function syncVehicleWriteback(vehicleId) {
        const id = norm(vehicleId, 'ship5').toLowerCase();
        persistHangarVehicleSelection({ settings, runtimeAccess, vehicleId: id, mode: hangarMode });
        const hasOption = Array.from(ui.vehicleSelectP1?.options || []).some((option) => option.value === id);
        if (hasOption && ui.vehicleSelectP1.value !== id) {
            ui.vehicleSelectP1.value = id;
            ui.vehicleSelectP1.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return id;
    }

    function saveProfile(next) {
        const vehicleId = st.draft.vehicleId;
        const hadPrevious = Object.prototype.hasOwnProperty.call(st.profiles, vehicleId);
        const previous = st.profiles[vehicleId];
        st.profiles[vehicleId] = { ...next, updatedAt: new Date().toISOString() };
        const saved = persistProfiles();
        // After a bank conflict the profiles were reloaded, so there is nothing to roll back.
        if (!saved) {
            if (!st.bankConflict && hadPrevious) st.profiles[vehicleId] = previous;
            else if (!st.bankConflict) delete st.profiles[vehicleId];
            st.unsavedProfileEdits = false; // rolled back: the copy matches the stored state again
            reportProfileSaveFailure();
        }
        api.syncDisplay({ preserveCatalog: true });
        return saved;
    }

    // Both cosmetic styles follow one path: select on the profile, persist, report.
    function saveCosmeticSelection(result, savedMessage) {
        if (!result.ok) {
            api.toast(result.requirement || 'Farbe noch gesperrt', 'warning');
            api.syncDisplay();
            return false;
        }
        st.profiles[st.draft.vehicleId] = result.profile;
        if (!persistProfiles()) {
            reportProfileSaveFailure();
            api.syncDisplay();
            return false;
        }
        api.toast(savedMessage, 'success');
        api.syncDisplay();
        return true;
    }

    function selectTrailStyle(styleId) {
        if (hangarMode !== 'arcade') return false;
        const result = selectArcadeTrailStyle(profileFor(st.draft.vehicleId), styleId, Date.now(), loadArcadeColors(store));
        return saveCosmeticSelection(result, 'Spurstil gespeichert');
    }

    function selectWeaponStyle(familyId, styleId) {
        if (hangarMode !== 'arcade') return false;
        const result = selectArcadeWeaponStyle(profileFor(st.draft.vehicleId), familyId, styleId, Date.now(), loadArcadeColors(store));
        return saveCosmeticSelection(result, 'Waffenstil gespeichert');
    }

    function commitFightBuild(build) {
        const validation = validateFightHangarBuild(build);
        if (!validation.ok) return false;
        const latestSettings = runtimeAccess?.loadSettings?.() || settings;
        if (!latestSettings.localSettings || typeof latestSettings.localSettings !== 'object') latestSettings.localSettings = {};
        const local = latestSettings.localSettings;
        if (!local.fightHangar || typeof local.fightHangar !== 'object') local.fightHangar = {};
        if (!local.fightHangar.activeBonusesByVehicle || typeof local.fightHangar.activeBonusesByVehicle !== 'object') {
            local.fightHangar.activeBonusesByVehicle = {};
        }
        local.fightHangar.activeBonusesByVehicle[build.vehicleId] = {
            ...validation.bonuses,
            machineGunId: normalizeFightMachineGunId(build.machineGunId),
        };
        runtimeAccess?.saveSettings?.(latestSettings);
        if (latestSettings !== settings) Object.assign(settings, latestSettings);
        return true;
    }

    function commitProfileForRun(build, options = {}) {
        if (hangarMode === 'fight') return commitFightBuild(build);
        // Arcade: the pool is the run's only truth; transferring a stone needs confirmation.
        return st.stonePanel.commit(build, { confirmed: options.transfersConfirmed === true });
    }

    return {
        persistProfiles,
        bindProfileStorageSync,
        reportProfileSaveFailure,
        profileFor,
        getProfile,
        syncVehicleWriteback,
        saveProfile,
        selectTrailStyle,
        selectWeaponStyle,
        commitProfileForRun,
    };
}
