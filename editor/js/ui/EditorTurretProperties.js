import { getCustomMapConversionScale } from '../../../src/entities/CustomMapLoader.js';
import { getRuntimeMapScale } from '../../../src/shared/contracts/RuntimeMapCatalogContract.js';
import * as THREE from 'three';
import { normalizeStaticTurretDefinition } from '../../../src/shared/contracts/MapSinglePlayerScenarioContract.js';

const FIELDS = Object.freeze({ range: 'propTurretRange', cooldown: 'propTurretCooldown', rocketType: 'propTurretRocketType', maxHp: 'propTurretHp' });

// Editor distances use the same conversion as geometry; property inputs show gameplay units.
export function getEditorTurretAuthoringScale(editor) {
    const arenaSize = editor.getArenaSizeForExport();
    return getCustomMapConversionScale({ arenaSize }).scale / getRuntimeMapScale();
}

export function clearEditorTurretRange(editor) {
    const preview = editor.turretRangePreview;
    if (!preview) return;
    preview.removeFromParent();
    preview.geometry.dispose();
    preview.material.dispose();
    editor.turretRangePreview = null;
}

export function showEditorTurretProperties(editor, object) {
    const isTurret = object?.userData?.type === 'turret';
    if (editor.dom.propTurretFields) editor.dom.propTurretFields.hidden = !isTurret;
    if (!isTurret) {
        clearEditorTurretRange(editor);
        return;
    }
    for (const [field, key] of Object.entries(FIELDS)) {
        const input = editor.dom[key];
        if (!input) continue;
        input.value = String(field === 'range' ? Math.round(object.userData.range / getEditorTurretAuthoringScale(editor) * 100) / 100 : object.userData[field]);
        input.disabled = editor.isObjectLocked?.(object) === true;
    }
    if (!editor.turretRangePreview) {
        const points = [];
        for (let plane = 0; plane < 3; plane++) {
            for (let step = 0; step < 64; step++) {
                for (const angle of [step / 64 * Math.PI * 2, (step + 1) / 64 * Math.PI * 2]) {
                    const c = Math.cos(angle);
                    const s = Math.sin(angle);
                    points.push(...(plane === 0 ? [c, 0, s] : plane === 1 ? [c, s, 0] : [0, c, s]));
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        const preview = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
            color: 0xff4d6d, transparent: true, opacity: 0.35, depthWrite: false,
        }));
        preview.raycast = () => {};
        editor.turretRangePreview = preview;
        editor.core.scene.add(preview);
    }
    editor.turretRangePreview.position.copy(object.position);
    editor.turretRangePreview.scale.setScalar(object.userData.range);
}

export function bindEditorTurretProperties(editor) {
    for (const [field, key] of Object.entries(FIELDS)) {
        editor.dom[key]?.addEventListener('change', () => {
            const object = editor.selectedObject;
            if (object?.userData?.type !== 'turret' || !editor.isManagedObjectAlive(object) || editor.isObjectLocked(object)) return;
            editor.executeHistoryMutation('Edit turret', () => {
                const raw = editor.dom[key].value;
                const value = field === 'rocketType' ? raw : raw.trim() ? Number(raw) : NaN;
                const scale = getEditorTurretAuthoringScale(editor);
                const normalized = normalizeStaticTurretDefinition({ ...object.userData, [field]: field === 'range' ? value * scale : value }, 0, { spatialScale: scale });
                object.userData[field] = normalized[field];
                editor.mapManager.notifyObjectMutated(object);
                editor.showPropPanel(object);
            });
        });
    }
}
