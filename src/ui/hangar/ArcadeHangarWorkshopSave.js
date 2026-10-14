import { normalizeVehicleValue as norm } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { HangarBuildHistory, normalizeHangarBuild } from './HangarBuildDraftState.js';

/**
 * Saving and activating the build of the hangar workshop: the Arcade save that has to keep
 * build, stone pool and active pointer consistent, the failure messages, the save button and
 * the check before a run starts.
 *
 * Call it after the shell exists. The functions reach the other modules through `api`, which
 * the controller fills before anything runs.
 */
export function createWorkshopSaveActions(st, api) {
    const { hangarMode, persistence, draftPersistence } = st;
    const { container, presetName, presetSelect, presetTags } = st.shell;

    // The draft, the saved build and the baseline all become the build the store handed back.
    function adoptSavedBuild(build) {
        st.draft = normalizeHangarBuild(build);
        st.savedBuild = normalizeHangarBuild(build);
        st.baselineBuild = normalizeHangarBuild(build);
        st.history = new HangarBuildHistory(st.draft);
    }

    async function saveArcadeBuildAndProfile(build, saveOptions) {
        const stonePanel = st.stonePanel;
        const previousPool = stonePanel?.getPool() || null;
        let buildResult;
        try {
            // Save the draft first. It must not become active until both its stones and active pointer persist.
            buildResult = await persistence.saveBuild(build, { ...saveOptions, activate: false });
        } catch (error) {
            buildResult = { ok: false, code: 'build_save_failed', error };
        }
        if (buildResult?.ok !== true) return { ok: false, code: 'build_save_failed', buildResult };

        if (!api.commitProfileForRun(build, saveOptions)) {
            return { ok: false, code: 'stone_activation_failed', buildResult };
        }

        let activationResult;
        try {
            activationResult = await persistence.saveBuild(buildResult.build, {
                ...saveOptions,
                asNew: false,
                activate: true,
            });
        } catch (error) {
            activationResult = { ok: false, code: 'build_activation_failed', error };
        }
        if (activationResult?.ok === true) return { ok: true, buildResult: activationResult };

        const poolRestored = !!previousPool && stonePanel.restorePool(previousPool);
        return {
            ok: false,
            code: poolRestored ? 'build_activation_failed' : 'build_activation_failed_pool_rollback_failed',
            buildResult: activationResult,
            poolRestored,
        };
    }

    function reportArcadeBuildSaveFailure(result) {
        if (result.code === 'build_activation_failed_pool_rollback_failed') {
            api.toast('Build konnte nicht aktiviert werden; der Steinpool ließ sich nicht zurücksetzen.', 'error');
        } else if (result.code === 'build_activation_failed') {
            api.toast('Build konnte nicht aktiviert werden; der Steinpool wurde zurückgesetzt.', 'error');
        } else if (result.code === 'stone_activation_failed') {
            api.toast('Build bleibt als Entwurf gespeichert; der Steinpool konnte nicht aktiviert werden.', 'error');
        } else {
            api.toast('Build konnte nicht gespeichert werden; es wurde nichts aktiviert.', 'error');
        }
    }

    function reportSavedBuild(options, activated) {
        const draft = st.draft;
        if (!activated) {
            api.toast('Build gespeichert, aber die Steine konnten nicht aktiviert werden.', 'warning');
        } else if (options.activate) {
            api.toast(hangarMode === 'fight' ? 'Build gespeichert und für den nächsten Kampf aktiviert.' : 'Build gespeichert und für den nächsten Run aktiviert.', 'success');
        } else {
            api.toast(`Build gespeichert: ${draft.name}`, 'success');
        }
    }

    async function saveCurrent(options = {}) {
        const stonePanel = st.stonePanel;
        if (options.activate && stonePanel && !options.transfersConfirmed) return stonePanel.confirmTransfers(st.draft, () => saveCurrent({ ...options, transfersConfirmed: true }));
        const profile = api.profileFor(st.draft.vehicleId);
        const validation = api.validateForMode(st.draft, profile.level, profile);
        if (!validation.ok) {
            api.toast('Ungültige Builds werden nicht gespeichert.', 'warning');
            return { ok: false, validation };
        }
        const name = norm(presetName.value, st.savedBuild?.name || `${api.entryFor(st.draft.vehicleId).label} Build`);
        const selectedPreset = persistence.getBuild(presetSelect.value);
        const buildToSave = normalizeHangarBuild({
            ...st.draft,
            favorite: selectedPreset?.buildId === st.draft.buildId ? selectedPreset.favorite : st.draft.favorite,
            tags: presetTags.value.split(','),
        });
        const saveOptions = {
            asNew: options.asNew === true || !st.savedBuild,
            activate: options.activate === true,
            transfersConfirmed: options.transfersConfirmed === true,
            name,
        };
        let result;
        if (options.activate === true && hangarMode === 'arcade') {
            const activation = await saveArcadeBuildAndProfile(buildToSave, saveOptions);
            if (!activation.ok) {
                if (activation.code === 'profile_save_failed') {
                    api.reportProfileSaveFailure('Profil konnte nicht gespeichert werden. Der Build bleibt ein Entwurf und wird nicht aktiviert.');
                } else {
                    reportArcadeBuildSaveFailure(activation);
                }
                return activation;
            }
            result = activation.buildResult;
        } else {
            result = await persistence.saveBuild(buildToSave, saveOptions);
        }
        if (!result.ok) {
            api.toast('Build konnte nicht gespeichert werden.', 'error');
            return result;
        }
        adoptSavedBuild(result.build);
        presetName.value = '';
        const activated = !(options.activate && hangarMode === 'fight') || api.commitProfileForRun(st.draft);
        draftPersistence.clear(st.draft.vehicleId);
        reportSavedBuild(options, activated);
        api.syncDisplay();
        return result;
    }

    async function prepareRunStart() {
        const profile = api.profileFor(st.draft.vehicleId);
        const validation = api.validateForMode(st.draft, profile.level, profile);
        if (!validation.ok) {
            api.toast('Run-Start blockiert: Der angezeigte Build ist ungültig.', 'warning');
            return { ok: false, code: 'invalid_build', validation };
        }
        const needsSave = api.isDirty() || !st.savedBuild;
        if (hangarMode === 'arcade') {
            const activation = await saveArcadeBuildAndProfile(st.draft, {
                asNew: !st.savedBuild,
                activate: true,
                name: st.savedBuild?.name || st.draft.name,
            });
            if (!activation.ok) {
                if (activation.code === 'profile_save_failed') {
                    api.reportProfileSaveFailure('Profil konnte nicht gespeichert werden. Der Run wurde nicht gestartet; Änderungen bleiben im offenen Hangar.');
                } else {
                    reportArcadeBuildSaveFailure(activation);
                }
                return activation;
            }
            adoptSavedBuild(activation.buildResult.build);
        } else {
            if (!api.commitProfileForRun(st.draft)) {
                api.reportProfileSaveFailure('Profil konnte nicht gespeichert werden. Der Run wurde nicht gestartet; Änderungen bleiben im offenen Hangar.');
                return { ok: false, code: 'profile_save_failed' };
            }
            void persistence.saveBuild(st.draft, { asNew: !st.savedBuild, activate: true, name: st.savedBuild?.name || st.draft.name }).then((saved) => {
                if (!saved.ok || st.disposed) return;
                adoptSavedBuild(saved.build);
                api.syncDisplay();
            });
        }
        api.syncVehicleWriteback(st.draft.vehicleId);
        api.toast(needsSave ? 'Angezeigter Build wurde gespeichert und für den Run aktiviert.' : 'Aktiver Build ist für den Run synchronisiert.', 'success');
        container.dataset.activeRunVehicleId = st.draft.vehicleId;
        container.dataset.activeRunBuildId = st.draft.buildId;
        return { ok: true, vehicleId: st.draft.vehicleId, build: normalizeHangarBuild(st.draft), validation };
    }

    return { saveCurrent, prepareRunStart };
}
