// ============================================
// Powerup.js - Powerup-Spawning & Pickup
// ============================================

import * as THREE from 'three';
import { PowerupModelFactory } from './PowerupModelFactory.js';
import { PowerupAuthoredModelCache, resolveAuthoredItemModelUrl } from './PowerupAuthoredModelCache.js';
import { applyBlenderPickupModel } from './powerup/PowerupVisualCatalog.js';
import { findSafePowerupPosition } from './powerup/PowerupSpawnSafetyOps.js';
import { resolvePowerupFieldLimit, resolvePowerupSpawnInterval } from './powerup/PowerupDensityOps.js';
import { isSharedPowerupMaterial } from './powerup/PowerupSharedMaterials.js';
import {
    isPickupTypeAllowedForMode,
    normalizePickupType,
} from './PickupRegistry.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
    encodeGameplayActionResultForLog,
} from '../shared/contracts/GameplayActionResultContract.js';
import {
    removePowerupsByOwnerId,
    spawnPowerupAtAnchor,
} from './powerup/PowerupAnchoredSpawnOps.js';
import {
    buildAnchorKey, createAuthoredRespawnClock, refillAuthoredAnchors, resetAuthoredRespawnClock,
    resolveFixedItemRespawnSeconds, scheduleCollectedAnchorRespawn, spawnDueAuthoredAnchors,
} from './powerup/PowerupAuthoredRespawnOps.js';
import { countArenaPowerups } from './powerup/SecretRoomRefillOps.js';

const SPAWN_TELEGRAPH_SECONDS = 0.75;
const PICKUP_PREDICTION_GRACE_SECONDS = 0.35;

function isTypeAllowedForMode(type, modeType, entityRuntimeConfig) {
    const normalizedType = normalizePickupType(type);
    const entry = entityRuntimeConfig?.POWERUP?.TYPES?.[normalizedType];
    if (!entry) return false;
    return isPickupTypeAllowedForMode(normalizedType, modeType);
}

function nextRuntimeRandom(strategy = null) {
    const random = typeof strategy?.runtimeRng?.next === 'function'
        ? strategy.runtimeRng.next
        : Math.random;
    const value = Number(random());
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 1) return 0.999999999;
    return value;
}

function disposeMeshMaterials(mesh) {
    mesh?.traverse?.((node) => {
        if (!node?.material) return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
            // Pickup models share their materials across every item that looks the same, the way the
            // geometries have always been shared. Collecting one item must not dispose a material
            // that the rest of the field is still drawing with.
            if (isSharedPowerupMaterial(material)) continue;
            material?.dispose?.();
        }
    });
}

function resolveAuthoredPickupType(anchor, modeType, entityRuntimeConfig) {
    if (!anchor || typeof anchor !== 'object') return null;
    const candidates = [
        anchor.pickupType,
        anchor.type,
        anchor.model,
    ];
    for (const candidate of candidates) {
        const normalizedType = normalizePickupType(candidate);
        if (!normalizedType) continue;
        if (isTypeAllowedForMode(normalizedType, modeType, entityRuntimeConfig)) {
            return normalizedType;
        }
    }
    return null;
}


function resolveItemSpawnAuthoringContract(mapDefinition) {
    const rawMode = String(mapDefinition?.itemSpawnMode || '').trim().toLowerCase();
    const contract = mapDefinition?.itemSpawnAuthoring;
    const mode = String(contract?.mode || rawMode || 'fallback-random').trim().toLowerCase();
    const isKnownMode = mode === 'anchor-only' || mode === 'hybrid' || mode === 'fallback-random';
    const normalizedMode = isKnownMode ? mode : 'fallback-random';
    const requiresAuthoredAnchor = contract?.requiresAuthoredAnchor === true || normalizedMode === 'anchor-only';
    const usesRandomFallback = typeof contract?.usesRandomFallback === 'boolean'
        ? contract.usesRandomFallback
        : (normalizedMode === 'fallback-random' || normalizedMode === 'hybrid');

    return {
        mode: normalizedMode,
        requiresAuthoredAnchor,
        usesRandomFallback,
    };
}

