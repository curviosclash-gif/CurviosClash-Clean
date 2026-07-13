import {
    mountGameInstanceForTests,
    resetAppInitializerForTests,
    waitForAppInitializerIdle,
} from './AppInitializerLifecycle.js';

// Dedicated test seam for AppInitializer lifecycle control. Product code only
// imports initializeGameApp via AppInitializer.js.
export {
    mountGameInstanceForTests,
    resetAppInitializerForTests,
    waitForAppInitializerIdle,
};
