// Original Blender exports stay in their authored animation space. Only their parent
// placement is aligned with the course; no animation tracks or source assets are rewritten.
export const ENDLESS_SETPIECES = Object.freeze([
    Object.freeze({ id: 'iris', template: 'sluice_gates', url: 'assets/maps/kinetic_tide/glb/03_iris_shutter.glb',
        center: [0, 0, 0], rotation: [0, 0, 0], scale: 3.2, beatSeconds: 8,
        omitMeshes: ['iris_aperture_signal'] }),
    Object.freeze({ id: 'pistons', template: 'closing_walls', url: 'assets/maps/kinetic_tide/glb/02_piston_tunnel.glb',
        center: [0, 6.3, 0], rotation: [Math.PI / 2, 0, 0], scale: 3.5, beatSeconds: 4 }),
    Object.freeze({ id: 'pendulums', template: 'pendulum_bars', url: 'assets/maps/kinetic_tide/glb/05_pendulum_field.glb',
        center: [0, 4.95, 0], rotation: [0, 0, 0], scale: 2, beatSeconds: 4 }),
    Object.freeze({ id: 'gears', template: 'choke_point', url: 'assets/maps/chrono_forge/glb/02_machine_core.glb',
        center: [0, 3.275, 0], rotation: [0, 0, 0], scale: 2.6, beatSeconds: 8 }),
    Object.freeze({ id: 'airlocks', template: 'sprint_shafts', url: 'assets/maps/orbital_shipyard/glb/12_airlock_doors.glb',
        center: [96, 43.5, -110], rotation: [0, -Math.PI / 2, 0], scale: 0.6, beatSeconds: 12 }),
]);

export function resolveEndlessSetpiece(module) {
    if (!module || module.moduleIndex === 0 || module.recovery) return null;
    return ENDLESS_SETPIECES.find(entry => entry.template === module.templateId) || null;
}
