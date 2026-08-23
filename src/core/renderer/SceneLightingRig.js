import * as THREE from 'three';
import { resolveMapLighting } from '../../shared/contracts/MapLightingContract.js';
import { resolveFogRange } from '../../shared/contracts/ViewDistanceContract.js';
import { applySkyGradientColors } from './SceneEnvironmentFactory.js';

const MODERN_STYLE = 'modern';

// Scratch objects for the shadow frustum fit - it runs once per map build, but allocating a matrix
// and a vector per call would still be pure waste.
const LIGHT_SPACE_MATRIX = new THREE.Matrix4();
const CORNER_POINT = new THREE.Vector3();

// Atmosphere geometry is local to the camera rather than the map origin. onBeforeRender runs for
// every viewport, so split-screen cameras each receive their own sky without a render-loop branch
// or per-frame allocations.
function followActiveCamera(_renderer, _scene, camera) {
    this.position.copy(camera.position);
    this.updateMatrixWorld(true);
}

function createClassicLighting(config) {
    return {
        key: { direction: [30, 50, 30], color: 0xffffff, intensity: 0.8 },
        fill: { direction: [-20, 30, -10], color: 0x4466aa, intensity: 0.3 },
        rim: { direction: [-35, 18, -45], color: 0x39d9ff, intensity: 0.62 },
        hemisphere: {
            skyColor: config.COLORS.AMBIENT_LIGHT,
            groundColor: config.COLORS.AMBIENT_LIGHT,
        },
        fog: { color: config.COLORS.BACKGROUND, near: 50, far: 200 },
        skyDome: {
            zenithColor: 0x02050f,
            horizonColor: 0x17355a,
            nadirColor: 0x070914,
        },
        starsVisible: false,
        exposureOffset: 0,
    };
}

export class SceneLightingRig {
    constructor({ scene, renderer, config }) {
        this.scene = scene;
        this.renderer = renderer;
        this.config = config;
        this._modernBackgroundColor = new THREE.Color(0x050816);
        this._classicLighting = createClassicLighting(config);
        this._skyRadius = Math.max(120, (Number(config.CAMERA.FAR) || 200) - 5);
        // Shadow coverage until a map reports its own bounds. The old fixed -60..60 frustum lives
        // on as this default, so a scene without an arena looks exactly as it did before.
        this._shadowCenter = new THREE.Vector3(0, 0, 0);
        this._shadowRadius = 60;
        this._shadowBounds = new THREE.Box3(
            new THREE.Vector3(-60, 0, -60),
            new THREE.Vector3(60, 60, 60)
        );
        // Must be a Camera, not a plain Object3D: three's lookAt points +Z at the target for
        // ordinary objects but -Z for cameras and lights. With an Object3D every depth would come
        // out mirrored, and the near and far planes would collapse in front of the map.
        this._shadowProbe = new THREE.Camera();
        this._keyDirection = new THREE.Vector3(30, 50, 30);
        this._setupLights();
        this._setupAtmosphere();
    }

    _setupLights() {
        this.ambientLight = new THREE.HemisphereLight(0x9bc8ff, this.config.COLORS.AMBIENT_LIGHT, 0.58);
        this.keyLight = new THREE.DirectionalLight(0xfff4e8, 1.35);
        this.keyLight.position.set(30, 50, 30);
        this.keyLight.castShadow = true;
        this.keyLight.shadow.mapSize.set(this.config.RENDER.SHADOW_MAP_SIZE, this.config.RENDER.SHADOW_MAP_SIZE);
        this.fillLight = new THREE.DirectionalLight(0x4f86d9, 0.32);
        this.fillLight.position.set(-20, 30, -10);
        this.rimLight = new THREE.DirectionalLight(0x39d9ff, 0.62);
        this.rimLight.position.set(-35, 18, -45);
        // three only follows a moved target if it sits in the scene graph, otherwise the light
        // keeps aiming at the world origin and large maps fall out of the shadow frustum.
        this.scene.add(
            this.ambientLight,
            this.keyLight,
            this.keyLight.target,
            this.fillLight,
            this.rimLight
        );
        this._placeKeyLight();
    }

