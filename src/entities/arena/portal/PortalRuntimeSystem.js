import { resolveGameplayConfig } from '../../../shared/contracts/GameplayConfigContract.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../../shared/contracts/GameplayActionResultContract.js';
import {
    normalizeEntityKey,
    resolveEntityCooldown,
} from './TraversalCooldownOps.js';

const POST_PORTAL_SIGNAL_SECONDS = 0.55;

function buildPortalInteractionResult({
    ok = false,
    code = '',
    message = '',
    type = 'PORTAL',
    cooldownSeconds = null,
    cooldownRemaining = null,
    meta = null,
    ...extra
} = {}) {
    return {
        ...buildGameplayActionResult({
            ok,
            code,
            message,
            mode: 'portal',
            type,
            cooldownSeconds,
            cooldownRemaining,
            meta,
        }),
        ...extra,
    };
}

export class PortalRuntimeSystem {
    constructor(arena) {
        this.arena = arena;
        this._postPortalSignalByEntity = new Map();
    }

    _syncPortalVisualState(portal, timeSeconds = 0) {
        if (!portal) return;
        const engaged = portal.cooldowns instanceof Map && portal.cooldowns.size > 0;
        const scale = engaged ? 0.88 + Math.sin(timeSeconds * 6) * 0.03 : 1;
        portal.meshA?.scale?.setScalar?.(scale);
        portal.meshB?.scale?.setScalar?.(scale);
    }

    _syncExitPortalVisualState(exitPortal, timeSeconds = 0) {
        if (!exitPortal?.mesh) return;
        const engaged = exitPortal.cooldowns instanceof Map && exitPortal.cooldowns.size > 0;
        const scale = engaged ? 1.24 + Math.sin(timeSeconds * 6) * 0.04 : 1.4;
        exitPortal.mesh.scale?.set?.(scale, scale, scale);
    }

    _normalizeEntityKey(entityId) {
        return normalizeEntityKey(entityId);
    }

    _resolveEntityCooldown(cooldownMap, entityId) {
        return resolveEntityCooldown(cooldownMap, entityId);
    }

    _getMaxCooldownForEntity(entries, entityId) {
        if (!Array.isArray(entries) || entries.length === 0) return 0;
        let maxRemaining = 0;
        for (const entry of entries) {
            const remaining = this._resolveEntityCooldown(entry?.cooldowns, entityId);
            if (remaining > maxRemaining) {
                maxRemaining = remaining;
            }
        }
        return maxRemaining;
    }

    _markPostPortalSignal(entityId, cooldownSeconds = 0) {
        const entityKey = this._normalizeEntityKey(entityId);
        if (!entityKey) return;

        this._postPortalSignalByEntity.set(entityKey, {
            remainingSeconds: POST_PORTAL_SIGNAL_SECONDS,
            cooldownSeconds: Math.max(0, Number(cooldownSeconds) || 0),
            lastPortalTravelAtMs: Date.now(),
        });
    }

    resetRuntimeState() {
        this._postPortalSignalByEntity.clear();
    }

