// ============================================
// Powerup.js - Powerup-Spawning & Pickup
// ============================================

import * as THREE from 'three';
import { PowerupModelFactory } from './PowerupModelFactory.js';
import {
    isPickupTypeAllowedForMode,
    normalizePickupType,
} from './PickupRegistry.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../shared/contracts/GameplayActionResultContract.js';

function isTypeAllowedForMode(type, huntModeActive, entityRuntimeConfig) {
    const normalizedType = normalizePickupType(type);
    const entry = entityRuntimeConfig?.POWERUP?.TYPES?.[normalizedType];
    if (!entry) return false;
    return isPickupTypeAllowedForMode(normalizedType, huntModeActive ? 'HUNT' : 'CLASSIC');
}

function resolveAuthoredPickupType(anchor, huntModeActive, entityRuntimeConfig) {
    if (!anchor || typeof anchor !== 'object') return null;
    const candidates = [
        anchor.pickupType,
        anchor.type,
        anchor.model,
    ];
    for (const candidate of candidates) {
        const normalizedType = normalizePickupType(candidate);
        if (!normalizedType) continue;
        if (isTypeAllowedForMode(normalizedType, huntModeActive, entityRuntimeConfig)) {
            return normalizedType;
        }
    }
    return null;
}

function buildAnchorKey(anchor, index = 0) {
    if (typeof anchor?.id === 'string' && anchor.id.trim()) {
        return anchor.id.trim();
    }
    return [
        'anchor',
        index,
        Math.round((Number(anchor?.x) || 0) * 1000),
        Math.round((Number(anchor?.y) || 0) * 1000),
        Math.round((Number(anchor?.z) || 0) * 1000),
    ].join(':');
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
        this.items = []; // { mesh, type, box }
        this.spawnTimer = 0;
        this.typeKeys = Object.keys(config.POWERUP.TYPES);
        this._pickupBoxSize = new THREE.Vector3();
        this._pickupSphere = new THREE.Sphere();

        // Shared Geometries (einmal erstellen, wiederverwenden)
        const size = config.POWERUP.SIZE;
        this._modelFactory = new PowerupModelFactory(size);
        this._sharedGeo = new THREE.BoxGeometry(size, size, size);
        this._sharedWireGeo = new THREE.BoxGeometry(size * 1.15, size * 1.15, size * 1.15);
        this._occupiedAnchorKeys = new Set();
    }

    update(dt) {
        const config = this.entityRuntimeConfig;
        this.spawnTimer += dt;

        // Neue Items spawnen
        // 61.4.1: portal_storm modifier increases spawn rate via strategy multiplier
        const strategy = typeof this.getStrategy === 'function' ? this.getStrategy() : null;
        const spawnRateMul = (strategy && typeof strategy.getSpawnRateMultiplier === 'function')
            ? strategy.getSpawnRateMultiplier() : 1.0;
        const effectiveInterval = spawnRateMul > 0
            ? config.POWERUP.SPAWN_INTERVAL / spawnRateMul
            : config.POWERUP.SPAWN_INTERVAL;
        if (this.spawnTimer >= effectiveInterval && this.items.length < config.POWERUP.MAX_ON_FIELD) {
            this.spawnTimer = 0;
            this._spawnRandom();
        }

        // Animation
        const time = performance.now() * 0.001;
        const pickupSize = config.POWERUP.PICKUP_RADIUS * 2;
        this._pickupBoxSize.set(pickupSize, pickupSize, pickupSize);
        for (const item of this.items) {
            item.mesh.rotation.y += config.POWERUP.ROTATION_SPEED * dt;
            item.mesh.position.y = item.baseY + Math.sin(time * config.POWERUP.BOUNCE_SPEED + item.phase) * config.POWERUP.BOUNCE_HEIGHT;

            // Bounding Box aktualisieren
            item.box.setFromCenterAndSize(
                item.mesh.position,
                this._pickupBoxSize
            );
        }
    }

    _spawnRandom() {
        const config = this.entityRuntimeConfig;
        const strategy = typeof this.getStrategy === 'function' ? this.getStrategy() : null;
        const huntModeActive = strategy?.modeType === 'HUNT';
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
            ? this._pickAuthoredAnchor(authoredAnchors)
            : null;
        if (!authoredAnchor && itemSpawnAuthoring.requiresAuthoredAnchor) {
            return;
        }
        if (!authoredAnchor && itemSpawnAuthoring.usesRandomFallback !== true) {
            return;
        }

        let type = resolveAuthoredPickupType(authoredAnchor?.anchor, huntModeActive, config) || null;
        if (strategy && huntModeActive) {
            type = strategy.resolveSpawnType(spawnableTypes, config) || type;
        }
        if (!type) {
            type = spawnableTypes[Math.floor(Math.random() * spawnableTypes.length)];
        }
        if (authoredAnchor?.anchor) {
            const fixedType = resolveAuthoredPickupType(authoredAnchor.anchor, huntModeActive, config);
            if (fixedType) {
                type = fixedType;
            }
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
                const level = levels[Math.floor(Math.random() * levels.length)];
                pos = this.arena.getRandomPositionOnLevel(level, 8);
            }
        }
        if (!pos) {
            pos = this.arena.getRandomPosition(8);
        }

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

        this.items.push({
            mesh,
            type,
            box,
            baseY: pos.y,
            phase: Math.random() * Math.PI * 2,
            anchorKey: authoredAnchor?.key || null,
        });
        if (authoredAnchor?.key) {
            this._occupiedAnchorKeys.add(authoredAnchor.key);
        }
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

    /** Prueft ob ein Spieler ein Item einsammelt */
    checkPickup(playerPosition, radius) {
        this._pickupSphere.center.copy(playerPosition);
        this._pickupSphere.radius = radius + this.entityRuntimeConfig.POWERUP.PICKUP_RADIUS;

        for (let i = this.items.length - 1; i >= 0; i--) {
            if (this.items[i].box.intersectsSphere(this._pickupSphere)) {
                const item = this.items.splice(i, 1)[0];
                this._disposeSpawnedItem(item);
                return buildGameplayActionResult({
                    ok: true,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_PICKUP_SUCCESS,
                    mode: 'pickup',
                    type: item.type,
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
        this._occupiedAnchorKeys.clear();
    }

    dispose() {
        this.clear();
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

    _pickAuthoredAnchor(availableAnchors = []) {
        if (!Array.isArray(availableAnchors) || availableAnchors.length === 0) return null;
        let totalWeight = 0;
        for (const entry of availableAnchors) {
            totalWeight += Math.max(0.01, Number(entry.weight) || 1);
        }
        let roll = Math.random() * totalWeight;
        for (const entry of availableAnchors) {
            roll -= Math.max(0.01, Number(entry.weight) || 1);
            if (roll <= 0) {
                return entry;
            }
        }
        return availableAnchors[availableAnchors.length - 1];
    }

    _disposeSpawnedItem(item) {
        if (!item) return;
        if (item.anchorKey) {
            this._occupiedAnchorKeys.delete(item.anchorKey);
        }
        this.renderer.removeFromScene(item.mesh);
        item.mesh.traverse((node) => {
            if (node.material) {
                if (Array.isArray(node.material)) {
                    node.material.forEach((material) => material.dispose());
                } else {
                    node.material.dispose();
                }
            }
        });
    }
}