export class PowerupManager {
    constructor(renderer, arena, entityRuntimeConfig = null) {
        const config = resolveEntityRuntimeConfig(entityRuntimeConfig || arena);
        this.renderer = renderer;
        this.arena = arena;
        this.entityRuntimeConfig = config;
        this.runtimeConfig = config?.runtimeConfig || null;
        this.getStrategy = null;
        this.getSafetyContext = null;
        this.items = []; // { mesh, type, box }
        this.spawnTimer = 0;
        this.typeKeys = Object.keys(config.POWERUP.TYPES);
        this._pickupBoxSize = new THREE.Vector3();
        this._pickupSphere = new THREE.Sphere();

        // Shared Geometries (einmal erstellen, wiederverwenden)
        const size = config.POWERUP.SIZE;
        this._modelFactory = new PowerupModelFactory(size);
        this._authoredModelCache = new PowerupAuthoredModelCache(size);
        this._sharedGeo = new THREE.BoxGeometry(size, size, size);
        this._sharedWireGeo = new THREE.BoxGeometry(size * 1.15, size * 1.15, size * 1.15);
        this._occupiedAnchorKeys = new Set();
        this._authoredRespawnClock = createAuthoredRespawnClock();
        this._nextNetworkId = 1;
        this._lastRandomType = '';
        this.networkReplica = false;
    }

    update(dt) {
        const config = this.entityRuntimeConfig;
        this.spawnTimer += dt;
        this._authoredRespawnClock.elapsedSeconds += Math.max(0, Number(dt) || 0);

        // Neue Items spawnen
        // 61.4.1: portal_storm modifier increases spawn rate via strategy multiplier
        const strategy = typeof this.getStrategy === 'function' ? this.getStrategy() : null;
        const spawnRateMul = (strategy && typeof strategy.getSpawnRateMultiplier === 'function')
            ? strategy.getSpawnRateMultiplier() : 1.0;
        const fieldLimit = resolvePowerupFieldLimit(config.POWERUP.MAX_ON_FIELD, this.arena?.bounds, config.GAMEPLAY.PLANAR_MODE);
        const effectiveInterval = resolvePowerupSpawnInterval(config.POWERUP, fieldLimit, spawnRateMul);
        const authoredItemTarget = this.arena?.currentMapDefinition?.keepAuthoredItemsAvailable === true
            ? (this.arena?.getAuthoredItemAnchors?.().length || 0)
            : 0;
        const runtimeOwnsSpawns = strategy?.isEndlessParcours?.() === true;
        const fixedRespawns = resolveFixedItemRespawnSeconds(this.arena?.currentMapDefinition) > 0;
        // Secret room items refill on their own clock and belong to the room, not to the arena, so
        // every count against the arena limit asks for the arena items alone.
        if (!runtimeOwnsSpawns && !this.networkReplica && fixedRespawns) {
            spawnDueAuthoredAnchors(this, this._authoredRespawnClock, strategy);
            this.spawnTimer = 0;
        } else if (!runtimeOwnsSpawns && !this.networkReplica && authoredItemTarget > 0) {
            while (countArenaPowerups(this.items) < authoredItemTarget) {
                const previousCount = this.items.length;
                this._spawnRandom();
                if (this.items.length === previousCount) break;
            }
            this.spawnTimer = 0;
        } else if (!runtimeOwnsSpawns && !this.networkReplica && this.spawnTimer >= effectiveInterval && countArenaPowerups(this.items) < fieldLimit) {
            this.spawnTimer = 0;
            this._spawnRandom();
        }

        // Animation
        const time = performance.now() * 0.001;
        const pickupSize = config.POWERUP.PICKUP_RADIUS * 2;
        this._pickupBoxSize.set(pickupSize, pickupSize, pickupSize);
        for (const item of this.items) {
            item.telegraphRemaining = Math.max(0, (Number(item.telegraphRemaining) || 0) - dt);
            if (item.predictedCollected) {
                item.predictionAge = (Number(item.predictionAge) || 0) + dt;
            }
            const rotationDirection = item.animationKind === 'counter-spin' ? -1 : 1;
            const rotationScale = item.animationKind === 'surge' ? 1.8 : 1;
            const baseScaleX = Number.isFinite(Number(item.baseScaleX)) ? Number(item.baseScaleX) : 1;
            const baseScaleY = Number.isFinite(Number(item.baseScaleY)) ? Number(item.baseScaleY) : 1;
            const baseScaleZ = Number.isFinite(Number(item.baseScaleZ)) ? Number(item.baseScaleZ) : 1;
            item.mesh.rotation.y += config.POWERUP.ROTATION_SPEED * rotationDirection * rotationScale * dt;
            item.mesh.position.y = item.baseY + Math.sin(time * config.POWERUP.BOUNCE_SPEED + item.phase) * config.POWERUP.BOUNCE_HEIGHT;
            if (item.telegraphRemaining > 0) {
                const progress = 1 - item.telegraphRemaining / SPAWN_TELEGRAPH_SECONDS;
                const pulse = 0.5 + progress * 0.5 + Math.sin(time * 18 + item.phase) * 0.08;
                const telegraphScale = Math.max(0.35, pulse);
                item.mesh.scale.set(baseScaleX * telegraphScale, baseScaleY * telegraphScale, baseScaleZ * telegraphScale);
            } else if (item.animationKind === 'pulse' || item.animationKind === 'phase') {
                const pulseScale = 1 + Math.sin(time * 5 + item.phase) * 0.08;
                item.mesh.scale.set(baseScaleX * pulseScale, baseScaleY * pulseScale, baseScaleZ * pulseScale);
            } else {
                item.mesh.scale.set(baseScaleX, baseScaleY, baseScaleZ);
            }

            // Bounding Box aktualisieren
            if (item.telegraphRemaining > 0 || item.predictedCollected) item.box.makeEmpty();
            else item.box.setFromCenterAndSize(item.mesh.position, this._pickupBoxSize);
        }
    }