    // The shadow frustum used to be nailed to -60..60 around the origin while the key light sat at
    // a fixed (30, 50, 30). On a 260 metre map that put the light inside the level and left
    // everything outside the centre without any shadow at all. Both now follow the arena: the
    // direction stays whatever the map's lighting profile asked for, only the distance and the
    // frustum grow with the map.
    setShadowCoverage(bounds) {
        const minX = Number(bounds?.minX);
        const maxX = Number(bounds?.maxX);
        const minY = Number(bounds?.minY);
        const maxY = Number(bounds?.maxY);
        const minZ = Number(bounds?.minZ);
        const maxZ = Number(bounds?.maxZ);
        const values = [minX, maxX, minY, maxY, minZ, maxZ];
        if (!values.every((value) => Number.isFinite(value)) || maxX <= minX || maxZ <= minZ) {
            return false;
        }

        this._shadowBounds.min.set(minX, minY, minZ);
        this._shadowBounds.max.set(maxX, maxY, maxZ);
        this._shadowBounds.getCenter(this._shadowCenter);
        // Only used to park the light far enough outside the map; the frustum itself is fitted to
        // the box below, which is much tighter than this sphere.
        this._shadowRadius = Math.max(
            1,
            0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
        );
        this._placeKeyLight();
        return true;
    }

    getShadowCoverage() {
        return {
            center: this._shadowCenter.toArray(),
            radius: this._shadowRadius,
        };
    }

    // A directional light is defined by its direction alone, so pushing it further out changes
    // nothing about the lighting - it only moves the shadow camera far enough back to see the map.
    _placeKeyLight() {
        const direction = this._keyDirection.lengthSq() > 0.000001
            ? this._keyDirection.clone().normalize()
            : new THREE.Vector3(0, 1, 0);
        const distance = this._shadowRadius * 2.2;
        this.keyLight.position.copy(this._shadowCenter).addScaledVector(direction, distance);
        this.keyLight.target.position.copy(this._shadowCenter);
        this.keyLight.target.updateMatrixWorld();

        // A sphere around the map would have to span the corner-to-corner diagonal from every
        // angle. Projecting the eight box corners into light space gives the smallest frustum that
        // still holds the map: same coverage, more texels on it. How much it saves depends on the
        // shape - about 15% of the area on a chunky 260x180x84 arena, considerably more on a flat
        // one, where the sphere is dominated by a height the map barely uses.
        this._shadowProbe.position.copy(this.keyLight.position);
        this._shadowProbe.lookAt(this._shadowCenter);
        this._shadowProbe.updateMatrixWorld();
        const toLightSpace = LIGHT_SPACE_MATRIX.copy(this._shadowProbe.matrixWorld).invert();

        const { min, max } = this._shadowBounds;
        let left = Infinity;
        let right = -Infinity;
        let bottom = Infinity;
        let top = -Infinity;
        let nearest = -Infinity;
        let farthest = Infinity;
        for (let corner = 0; corner < 8; corner += 1) {
            CORNER_POINT.set(
                corner & 1 ? max.x : min.x,
                corner & 2 ? max.y : min.y,
                corner & 4 ? max.z : min.z
            ).applyMatrix4(toLightSpace);
            left = Math.min(left, CORNER_POINT.x);
            right = Math.max(right, CORNER_POINT.x);
            bottom = Math.min(bottom, CORNER_POINT.y);
            top = Math.max(top, CORNER_POINT.y);
            nearest = Math.max(nearest, CORNER_POINT.z);
            farthest = Math.min(farthest, CORNER_POINT.z);
        }

        const camera = this.keyLight.shadow.camera;
        camera.left = left;
        camera.right = right;
        camera.top = top;
        camera.bottom = bottom;
        // The camera looks down its own -Z, so the nearest corner has the largest z.
        camera.near = Math.max(0.5, -nearest);
        camera.far = Math.max(camera.near + 1, -farthest);
        camera.updateProjectionMatrix();
    }

