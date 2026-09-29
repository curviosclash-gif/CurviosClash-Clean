/** Applies a break-state glow to named meshes when their authored model slot is available. */
export class MapDestructibleGlowController {
    constructor() {
        this._materialBases = new WeakMap();
        this._isolatedMeshes = new WeakSet();
        this._root = null;
        this._definition = null;
        this._active = false;
    }

    update(scene, definition, state) {
        const segmentId = String(definition?.segmentId || '');
        const modelId = String(definition?.modelId || '');
        if (!scene || !segmentId || !modelId) return false;
        const root = scene.getObjectByName?.(`glb-slot-${modelId}`);
        const segment = state?.segments?.find((entry) => entry.id === segmentId);
        const enabled = segment?.destroyed === true;
        if (!root) {
            this._root = null;
            this._definition = definition;
            this._active = enabled;
            return false;
        }
        if (root === this._root && definition === this._definition && enabled === this._active) return false;
        this._root = root;
        this._definition = definition;
        this._active = enabled;
        const meshNames = definition.meshNames;
        let touched = false;
        root.traverse((node) => {
            if (!node?.isMesh || !Array.isArray(meshNames) || !meshNames.includes(node.name)) return;
            if (!this._isolatedMeshes.has(node)) {
                const isMaterialArray = Array.isArray(node.material);
                const sourceMaterials = isMaterialArray ? node.material : [node.material];
                // GLB materials are shared by default. Keep the collapse glow local to the named
                // core meshes, otherwise every concrete mesh using ConcreteDark can glow too.
                const isolatedBySource = new Map();
                const materials = sourceMaterials.map((source) => {
                    if (!source || typeof source.clone !== 'function') return source;
                    let isolated = isolatedBySource.get(source);
                    if (!isolated) {
                        isolated = source.clone();
                        isolatedBySource.set(source, isolated);
                    }
                    return isolated;
                });
                node.material = isMaterialArray ? materials : materials[0];
                this._isolatedMeshes.add(node);
            }
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
                if (!material?.emissive) continue;
                let base = this._materialBases.get(material);
                if (!base) {
                    base = { intensity: material.emissiveIntensity, color: material.emissive.clone() };
                    this._materialBases.set(material, base);
                }
                if (enabled) {
                    material.emissive.setHex(definition.emissive);
                    material.emissiveIntensity = Math.max(base.intensity, Number(definition.emissiveIntensity) || 0);
                } else {
                    material.emissive.copy(base.color);
                    material.emissiveIntensity = base.intensity;
                }
                touched = true;
            }
        });
        return touched;
    }

    clear(scene, definition) {
        const restored = this.update(scene, definition, null);
        this._root = null;
        this._definition = null;
        this._active = false;
        this._materialBases = new WeakMap();
        this._isolatedMeshes = new WeakSet();
        return restored;
    }
}
