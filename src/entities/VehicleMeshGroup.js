import * as THREE from 'three';

import { disposeObject3DResources } from '../shared/rendering/ThreeDisposal.js';

/**
 * Base of the built-in vehicle meshes that build their own geometries and materials.
 *
 * The match teardown detaches a vehicle from its player group and calls its dispose().
 * Object3D.dispose() only fires an event, so a vehicle without this override kept every
 * geometry and material it built on the GPU, once per match.
 */
export class VehicleMeshGroup extends THREE.Group {
    dispose() {
        disposeObject3DResources(this);
        super.dispose();
    }
}
