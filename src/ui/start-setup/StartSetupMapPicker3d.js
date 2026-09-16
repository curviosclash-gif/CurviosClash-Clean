import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const FALLBACK_MAP_DEFINITION = Object.freeze({
    size: Object.freeze([80, 30, 80]),
    obstacles: Object.freeze([]),
    portals: Object.freeze([]),
});

const identityQuaternion = new THREE.Quaternion();
const instanceMatrix = new THREE.Matrix4();
const instancePosition = new THREE.Vector3();
const instanceScale = new THREE.Vector3();

function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePositiveNumber(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeVector3(value, fallback = [0, 0, 0]) {
    const source = Array.isArray(value) ? value : fallback;
    return [
        normalizeNumber(source[0], fallback[0]),
        normalizeNumber(source[1], fallback[1]),
        normalizeNumber(source[2], fallback[2]),
    ];
}

function selectedOptions(select) {
    return Array.from(select?.options || []).map((option) => ({
        id: String(option.value || '').trim(),
        label: String(option.textContent || option.value || '').trim(),
        collection: String(option.dataset?.mapCollection || 'other').trim(),
        collectionLabel: String(option.dataset?.mapCollectionLabel || 'Weitere Karten').trim(),
    })).filter((entry) => entry.id);
}

function resolveObstacleBox(obstacle) {
    if (Array.isArray(obstacle?.pos) && Array.isArray(obstacle?.size)) {
        const position = normalizeVector3(obstacle.pos);
        const size = normalizeVector3(obstacle.size, [1, 1, 1]).map((value) => Math.max(0.1, Math.abs(value)));
        return { position, size, foam: String(obstacle?.kind || '').toLowerCase() === 'foam' };
    }

    if (String(obstacle?.shape || '').toLowerCase() !== 'tube') return null;
    const start = normalizeVector3(obstacle.start);
    const end = normalizeVector3(obstacle.end);
    const radius = normalizePositiveNumber(obstacle.radius, 1);
    return {
        position: start.map((value, index) => (value + end[index]) * 0.5),
        size: start.map((value, index) => Math.max(radius * 2, Math.abs(end[index] - value) + radius * 2)),
        foam: String(obstacle?.kind || '').toLowerCase() === 'foam',
    };
}

function collectPortalPoints(mapDefinition) {
    const points = [];
    const portals = Array.isArray(mapDefinition?.portals) ? mapDefinition.portals : [];
    portals.forEach((portal) => {
        [portal?.a, portal?.b, portal?.position, portal?.pos].forEach((position) => {
            if (Array.isArray(position) && position.length >= 3) points.push(normalizeVector3(position));
        });
    });
    return points;
}

export function collectSpawnPoints(mapDefinition) {
    const points = [];
    const append = (spawn) => {
        const position = Array.isArray(spawn) ? spawn : (spawn?.position || spawn?.pos);
        if (Array.isArray(position) && position.length >= 3) {
            points.push(normalizeVector3(position));
        } else if (spawn && typeof spawn === 'object') {
            const xyz = [Number(spawn.x), Number(spawn.y), Number(spawn.z)];
            if (xyz.every(Number.isFinite)) points.push(xyz);
        }
    };
    append(mapDefinition?.playerSpawn);
    (Array.isArray(mapDefinition?.botSpawns) ? mapDefinition.botSpawns : []).forEach(append);
    return points;
}

function findRenderSize(element) {
    return {
        width: Math.max(1, Math.floor(normalizeNumber(element?.clientWidth, 0))),
        height: Math.max(1, Math.floor(normalizeNumber(element?.clientHeight, 0))),
    };
}

function disposeMaterial(material) {
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose?.();
}

/** @param {{ ui?: any, listen?: any, readOnly?: boolean }} options */
export function createStartSetupMapPicker3d({ ui, listen, readOnly = false } = {}) {
    const mount = ui?.mapPreview3dMount || null;
    const select = ui?.mapSelect || null;
    if (!mount || (!select && !readOnly)) {
        return Object.freeze({ sync() {}, dispose() {}, getState: () => ({ status: 'unavailable' }) });
    }

    const canvasHost = document.createElement('div');
    canvasHost.className = 'start-map-preview-canvas';
    mount.appendChild(canvasHost);

    const statusLabel = document.createElement('p');
    statusLabel.className = 'menu-hint start-map-preview-status';
    mount.appendChild(statusLabel);

    const fallbackDisposers = [];
    const bind = (target, type, handler) => {
        if (!target?.addEventListener) return;
        if (typeof listen === 'function') {
            listen(target, type, handler);
            return;
        }
        target.addEventListener(type, handler);
        fallbackDisposers.push(() => target.removeEventListener(type, handler));
    };

    let renderer = null;
    let rendererAttempted = false;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let controls = null;
    let mapRoot = null;
    let status = 'booting';
    let activeMapSignature = '';
    let choiceSignature = '';
    let rafId = 0;
    let lastFrameMs = 0;
    let renderWidth = 0;
    let renderHeight = 0;
    let active = true;
    let disposed = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x081321);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(5.8, 5.2, 5.8);

    scene.add(new THREE.HemisphereLight(0xb7dcff, 0x172136, 1.05));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    keyLight.position.set(4, 7, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x4ba9ff, 0.45);
    fillLight.position.set(-5, 3, -4);
    scene.add(fillLight);

    const backgroundGrid = new THREE.GridHelper(8, 16, 0x55c5ff, 0x244867);
    backgroundGrid.position.y = -0.46;
    backgroundGrid.material.transparent = true;
    backgroundGrid.material.opacity = 0.3;
    backgroundGrid.material.depthWrite = false;
    scene.add(backgroundGrid);

    const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
    const boundarySource = new THREE.BoxGeometry(1, 1, 1);
    const boundaryGeometry = new THREE.EdgesGeometry(boundarySource);
    boundarySource.dispose();
    const unitPlaneGeometry = new THREE.PlaneGeometry(1, 1);
    const portalGeometry = new THREE.SphereGeometry(1, 12, 8);
    const spawnGeometry = new THREE.ConeGeometry(1, 2.2, 8);

    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x123653,
        roughness: 0.88,
        metalness: 0.08,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
    });
    const obstacleMaterial = new THREE.MeshStandardMaterial({
        color: 0x58bff3,
        emissive: 0x123e61,
        emissiveIntensity: 0.5,
        roughness: 0.58,
        metalness: 0.22,
    });
    const foamMaterial = new THREE.MeshStandardMaterial({
        color: 0xffa45d,
        emissive: 0x5b2512,
        emissiveIntensity: 0.45,
        roughness: 0.72,
    });
    const boundaryMaterial = new THREE.LineBasicMaterial({
        color: 0x6dd6ff,
        transparent: true,
        opacity: 0.48,
    });
    const portalMaterial = new THREE.MeshBasicMaterial({ color: 0xf16cff });
    const spawnMaterial = new THREE.MeshBasicMaterial({ color: 0x7dffbd });

    function setStatus(nextStatus, text) {
        status = String(nextStatus || 'unknown');
        mount.dataset.previewStatus = status;
        statusLabel.textContent = String(text || '');
    }

    function clearMapRoot() {
        if (!mapRoot) return;
        mapRoot.traverse((child) => {
            if (child?.isInstancedMesh) child.dispose();
        });
        scene.remove(mapRoot);
        mapRoot.clear();
        mapRoot = null;
    }

    function appendInstances(root, entries, geometry, material, resolveTransform) {
        if (!entries.length) return;
        const instances = new THREE.InstancedMesh(geometry, material, entries.length);
        instances.frustumCulled = false;
        entries.forEach((entry, index) => {
            const transform = resolveTransform(entry);
            instancePosition.fromArray(transform.position);
            instanceScale.fromArray(transform.scale);
            instanceMatrix.compose(instancePosition, identityQuaternion, instanceScale);
            instances.setMatrixAt(index, instanceMatrix);
        });
        instances.instanceMatrix.needsUpdate = true;
        root.add(instances);
    }

    function buildMapMiniature(mapKey, mapDefinition) {
        clearMapRoot();
        const definition = mapDefinition && typeof mapDefinition === 'object'
            ? mapDefinition
            : FALLBACK_MAP_DEFINITION;
        const size = normalizeVector3(definition.size, FALLBACK_MAP_DEFINITION.size)
            .map((value, index) => normalizePositiveNumber(value, FALLBACK_MAP_DEFINITION.size[index]));
        const [width, height, depth] = size;
        const footprint = Math.max(width, depth, 1);
        const miniatureScale = 4.8 / footprint;

        mapRoot = new THREE.Group();
        mapRoot.name = `map-miniature-${String(mapKey || 'unknown')}`;
        mapRoot.scale.setScalar(miniatureScale);
        mapRoot.position.y = -0.44;

        const floor = new THREE.Mesh(unitPlaneGeometry, floorMaterial);
        floor.rotation.x = -Math.PI * 0.5;
        floor.scale.set(width, depth, 1);
        floor.receiveShadow = true;
        mapRoot.add(floor);

        const boundary = new THREE.LineSegments(boundaryGeometry, boundaryMaterial);
        boundary.position.y = height * 0.5;
        boundary.scale.set(width, height, depth);
        mapRoot.add(boundary);

        const obstacleBoxes = (Array.isArray(definition.obstacles) ? definition.obstacles : [])
            .map(resolveObstacleBox)
            .filter(Boolean);
        const hardObstacles = obstacleBoxes.filter((entry) => !entry.foam);
        const foamObstacles = obstacleBoxes.filter((entry) => entry.foam);
        const obstacleTransform = (entry) => ({ position: entry.position, scale: entry.size });
        appendInstances(mapRoot, hardObstacles, unitBoxGeometry, obstacleMaterial, obstacleTransform);
        appendInstances(mapRoot, foamObstacles, unitBoxGeometry, foamMaterial, obstacleTransform);

        const markerSize = Math.max(0.8, footprint * 0.018);
        appendInstances(mapRoot, collectPortalPoints(definition), portalGeometry, portalMaterial, (position) => ({
            position,
            scale: [markerSize, markerSize, markerSize],
        }));
        appendInstances(mapRoot, collectSpawnPoints(definition), spawnGeometry, spawnMaterial, (position) => ({
            position,
            scale: [markerSize, markerSize, markerSize],
        }));

        scene.add(mapRoot);
        mount.dataset.previewMapKey = String(mapKey || '');
        mount.dataset.previewObstacleCount = String(obstacleBoxes.length);
        if (renderer) {
            const isSchematicGlbPreview = typeof definition.glbModel === 'string'
                || (Array.isArray(definition.glbModels) && definition.glbModels.length > 0);
            setStatus('ready', isSchematicGlbPreview
                ? 'Schematische Vorschau - 3D-Art wird im Spiel geladen'
                : '3D-Kartenansicht bereit');
        }
    }

    function syncRendererSize(force = false) {
        if (!renderer) return;
        const { width, height } = findRenderSize(canvasHost);
        if (!force && width === renderWidth && height === renderHeight) return;
        renderWidth = width;
        renderHeight = height;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        // Resizing clears the WebGL drawing buffer. A read-only preview has no
        // continuous loop, so the resize itself must request a fresh frame.
        scheduleFrame();
    }

    function scheduleFrame() {
        if (!disposed && active && renderer && !rafId) {
            rafId = window.requestAnimationFrame(stepFrame);
        }
    }

    function stepFrame(nowMs) {
        rafId = 0;
        if (disposed || !active || !renderer) return;
        syncRendererSize(false);
        const dt = lastFrameMs > 0 ? Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = nowMs;
        controls?.update(dt);
        renderer.render(scene, camera);
        if (!readOnly && !reducedMotion?.matches) scheduleFrame();
    }

    const markManualInteraction = () => {
        if (controls) controls.autoRotate = false;
        mount.dataset.previewMotion = 'manual';
    };
    const resumeIdleRotation = () => {
        if (controls) controls.autoRotate = !readOnly && !reducedMotion?.matches;
        mount.dataset.previewMotion = 'idle-spin';
    };

    function initializeRenderer() {
        rendererAttempted = true;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
            renderer.setPixelRatio(Math.min(2, normalizeNumber(window.devicePixelRatio, 1)));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.domElement.className = 'start-map-preview-canvas-node';
            renderer.domElement.setAttribute('aria-label', readOnly ? 'Kartenvorschau der Lobby' : 'Interaktive 3D-Kartenansicht');
            canvasHost.appendChild(renderer.domElement);

            controls = new OrbitControls(camera, renderer.domElement);
            controls.enablePan = false;
            controls.enableDamping = true;
            controls.dampingFactor = 0.075;
            controls.autoRotate = !readOnly && !reducedMotion?.matches;
            controls.enabled = !readOnly;
            controls.addEventListener('change', scheduleFrame);
            controls.autoRotateSpeed = 0.32;
            controls.minDistance = 3.4;
            controls.maxDistance = 10;
            controls.maxPolarAngle = Math.PI * 0.49;
            controls.target.set(0, 0.25, 0);
            controls.update(0);

            mount.addEventListener('pointerdown', markManualInteraction, true);
            window.addEventListener('pointerup', resumeIdleRotation);
            window.addEventListener('pointercancel', resumeIdleRotation);
            window.addEventListener('blur', resumeIdleRotation);
            window.addEventListener('resize', syncRendererSize);
            resumeIdleRotation();
            syncRendererSize(true);
            setStatus('ready', '3D-Kartenansicht bereit');
            scheduleFrame();
        } catch {
            renderer = null;
            controls = null;
            setStatus('fallback', '3D-Kartenansicht aktuell nicht verfügbar.');
        }
    }

    function isPreviewVisible() {
        const sectionOpen = !ui.mapPickerSection || ui.mapPickerSection.open === true;
        const panel = mount.closest?.('.submenu-panel');
        const menu = mount.closest?.('#main-menu');
        const panelVisible = !panel || (!panel.classList.contains('hidden') && panel.getAttribute('aria-hidden') !== 'true');
        const menuVisible = !menu || (!menu.classList.contains('hidden') && menu.getAttribute('aria-hidden') !== 'true');
        return sectionOpen && panelVisible && menuVisible && !mount.classList.contains('hidden') && document.visibilityState !== 'hidden';
    }

    function syncVisibility() {
        if (disposed) return;
        active = isPreviewVisible();
        if (active && !rendererAttempted) initializeRenderer();
        mount.dataset.previewActive = String(active);
        if (!active && rafId) {
            window.cancelAnimationFrame(rafId);
            rafId = 0;
            lastFrameMs = 0;
            return;
        }
        scheduleFrame();
    }

    function selectMap(mapKey) {
        const normalizedMapKey = String(mapKey || '').trim();
        if (!normalizedMapKey) return;
        select.value = normalizedMapKey;
        if (select.value !== normalizedMapKey) return;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function moveSelection(direction) {
        const options = selectedOptions(select);
        if (options.length < 2) return;
        const currentIndex = Math.max(0, options.findIndex((entry) => entry.id === select.value));
        selectMap(options[(currentIndex + direction + options.length) % options.length].id);
    }

    function renderChoices(selectedMapKey) {
        const options = selectedOptions(select);
        const nextSignature = options
            .map((entry) => `${entry.collection}:${entry.id}:${entry.label}`)
            .join('|');
        if (nextSignature !== choiceSignature) {
            choiceSignature = nextSignature;
            const fragment = document.createDocumentFragment();
            const groups = new Map();
            options.forEach((entry) => {
                const group = groups.get(entry.collection) || {
                    label: entry.collectionLabel,
                    entries: [],
                };
                group.entries.push(entry);
                groups.set(entry.collection, group);
            });
            groups.forEach((group) => {
                const groupNode = document.createElement('div');
                groupNode.className = 'start-map-choice-group';
                groupNode.setAttribute('role', 'group');
                groupNode.setAttribute('aria-label', group.label);

                const heading = document.createElement('span');
                heading.className = 'start-map-choice-group-label';
                heading.textContent = group.label;
                groupNode.appendChild(heading);

                const choices = document.createElement('div');
                choices.className = 'start-map-choice-group-row';
                group.entries.forEach((entry) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'start-map-choice';
                    button.dataset.mapKey = entry.id;
                    button.setAttribute('role', 'option');
                    button.textContent = entry.label;
                    choices.appendChild(button);
                });
                groupNode.appendChild(choices);
                fragment.appendChild(groupNode);
            });
            ui.mapPickerChoiceStrip?.replaceChildren(fragment);
        }
        ui.mapPickerChoiceStrip?.querySelectorAll?.('[data-map-key]').forEach((button) => {
            const selected = button.dataset.mapKey === selectedMapKey;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
        });
        const hasAlternatives = options.length > 1;
        if (ui.mapPickerPreviousButton) ui.mapPickerPreviousButton.disabled = !hasAlternatives;
        if (ui.mapPickerNextButton) ui.mapPickerNextButton.disabled = !hasAlternatives;
    }

    function sync({ mapKey, maps } = {}) {
        if (disposed) return;
        const selectedMapKey = String(mapKey || select?.value || 'standard').trim();
        const definition = maps?.[selectedMapKey] || FALLBACK_MAP_DEFINITION;
        const signature = [
            selectedMapKey,
            normalizeVector3(definition.size, FALLBACK_MAP_DEFINITION.size).join('x'),
            Array.isArray(definition.obstacles) ? definition.obstacles.length : 0,
            Array.isArray(definition.portals) ? definition.portals.length : 0,
        ].join('|');
        if (signature !== activeMapSignature) {
            activeMapSignature = signature;
            buildMapMiniature(selectedMapKey, definition);
        }
        if (!readOnly) renderChoices(selectedMapKey);
        syncVisibility();
    }

    function resetView() {
        camera.position.set(5.8, 5.2, 5.8);
        controls?.target.set(0, 0.25, 0);
        controls?.update(0);
        syncRendererSize(true);
    }

    bind(ui.mapPickerPreviousButton, 'click', () => moveSelection(-1));
    bind(ui.mapPickerNextButton, 'click', () => moveSelection(1));
    bind(ui.mapPickerResetButton, 'click', resetView);
    bind(ui.mapPickerChoiceStrip, 'click', (event) => {
        const button = event.target?.closest?.('[data-map-key]');
        if (button) selectMap(button.dataset.mapKey);
    });
    bind(ui.mapPickerSection, 'toggle', syncVisibility);
    bind(document, 'visibilitychange', syncVisibility);

    const menuPanel = mount.closest?.('.submenu-panel');
    const menuRoot = mount.closest?.('#main-menu');
    const visibilityObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(syncVisibility) : null;
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncRendererSize()) : null;
    resizeObserver?.observe(canvasHost);
    if (menuPanel) visibilityObserver?.observe(menuPanel, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
    if (menuRoot) visibilityObserver?.observe(menuRoot, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });

    syncVisibility();

    return Object.freeze({
        sync,
        getState: () => ({
            status,
            mapKey: String(select?.value || ''),
            active: isPreviewVisible(),
        }),
        dispose() {
            if (disposed) return;
            disposed = true;
            visibilityObserver?.disconnect();
            resizeObserver?.disconnect();
            fallbackDisposers.splice(0).forEach((dispose) => dispose());
            if (rafId) window.cancelAnimationFrame(rafId);
            rafId = 0;
            window.removeEventListener('resize', syncRendererSize);
            mount.removeEventListener('pointerdown', markManualInteraction, true);
            window.removeEventListener('pointerup', resumeIdleRotation);
            window.removeEventListener('pointercancel', resumeIdleRotation);
            window.removeEventListener('blur', resumeIdleRotation);
            controls?.dispose();
            controls = null;
            clearMapRoot();
            renderer?.forceContextLoss?.();
            renderer?.dispose?.();
            renderer = null;
            unitBoxGeometry.dispose();
            boundaryGeometry.dispose();
            unitPlaneGeometry.dispose();
            portalGeometry.dispose();
            spawnGeometry.dispose();
            disposeMaterial(floorMaterial);
            disposeMaterial(obstacleMaterial);
            disposeMaterial(foamMaterial);
            disposeMaterial(boundaryMaterial);
            disposeMaterial(portalMaterial);
            disposeMaterial(spawnMaterial);
            backgroundGrid.geometry.dispose();
            disposeMaterial(backgroundGrid.material);
            canvasHost.remove();
            statusLabel.remove();
            ui.mapPickerChoiceStrip?.replaceChildren();
            delete mount.dataset.previewActive;
            delete mount.dataset.previewMapKey;
            delete mount.dataset.previewMotion;
            delete mount.dataset.previewObstacleCount;
            setStatus('disposed', '3D-Kartenansicht beendet');
        },
    });
}