    checkPortal(position, radius, entityId) {
        if (!this.arena.portalsEnabled) {
            return buildPortalInteractionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL_INACTIVE,
                message: 'Portale deaktiviert',
                blockedReason: 'inactive',
                inactiveReason: 'portals-disabled',
            });
        }
        const portalConfig = resolveGameplayConfig(this.arena).PORTAL;

        const triggerRadius = portalConfig.RADIUS;
        const triggerRadiusSq = (triggerRadius + radius) * (triggerRadius + radius);
        let blockedCooldownRemaining = 0;

        for (const portal of this.arena.portals) {
            const distASq = position.distanceToSquared(portal.posA);
            const distBSq = position.distanceToSquared(portal.posB);
            const inRangeA = distASq < triggerRadiusSq;
            const inRangeB = distBSq < triggerRadiusSq;
            const cooldownRemaining = this._resolveEntityCooldown(portal.cooldowns, entityId);

            if (cooldownRemaining > 0) {
                if (inRangeA || inRangeB) {
                    blockedCooldownRemaining = Math.max(blockedCooldownRemaining, cooldownRemaining);
                }
                continue;
            }

            if (inRangeA) {
                const dist = portal.posA.distanceTo(portal.posB);
                const dynamicCooldown = Math.min(2.5, Math.max(portalConfig.COOLDOWN, dist / 80));
                portal.cooldowns.set(entityId, dynamicCooldown);
                this._markPostPortalSignal(entityId, dynamicCooldown);
                return buildPortalInteractionResult({
                    ok: true,
                    code: GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL,
                    message: 'Portal durchquert',
                    cooldownSeconds: dynamicCooldown,
                    target: portal.posB,
                    portal,
                    postPortalSeconds: POST_PORTAL_SIGNAL_SECONDS,
                });
            }
            if (inRangeB) {
                const dist = portal.posA.distanceTo(portal.posB);
                const dynamicCooldown = Math.min(2.5, Math.max(portalConfig.COOLDOWN, dist / 80));
                portal.cooldowns.set(entityId, dynamicCooldown);
                this._markPostPortalSignal(entityId, dynamicCooldown);
                return buildPortalInteractionResult({
                    ok: true,
                    code: GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL,
                    message: 'Portal durchquert',
                    cooldownSeconds: dynamicCooldown,
                    target: portal.posA,
                    portal,
                    postPortalSeconds: POST_PORTAL_SIGNAL_SECONDS,
                });
            }
        }

        if (blockedCooldownRemaining > 0) {
            return buildPortalInteractionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.PORTAL_TRAVEL_COOLDOWN,
                message: `Portal-Cooldown: ${blockedCooldownRemaining.toFixed(2)}s`,
                blockedReason: 'cooldown',
                cooldownRemaining: blockedCooldownRemaining,
            });
        }

        return null;
    }

    checkExitPortal(position, radius, entityId) {
        if (!this.arena.portalsEnabled) {
            return buildPortalInteractionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_INACTIVE,
                message: 'Portale deaktiviert',
                type: 'EXIT_PORTAL',
                blockedReason: 'inactive',
                inactiveReason: 'portals-disabled',
            });
        }
        if (!Array.isArray(this.arena.exitPortals) || this.arena.exitPortals.length === 0) return null;
        const portalConfig = resolveGameplayConfig(this.arena).PORTAL;

        const triggerRadius = portalConfig.RADIUS * 1.3;
        const triggerRadiusSq = (triggerRadius + radius) * (triggerRadius + radius);
        let blockedCooldownRemaining = 0;
        let touchedInactiveExitPortal = false;

        for (const exitPortal of this.arena.exitPortals) {
            const distSq = position.distanceToSquared(exitPortal.pos);
            if (distSq >= triggerRadiusSq) continue;

            if (!exitPortal.active) {
                touchedInactiveExitPortal = true;
                continue;
            }

            const cooldownRemaining = this._resolveEntityCooldown(exitPortal.cooldowns, entityId);
            if (cooldownRemaining > 0) {
                blockedCooldownRemaining = Math.max(blockedCooldownRemaining, cooldownRemaining);
                continue;
            }

            exitPortal.cooldowns.set(entityId, 3.0);
            return buildPortalInteractionResult({
                ok: true,
                code: GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_TRIGGER,
                message: 'Exit-Portal aktiviert',
                type: 'EXIT_PORTAL',
                cooldownSeconds: 3.0,
                triggered: true,
                exitPortal,
            });
        }

        if (blockedCooldownRemaining > 0) {
            return buildPortalInteractionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_COOLDOWN,
                message: `Exit-Portal-Cooldown: ${blockedCooldownRemaining.toFixed(2)}s`,
                type: 'EXIT_PORTAL',
                blockedReason: 'cooldown',
                cooldownRemaining: blockedCooldownRemaining,
            });
        }

        if (touchedInactiveExitPortal) {
            return buildPortalInteractionResult({
                ok: false,
                code: GAMEPLAY_ACTION_RESULT_CODES.EXIT_PORTAL_INACTIVE,
                message: 'Exit-Portal inaktiv',
                type: 'EXIT_PORTAL',
                blockedReason: 'inactive',
                inactiveReason: 'exit-portal-inactive',
            });
        }

        return null;
    }

    activateExitPortals() {
        if (!Array.isArray(this.arena.exitPortals)) return;
        for (const exitPortal of this.arena.exitPortals) {
            exitPortal.active = true;
            if (exitPortal.mesh) {
                exitPortal.mesh.visible = true;
            }
        }
    }

    deactivateExitPortals() {
        if (!Array.isArray(this.arena.exitPortals)) return;
        for (const exitPortal of this.arena.exitPortals) {
            exitPortal.active = false;
            if (exitPortal.mesh) {
                exitPortal.mesh.visible = false;
            }
        }
    }

    update(dt) {
        for (const portal of this.arena.portals) {
            for (const [id, t] of portal.cooldowns) {
                const newT = t - dt;
                if (newT <= 0) {
                    portal.cooldowns.delete(id);
                } else {
                    portal.cooldowns.set(id, newT);
                }
            }
        }

        if (Array.isArray(this.arena.exitPortals)) {
            for (const exitPortal of this.arena.exitPortals) {
                for (const [id, t] of exitPortal.cooldowns) {
                    const newT = t - dt;
                    if (newT <= 0) {
                        exitPortal.cooldowns.delete(id);
                    } else {
                        exitPortal.cooldowns.set(id, newT);
                    }
                }
            }
        }

        for (const [entityKey, signal] of this._postPortalSignalByEntity.entries()) {
            const remainingSeconds = Math.max(0, Number(signal?.remainingSeconds) || 0) - dt;
            if (remainingSeconds <= 0) {
                this._postPortalSignalByEntity.delete(entityKey);
            } else {
                signal.remainingSeconds = remainingSeconds;
            }
        }

        const time = performance.now() * 0.001;
        for (const portal of this.arena.portals) {
            if (portal.meshA?.setSpinZ) {
                portal.meshA.setSpinZ(time * 0.5);
            } else if (portal.meshA) {
                portal.meshA.rotation.z = time * 0.5;
            }
            if (portal.meshB?.setSpinZ) {
                portal.meshB.setSpinZ(-time * 0.5);
            } else if (portal.meshB) {
                portal.meshB.rotation.z = -time * 0.5;
            }
            this._syncPortalVisualState(portal, time);
        }

        if (Array.isArray(this.arena.exitPortals)) {
            for (const exitPortal of this.arena.exitPortals) {
                if (!exitPortal.mesh || !exitPortal.active) continue;
                if (exitPortal.mesh.setSpinZ) {
                    exitPortal.mesh.setSpinZ(time * 0.8);
                } else {
                    exitPortal.mesh.rotation.z = time * 0.8;
                }
                this._syncExitPortalVisualState(exitPortal, time);
            }
        }
    }

    getEntityPortalRuntimeSignal(entityId) {
        const exitPortals = Array.isArray(this.arena.exitPortals) ? this.arena.exitPortals : [];
        const activeExitPortals = exitPortals.reduce((count, entry) => count + (entry?.active === true ? 1 : 0), 0);
        const entityKey = this._normalizeEntityKey(entityId);
        const postPortalSignal = entityKey ? this._postPortalSignalByEntity.get(entityKey) : null;
        const postPortalRemainingSeconds = Math.max(0, Number(postPortalSignal?.remainingSeconds) || 0);

        return {
            portalsEnabled: this.arena.portalsEnabled !== false,
            portalCooldownRemaining: this._getMaxCooldownForEntity(this.arena.portals, entityId),
            exitPortalCooldownRemaining: this._getMaxCooldownForEntity(exitPortals, entityId),
            exitPortal: {
                totalCount: exitPortals.length,
                activeCount: activeExitPortals,
                inactiveCount: Math.max(0, exitPortals.length - activeExitPortals),
            },
            postPortalActive: postPortalRemainingSeconds > 0,
            postPortalRemainingSeconds,
            lastPortalTravelAtMs: Math.max(0, Math.trunc(Number(postPortalSignal?.lastPortalTravelAtMs) || 0)),
        };
    }
}