    _spawnRandom() {
        const config = this.entityRuntimeConfig;
        const strategy = typeof this.getStrategy === 'function' ? this.getStrategy() : null;
        const random = () => nextRuntimeRandom(strategy);
        const modeType = String(strategy?.getPickupModeType?.() || strategy?.modeType || 'CLASSIC').trim().toUpperCase();
        const itemSpawnAuthoring = resolveItemSpawnAuthoringContract(this.arena?.currentMapDefinition);
        const spawnableTypes = strategy
            ? strategy.filterSpawnableTypes(this.typeKeys, config.POWERUP.TYPES)
            : this.typeKeys.filter((typeKey) => {
                const entry = config.POWERUP.TYPES[typeKey];
                return entry && !entry.huntOnly;
            });
        if (spawnableTypes.length === 0) return;

        const authoredAnchors = this._getAvailableAuthoredAnchors();
        const shouldUseAuthoredAnchor = itemSpawnAuthoring.mode !== 'fallback-random' && authoredAnchors.length > 0;
        const authoredAnchor = shouldUseAuthoredAnchor
            ? this._pickAuthoredAnchor(authoredAnchors, random)
            : null;
        if (!authoredAnchor && itemSpawnAuthoring.requiresAuthoredAnchor) {
            return;
        }
        if (!authoredAnchor && itemSpawnAuthoring.usesRandomFallback !== true) {
            return;
        }

        const fixedType = resolveAuthoredPickupType(authoredAnchor?.anchor, modeType, config) || null;
        let type = fixedType;
        if (strategy) {
            type = strategy.resolveSpawnType(spawnableTypes, config, {
                excludeType: fixedType ? '' : this._lastRandomType,
            }) || type;
        }
        if (!type) {
            const candidates = this._lastRandomType && spawnableTypes.length > 1
                ? spawnableTypes.filter((candidate) => candidate !== this._lastRandomType)
                : spawnableTypes;
            type = candidates[Math.floor(random() * candidates.length)];
        }
        if (fixedType) {
            type = fixedType;
        } else {
            this._lastRandomType = type;
        }

        const powerupConfig = config.POWERUP.TYPES[type];
        let pos = null;
        if (authoredAnchor?.anchor) {
            pos = new THREE.Vector3(
                Number(authoredAnchor.anchor.x) || 0,
                Number(authoredAnchor.anchor.y) || 0,
                Number(authoredAnchor.anchor.z) || 0,
            );
        } else if (config.GAMEPLAY.PLANAR_MODE && this.arena?.getPortalLevels) {
            const levels = this.arena.getPortalLevels();
            if (levels.length > 0) {
                const level = levels[Math.floor(random() * levels.length)];
                pos = findSafePowerupPosition(this, random, level);
            }
        }
        if (!pos) {
            pos = findSafePowerupPosition(this, random);
        }
        if (!pos) return;

        const mesh = this._createPowerupMesh(type, powerupConfig);
        mesh.position.copy(pos);
        if (authoredAnchor?.anchor && Number.isFinite(Number(authoredAnchor.anchor.rotateY))) {
            mesh.rotation.y = Number(authoredAnchor.anchor.rotateY);
        }
        mesh.castShadow = false;

        this.renderer.addToScene(mesh);

        const box = new THREE.Box3().setFromCenterAndSize(
            pos,
            new THREE.Vector3(config.POWERUP.PICKUP_RADIUS * 2, config.POWERUP.PICKUP_RADIUS * 2, config.POWERUP.PICKUP_RADIUS * 2)
        );

        const spawnedItem = {
            mesh,
            type,
            box,
            networkId: `powerup:${this._nextNetworkId++}`,
            baseY: pos.y,
            phase: random() * Math.PI * 2,
            anchorKey: authoredAnchor?.key || null,
            telegraphRemaining: SPAWN_TELEGRAPH_SECONDS,
            animationKind: String(powerupConfig?.animationKind || 'float'),
            predictedCollected: false,
            predictionAge: 0,
            baseScaleX: mesh.scale.x,
            baseScaleY: mesh.scale.y,
            baseScaleZ: mesh.scale.z,
        };
        this.items.push(spawnedItem);
        this._applyAuthoredItemModel(spawnedItem, authoredAnchor?.anchor, powerupConfig);
        if (authoredAnchor?.key) {
            this._occupiedAnchorKeys.add(authoredAnchor.key);
        }
        const recorder = typeof this.getSafetyContext === 'function'
            ? this.getSafetyContext()?.recorder
            : null;
        recorder?.logEvent?.('ITEM_SPAWN', -1, encodeGameplayActionResultForLog(buildGameplayActionResult({
            ok: true,
            code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SPAWN_SUCCESS,
            mode: 'spawn',
            type,
        })));
    }