    _setupAtmosphere() {
        const radius = this._skyRadius;
        const skyGeometry = new THREE.SphereGeometry(radius, 32, 18);
        skyGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(
            skyGeometry.getAttribute('position').count * 3,
        ), 3));
        const skyMaterial = new THREE.MeshBasicMaterial({
            side: THREE.BackSide,
            vertexColors: true,
            depthWrite: false,
            fog: false,
            toneMapped: false,
        });
        this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
        this.skyDome.name = 'scene-atmosphere-sky';
        this.skyDome.renderOrder = -1000;
        this.skyDome.frustumCulled = false;
        this.skyDome.onBeforeRender = followActiveCamera;

        const starPositions = this._createStarPositions(radius, 360);
        const starGeometry = new THREE.BufferGeometry();
        starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        const starMaterial = new THREE.PointsMaterial({
            color: 0xb9dcff,
            size: 0.42,
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
            fog: false,
            toneMapped: false,
        });
        this.starField = new THREE.Points(starGeometry, starMaterial);
        this.starField.name = 'scene-atmosphere-stars';
        this.starField.renderOrder = -900;
        this.starField.frustumCulled = false;
        this.starField.onBeforeRender = followActiveCamera;
        this.scene.add(this.skyDome, this.starField);
    }

    _createStarPositions(radius, starCount) {
        const positions = new Float32Array(starCount * 3);
        let seed = 0x5f3759df;
        const nextRandom = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 0x100000000;
        };
        for (let i = 0; i < starCount; i += 1) {
            const theta = nextRandom() * Math.PI * 2;
            const y = nextRandom() * 2 - 1;
            const ring = Math.sqrt(Math.max(0, 1 - y * y));
            const distance = radius * (0.86 + nextRandom() * 0.08);
            positions[i * 3] = Math.cos(theta) * ring * distance;
            positions[i * 3 + 1] = y * distance;
            positions[i * 3 + 2] = Math.sin(theta) * ring * distance;
        }
        return positions;
    }

    apply({ graphicsStyle, mapLighting, brightnessFactors, viewDistance }) {
        const modern = graphicsStyle === MODERN_STYLE;
        const styleLighting = modern ? undefined : this._classicLighting;
        const lighting = resolveMapLighting(mapLighting, styleLighting);
        const baseExposure = modern ? 1.05 : 1.2;
        const baseAmbientIntensity = modern ? 0.58 : 0.8;

        this.scene.background = modern ? this._modernBackgroundColor : null;
        this.scene.fog.color.setHex(lighting.fog.color);
        this.renderer.toneMappingExposure = Math.max(0, baseExposure + lighting.exposureOffset)
            * brightnessFactors.exposure;
        this.ambientLight.color.setHex(lighting.hemisphere.skyColor);
        this.ambientLight.groundColor.setHex(lighting.hemisphere.groundColor);
        this.ambientLight.intensity = baseAmbientIntensity * brightnessFactors.ambient;
        this._applyKeyLight(lighting.key);
        this._applyDirectionalLight(this.fillLight, lighting.fill);
        this._applyDirectionalLight(this.rimLight, lighting.rim);
        this.keyLight.shadow.bias = modern ? -0.0002 : 0;
        this.keyLight.shadow.normalBias = modern ? 0.025 : 0;
        this.rimLight.visible = modern;
        this.skyDome.visible = modern;
        this.starField.visible = modern && lighting.starsVisible;
        this._applySkyDomeColors(lighting.skyDome);

        const fog = resolveFogRange({
            viewDistance,
            brightnessFogFactor: brightnessFactors.fog,
            baseNear: lighting.fog.near,
            baseFar: lighting.fog.far,
        });
        this.scene.fog.near = fog.near;
        this.scene.fog.far = fog.far;
        return lighting;
    }

    _applyDirectionalLight(light, definition) {
        light.position.fromArray(definition.direction);
        light.color.setHex(definition.color);
        light.intensity = definition.intensity;
    }

    // The key light is the only shadow caster, so its placement is bound to the shadow coverage
    // rather than used as a raw position like the fill and rim lights.
    _applyKeyLight(definition) {
        this._keyDirection.fromArray(definition.direction);
        this.keyLight.color.setHex(definition.color);
        this.keyLight.intensity = definition.intensity;
        this._placeKeyLight();
    }

    _applySkyDomeColors(colors) {
        applySkyGradientColors(this.skyDome.geometry, colors, this._skyRadius);
    }

    dispose() {
        for (const object of [this.skyDome, this.starField]) {
            this.scene.remove(object);
            object.geometry.dispose();
            object.material.dispose();
        }
        this.scene.remove(
            this.ambientLight,
            this.keyLight,
            this.keyLight.target,
            this.fillLight,
            this.rimLight
        );
    }
}
