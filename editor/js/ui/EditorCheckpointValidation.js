// Parcours checks for the editor export. A checkpoint whose centre sits inside collision cannot be
// flown through properly (the glass_serpent balconies, 17.09.2026), so it blocks the export; a
// checkpoint that is only far from the previous one stays a warning.

export const EDITOR_BLOCKING_CHECKPOINT_CODE = 'checkpoint-blocked';

export function resolveCheckpointValidationItems({ checkpoints = [], isBlocked = () => false, maxSegmentDistance = Infinity } = {}) {
    const blocked = checkpoints.filter((checkpoint) => isBlocked(checkpoint.position));
    const tooFar = [];
    for (let index = 1; index < checkpoints.length; index += 1) {
        if (checkpoints[index - 1].position.distanceTo(checkpoints[index].position) > maxSegmentDistance) {
            tooFar.push(checkpoints[index]);
        }
    }
    return [
        {
            code: EDITOR_BLOCKING_CHECKPOINT_CODE,
            ok: blocked.length === 0,
            label: blocked.length === 0 ? 'Checkpoint-Mitten sind frei' : `${blocked.length} Checkpoint(s) mit blockierter Mitte`,
            objectIds: blocked.map((entry) => entry.userData.id),
        },
        {
            code: 'checkpoint-reachability',
            ok: tooFar.length === 0,
            label: tooFar.length === 0 ? 'Parcours-Segmente wirken erreichbar' : `${tooFar.length} Checkpoint(s) zu weit entfernt`,
            objectIds: tooFar.map((entry) => entry.userData.id),
        },
    ];
}