    _createPowerupMesh(type, config) {
        if (this._modelFactory) {
            const model = this._modelFactory.createModel(type, config);
            if (model) return model;
        }

        const mat = new THREE.MeshStandardMaterial({
            color: config.color,
            emissive: config.color,
            emissiveIntensity: 0.5,
            roughness: 0.2,
            metalness: 0.8,
            transparent: true,
            opacity: 0.85,
        });
        const mesh = new THREE.Mesh(this._sharedGeo, mat);

        const wireMat = new THREE.MeshBasicMaterial({
            color: config.color,
            wireframe: true,
            transparent: true,
            opacity: 0.3,
        });
        const wire = new THREE.Mesh(this._sharedWireGeo, wireMat);
        mesh.add(wire);
        return mesh;
    }

    spawnAtAnchor(anchor) {
        return spawnPowerupAtAnchor(this, anchor);
    }

    removeByOwnerId(ownerId) {
        return removePowerupsByOwnerId(this, ownerId);
    }


    /** Prueft ob ein Spieler ein Item einsammelt */
    checkPickup(playerPosition, radius, acceptPickup = null) {
        if (this.networkReplica && typeof acceptPickup !== 'function') return null;
        this._pickupSphere.center.copy(playerPosition);
        this._pickupSphere.radius = radius + this.entityRuntimeConfig.POWERUP.PICKUP_RADIUS;

        for (let i = this.items.length - 1; i >= 0; i--) {
            if (!this.items[i].predictedCollected && (Number(this.items[i].telegraphRemaining) || 0) <= 0
                && this.items[i].box.intersectsSphere(this._pickupSphere)) {
                const item = this.items[i];
                if (typeof acceptPickup === 'function' && acceptPickup(item.type) !== true) {
                    return buildGameplayActionResult({
                        ok: false,
                        code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_PICKUP_INVENTORY_FULL,
                        message: 'Inventar voll',
                        mode: 'pickup',
                        type: item.type,
                    });
                }
                if (this.networkReplica) {
                    item.predictedCollected = true;
                    item.predictionAge = 0;
                    item.mesh.visible = false;
                    item.box.makeEmpty();
                } else {
                    this.items.splice(i, 1);
                    this._disposeSpawnedItem(item, true);
                }
                return buildGameplayActionResult({
                    ok: true,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_PICKUP_SUCCESS,
                    mode: 'pickup',
                    type: item.type,
                    meta: this.networkReplica ? { predicted: true } : null,
                });
            }
        }
        return null;
    }

