import { PortalLayoutBuilder } from './portal/PortalLayoutBuilder.js';
import { PortalRuntimeSystem } from './portal/PortalRuntimeSystem.js';
import { SpecialGateRuntime } from './portal/SpecialGateRuntime.js';
import { CheckpointRingRuntime } from './portal/CheckpointRingRuntime.js';

export class PortalGateSystem {
    constructor(arena) {
        this.arena = arena;
        this.layoutBuilder = new PortalLayoutBuilder(arena);
        this.portalRuntime = new PortalRuntimeSystem(arena);
        this.specialGateRuntime = new SpecialGateRuntime(arena);
        this.checkpointRingRuntime = new CheckpointRingRuntime(arena);
    }

    build(map, scale) {
        this.portalRuntime.resetRuntimeState();
        this.checkpointRingRuntime.resetRuntimeState();
        this.layoutBuilder.build(map, scale);
        this.checkpointRingSpinEnabled = this.layoutBuilder.checkpointRingSpinEnabled;
    }

    checkPortal(position, radius, entityId) {
        return this.portalRuntime.checkPortal(position, radius, entityId);
    }

    checkExitPortal(position, radius, entityId) {
        return this.portalRuntime.checkExitPortal(position, radius, entityId);
    }

    checkSpecialGates(position, previousPosition, radius, entityId) {
        return this.specialGateRuntime.checkSpecialGates(position, previousPosition, radius, entityId);
    }

    getTraversalSignalForEntity(entityId) {
        const portalSignal = this.portalRuntime.getEntityPortalRuntimeSignal(entityId);
        const gateSignal = this.specialGateRuntime.getEntityGateRuntimeSignal(entityId);
        return {
            portalsEnabled: portalSignal.portalsEnabled,
            portalCooldownRemaining: portalSignal.portalCooldownRemaining,
            gateCooldownRemaining: gateSignal.gateCooldownRemaining,
            gateCount: gateSignal.gateCount,
            exitPortal: portalSignal.exitPortal,
            exitPortalCooldownRemaining: portalSignal.exitPortalCooldownRemaining,
            postPortalActive: portalSignal.postPortalActive,
            postPortalRemainingSeconds: portalSignal.postPortalRemainingSeconds,
            lastPortalTravelAtMs: portalSignal.lastPortalTravelAtMs,
        };
    }

    getPortalLevelsFallback() {
        return this.layoutBuilder.getPortalLevelsFallback();
    }

    getPortalLevels() {
        return this.layoutBuilder.getPortalLevels();
    }

    get checkpointRingSpinEnabled() {
        return this.checkpointRingRuntime.spinEnabled;
    }

    set checkpointRingSpinEnabled(value) {
        this.checkpointRingRuntime.spinEnabled = value !== false;
    }

    update(dt) {
        this.portalRuntime.update(dt);
        this.specialGateRuntime.update(dt);
        this.checkpointRingRuntime.update(dt);
    }
}
