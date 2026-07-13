import { CONFIG } from '../../Config.js';

const TOPDOWN_HEIGHT = 40;
const TOPDOWN_Z_OFFSET = 5;
const FIRST_PERSON_LOOK_AHEAD = 20;

export class CameraModeStrategySet {
    constructor(collisionSolver) {
        this.collisionSolver = collisionSolver;
    }

    applyCockpitThirdPerson({ target, playerPosition, playerQuaternion, tmpVec }) {
        tmpVec.set(0, CONFIG.CAMERA.FOLLOW_HEIGHT, CONFIG.CAMERA.FOLLOW_DISTANCE);
        tmpVec.applyQuaternion(playerQuaternion);
        target.position.copy(playerPosition).add(tmpVec);
    }

    applyCockpitFirstPerson({
        playerIndex,
        mode,
        target,
        playerPosition,
        playerDirection,
        playerQuaternion,
        lockToNose,
        firstPersonAnchor,
        noseClearance,
        firstPersonOffset,
        arena,
        tmpVec,
    }) {
        if (lockToNose) {
            target.position.copy(firstPersonAnchor);
            if (noseClearance !== 0) {
                target.position.addScaledVector(playerDirection, noseClearance);
            }
            return;
        }

        tmpVec.set(0, 0, -firstPersonOffset);
        tmpVec.applyQuaternion(playerQuaternion);
        target.position.copy(playerPosition).add(tmpVec);
        this.collisionSolver.resolve(playerIndex, mode, playerPosition, target.position, arena);
    }

    applyCockpitTopDown({ target, playerPosition, playerQuaternion, tmpVec }) {
        tmpVec.set(0, TOPDOWN_HEIGHT, TOPDOWN_Z_OFFSET);
        tmpVec.applyQuaternion(playerQuaternion);
        target.position.copy(playerPosition).add(tmpVec);
    }

    applyThirdPerson({ target, playerPosition, playerDirection, tmpVec, tmpVec2 }) {
        tmpVec.copy(playerDirection).multiplyScalar(-CONFIG.CAMERA.FOLLOW_DISTANCE);
        tmpVec.y += CONFIG.CAMERA.FOLLOW_HEIGHT;
        target.position.copy(playerPosition).add(tmpVec);

        tmpVec2.copy(playerDirection).multiplyScalar(CONFIG.CAMERA.LOOK_AHEAD);
        target.lookAt.copy(playerPosition).add(tmpVec2);
    }

    applyFirstPerson({
        playerIndex,
        mode,
        target,
        playerPosition,
        playerDirection,
        lockToNose,
        firstPersonAnchor,
        noseClearance,
        firstPersonOffset,
        arena,
        tmpVec,
        tmpVec2,
    }) {
        if (lockToNose) {
            target.position.copy(firstPersonAnchor);
            if (noseClearance !== 0) {
                target.position.addScaledVector(playerDirection, noseClearance);
            }
            tmpVec2.copy(playerDirection).multiplyScalar(FIRST_PERSON_LOOK_AHEAD);
            target.lookAt.copy(target.position).add(tmpVec2);
            return;
        }

        tmpVec.copy(playerDirection).multiplyScalar(firstPersonOffset);
        target.position.copy(playerPosition).add(tmpVec);
        this.collisionSolver.resolve(playerIndex, mode, playerPosition, target.position, arena);

        tmpVec2.copy(playerDirection).multiplyScalar(FIRST_PERSON_LOOK_AHEAD);
        target.lookAt.copy(playerPosition).add(tmpVec2);
    }

    applyTopDown(target, playerPosition) {
        target.position.set(playerPosition.x, playerPosition.y + TOPDOWN_HEIGHT, playerPosition.z + TOPDOWN_Z_OFFSET);
        target.lookAt.copy(playerPosition);
    }
}