    clear() {
        for (const item of this.items) {
            this._disposeSpawnedItem(item);
        }
        this.items = [];
        this.spawnTimer = 0;
        this._lastRandomType = '';
        this._occupiedAnchorKeys.clear();
        resetAuthoredRespawnClock(this._authoredRespawnClock);
    }

    refillAuthoredOnDeath() {
        if (this.networkReplica || this.arena?.currentMapDefinition?.itemRespawnOnDeath !== true) return;
        const strategy = typeof this.getStrategy === 'function' ? this.getStrategy() : null;
        refillAuthoredAnchors(this, this._authoredRespawnClock, strategy);
    }

    _spawnFixedAuthoredAnchor(anchor, key, strategy) {
        const modeType = String(strategy?.getPickupModeType?.() || strategy?.modeType || 'CLASSIC').trim().toUpperCase();
        const type = resolveAuthoredPickupType(anchor, modeType, this.entityRuntimeConfig);
        if (!type) return;
        const item = this.spawnAtAnchor({ ...anchor, type, ownerId: `authored:${key}` });
        if (!item) return;
        item.anchorKey = key;
        this._occupiedAnchorKeys.add(key);
    }

    dispose() {
        this.clear();
        if (this._authoredModelCache) {
            this._authoredModelCache.dispose();
            this._authoredModelCache = null;
        }
        if (this._modelFactory) {
            this._modelFactory.dispose();
            this._modelFactory = null;
        }
        if (this._sharedGeo) {
            this._sharedGeo.dispose();
            this._sharedGeo = null;
        }
        if (this._sharedWireGeo) {
            this._sharedWireGeo.dispose();
            this._sharedWireGeo = null;
        }
    }

    _getAvailableAuthoredAnchors() {
        const anchors = this.arena?.getAuthoredItemAnchors?.() || [];
        const availableAnchors = [];
        for (let i = 0; i < anchors.length; i += 1) {
            const anchor = anchors[i];
            if (!anchor || !Number.isFinite(Number(anchor.x)) || !Number.isFinite(Number(anchor.z))) continue;
            const key = buildAnchorKey(anchor, i);
            if (this._occupiedAnchorKeys.has(key)) continue;
            availableAnchors.push({
                key,
                anchor,
                weight: Math.max(0.01, Number(anchor.weight) || 1),
            });
        }
        return availableAnchors;
    }

