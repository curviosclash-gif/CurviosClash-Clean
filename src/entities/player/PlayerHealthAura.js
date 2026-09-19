import * as THREE from 'three';
import { configurePlayerHealthAuraObject } from '../../shared/rendering/PlayerHealthAuraLayers.js';

export const PLAYER_HEALTH_AURA_COLORS = Object.freeze({
    critical: 0xff3b30,
    medium: 0xffd60a,
    full: 0x34c759,
});

export const PLAYER_HEALTH_AURA_PULSE_PERIOD_SECONDS = 2.5;

const INNER_SCALE_FACTOR = 1.3;
const OUTER_SCALE_FACTOR = 1.7;
const INNER_OPACITY_MIN = 0.11;
const INNER_OPACITY_MAX = 0.22;
const OUTER_OPACITY_MIN = 0.035;
const OUTER_OPACITY_MAX = 0.09;
const OPACITY_PULSE_DEPTH = 0.06;
const OUTER_SCALE_PULSE_DEPTH = 0.015;
const PLAYER_PHASE_STEP = 2.399963229728653;
const TAU = Math.PI * 2;

const CRITICAL_COLOR = new THREE.Color(PLAYER_HEALTH_AURA_COLORS.critical);
const MEDIUM_COLOR = new THREE.Color(PLAYER_HEALTH_AURA_COLORS.medium);
const FULL_COLOR = new THREE.Color(PLAYER_HEALTH_AURA_COLORS.full);

let sharedGeometry = null;

function getSharedGeometry() {
    if (sharedGeometry) return sharedGeometry;
    sharedGeometry = new THREE.SphereGeometry(1, 16, 12);
    sharedGeometry.userData = sharedGeometry.userData || {};
    sharedGeometry.userData.__sharedNoDispose = true;
    return sharedGeometry;
}

function createAuraMaterial() {
    return new THREE.MeshBasicMaterial({
        color: PLAYER_HEALTH_AURA_COLORS.full,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
    });
}

export function createPlayerHealthAuraState() {
    return {
        visible: false,
        healthRatio: 0,
        innerOpacity: 0,
        outerOpacity: 0,
        outerScaleMultiplier: 1,
        color: new THREE.Color(PLAYER_HEALTH_AURA_COLORS.critical),
    };
}

export function resolvePlayerHealthAuraState({
    hp,
    maxHp,
    timeSeconds = 0,
    playerIndex = 0,
    reduceMotion = false,
    activeGameMode = '',
    alive = false,
    groupVisible = false,
} = {}, target = createPlayerHealthAuraState()) {
    const safeMaxHp = Number(maxHp);
    const safeHp = Number(hp);
    const healthRatio = safeMaxHp > 0 && Number.isFinite(safeHp)
        ? THREE.MathUtils.clamp(safeHp / safeMaxHp, 0, 1)
        : 0;
    const phaseIndex = Number.isInteger(playerIndex) && playerIndex >= 0 ? playerIndex : 0;
    const wave = reduceMotion === true
        ? 0
        : Math.sin((Math.max(0, Number(timeSeconds) || 0) / PLAYER_HEALTH_AURA_PULSE_PERIOD_SECONDS) * TAU
            + phaseIndex * PLAYER_PHASE_STEP);
    const opacityPulse = 1 + wave * OPACITY_PULSE_DEPTH;

    target.visible = activeGameMode === 'HUNT'
        && alive === true
        && groupVisible === true
        && safeMaxHp > 1;
    target.healthRatio = healthRatio;
    target.innerOpacity = THREE.MathUtils.lerp(INNER_OPACITY_MIN, INNER_OPACITY_MAX, healthRatio) * opacityPulse;
    target.outerOpacity = THREE.MathUtils.lerp(OUTER_OPACITY_MIN, OUTER_OPACITY_MAX, healthRatio) * opacityPulse;
    target.outerScaleMultiplier = 1 + wave * OUTER_SCALE_PULSE_DEPTH;

    if (healthRatio <= 0.5) {
        target.color.copy(CRITICAL_COLOR).lerp(MEDIUM_COLOR, healthRatio * 2);
    } else {
        target.color.copy(MEDIUM_COLOR).lerp(FULL_COLOR, (healthRatio - 0.5) * 2);
    }
    return target;
}

export function createPlayerHealthAura(ownerPlayerIndex) {
    const geometry = getSharedGeometry();
    const inner = new THREE.Mesh(geometry, createAuraMaterial());
    const outer = new THREE.Mesh(geometry, createAuraMaterial());
    inner.name = 'player-health-aura-inner';
    outer.name = 'player-health-aura-outer';
    inner.renderOrder = 1;
    outer.renderOrder = 0;
    configurePlayerHealthAuraObject(inner, ownerPlayerIndex);
    configurePlayerHealthAuraObject(outer, ownerPlayerIndex);

    const root = new THREE.Group();
    root.name = 'player-health-aura';
    root.visible = false;
    root.add(outer, inner);

    return {
        root,
        inner,
        outer,
        innerBaseScale: new THREE.Vector3(1, 1, 1),
        outerBaseScale: new THREE.Vector3(1, 1, 1),
        visualState: createPlayerHealthAuraState(),
    };
}

export function syncPlayerHealthAuraBounds(aura, hitboxSize, hitboxCenter) {
    if (!aura?.root || !hitboxSize || !hitboxCenter) return false;
    const halfX = Math.max(0.06, Number(hitboxSize.x) * 0.5 || 0);
    const halfY = Math.max(0.06, Number(hitboxSize.y) * 0.5 || 0);
    const halfZ = Math.max(0.06, Number(hitboxSize.z) * 0.5 || 0);

    aura.root.position.copy(hitboxCenter);
    aura.innerBaseScale.set(halfX * INNER_SCALE_FACTOR, halfY * INNER_SCALE_FACTOR, halfZ * INNER_SCALE_FACTOR);
    aura.outerBaseScale.set(halfX * OUTER_SCALE_FACTOR, halfY * OUTER_SCALE_FACTOR, halfZ * OUTER_SCALE_FACTOR);
    aura.inner.scale.copy(aura.innerBaseScale);
    aura.outer.scale.copy(aura.outerBaseScale);
    return true;
}

export function updatePlayerHealthAura(aura, options) {
    if (!aura?.root) return null;
    const state = resolvePlayerHealthAuraState(options, aura.visualState);
    aura.root.visible = state.visible;
    if (!state.visible) return state;

    aura.inner.material.color.copy(state.color);
    aura.outer.material.color.copy(state.color);
    aura.inner.material.opacity = state.innerOpacity;
    aura.outer.material.opacity = state.outerOpacity;
    aura.inner.scale.copy(aura.innerBaseScale);
    aura.outer.scale.copy(aura.outerBaseScale).multiplyScalar(state.outerScaleMultiplier);
    return state;
}
