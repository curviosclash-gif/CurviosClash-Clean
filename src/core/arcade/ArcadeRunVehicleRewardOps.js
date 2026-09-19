import { getOrCreateProfile } from '../../state/arcade/ArcadeVehicleProfile.js';
import { bindArcadeVehicleRewards } from '../../state/arcade/ArcadeVehicleRewardBinding.js';

export function bindArcadeRunVehicleRewards(runtime, runType = runtime?._config?.runType) {
    runtime._rewardBinding = bindArcadeVehicleRewards({
        runType,
        vehicleId: runtime?._state?.vehicleId || runtime?._activeVehicleId || 'ship1',
    });
    if (runtime._state) runtime._state.vehicleId = runtime._rewardBinding?.vehicleId || null;
    return runtime._rewardBinding;
}

export function ensureArcadeRunVehicleRewards(runtime) {
    if (!runtime?._rewardBinding && runtime?._enabled && runtime?._state) {
        return bindArcadeRunVehicleRewards(runtime, runtime._state.config?.runType || runtime._config.runType);
    }
    return runtime?._rewardBinding || null;
}

export function getArcadeRunVehicleId(runtime) {
    return ensureArcadeRunVehicleRewards(runtime)?.vehicleId || runtime?._activeVehicleId || null;
}

export function getArcadeRunVehicleProfile(runtime) {
    const vehicleId = getArcadeRunVehicleId(runtime);
    if (!runtime?._vehicleProfiles || !vehicleId) return null;
    return getOrCreateProfile(runtime._vehicleProfiles, vehicleId);
}