    _pickAuthoredAnchor(availableAnchors = [], random = Math.random) {
        if (!Array.isArray(availableAnchors) || availableAnchors.length === 0) return null;
        let totalWeight = 0;
        for (const entry of availableAnchors) {
            totalWeight += Math.max(0.01, Number(entry.weight) || 1);
        }
        let roll = random() * totalWeight;
        for (const entry of availableAnchors) {
            roll -= Math.max(0.01, Number(entry.weight) || 1);
            if (roll <= 0) {
                return entry;
            }
        }
        return availableAnchors[availableAnchors.length - 1];
    }

    _disposeSpawnedItem(item, collected = false) {
        if (!item) return;
        if (item.anchorKey) {
            this._occupiedAnchorKeys.delete(item.anchorKey);
            if (collected) scheduleCollectedAnchorRespawn(this._authoredRespawnClock, item.anchorKey, this.arena?.currentMapDefinition);
        }
        this.renderer.removeFromScene(item.mesh);
        disposeMeshMaterials(item.mesh);
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    applyNetworkSnapshot(entries) {
        if (!Array.isArray(entries)) return;
        this.networkReplica = true;
        const pickupSize = this.entityRuntimeConfig.POWERUP.PICKUP_RADIUS * 2;
        this._pickupBoxSize.set(pickupSize, pickupSize, pickupSize);
        const incomingById = new Map();
        for (const entry of entries) {
            const id = String(entry?.id ?? '').trim();
            if (id) incomingById.set(id, entry);
        }

        const existingById = new Map();
        for (let i = this.items.length - 1; i >= 0; i -= 1) {
            const item = this.items[i];
            const id = String(item?.networkId || '').trim();
            if (!id || !incomingById.has(id)) {
                this.items.splice(i, 1);
                this._disposeSpawnedItem(item);
            } else {
                existingById.set(id, item);
            }
        }

        for (const [id, entry] of incomingById) {
            const type = normalizePickupType(entry?.type);
            const powerupConfig = this.entityRuntimeConfig?.POWERUP?.TYPES?.[type];
            if (!type || !powerupConfig) continue;
            let item = existingById.get(id) || null;
            if (item?.type !== type) {
                if (item) {
                    this.items.splice(this.items.indexOf(item), 1);
                    this._disposeSpawnedItem(item);
                }
                const mesh = this._createPowerupMesh(type, powerupConfig);
                this.renderer.addToScene(mesh);
                item = {
                    mesh,
                    type,
                    networkId: id,
                    box: new THREE.Box3(),
                    baseY: 0,
                    phase: 0,
                    anchorKey: null,
                    telegraphRemaining: 0,
                    animationKind: String(powerupConfig?.animationKind || 'float'),
                    predictedCollected: false,
                    predictionAge: 0,
                    baseScaleX: mesh.scale.x,
                    baseScaleY: mesh.scale.y,
                    baseScaleZ: mesh.scale.z,
                };
                this.items.push(item);
                this._applyAuthoredItemModel(item, null, powerupConfig);
            }
            const pos = Array.isArray(entry.pos) ? entry.pos : [];
            item.mesh.position.set(Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0);
            item.mesh.rotation.y = Number(entry.rotationY) || 0;
            item.telegraphRemaining = Math.max(0, Number(entry.telegraphRemaining) || 0);
            if (item.predictedCollected && item.predictionAge >= PICKUP_PREDICTION_GRACE_SECONDS) {
                item.predictedCollected = false;
                item.predictionAge = 0;
            }
            item.mesh.visible = entry.visible !== false && !item.predictedCollected;
            item.baseY = item.mesh.position.y;
            if (item.telegraphRemaining > 0 || item.predictedCollected) item.box.makeEmpty();
            else item.box.setFromCenterAndSize(item.mesh.position, this._pickupBoxSize);
        }
    }

    _applyAuthoredItemModel(item, anchor = null, config = null) {
        applyBlenderPickupModel(this, item, anchor, config, {
            disposeMeshMaterials,
            resolveAuthoredItemModelUrl,
        });
    }
}
