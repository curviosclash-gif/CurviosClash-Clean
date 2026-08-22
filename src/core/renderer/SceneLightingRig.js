import * as THREE from 'three';
import { resolveMapLighting } from '../../shared/contracts/MapLightingContract.js';
import { resolveFogRange } from '../../shared/contracts/ViewDistanceContract.js';
import { applySkyGradientColors } from './SceneEnvironmentFactory.js';

const MODERN_STYLE = 'modern';

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
        this._setupLights();
        this._setupAtmosphere();
    }

    _setupLights() {
        this.ambientLight = new THREE.HemisphereLight(0x9bc8ff, this.config.COLORS.AMBIENT_LIGHT, 0.58);
        this.keyLight = new THREE.DirectionalLight(0xfff4e8, 1.35);
        this.keyLight.position.set(30, 50, 30);
        this.keyLight.castShadow = true;
        this.keyLight.shadow.mapSize.set(this.config.RENDER.SHADOW_MAP_SIZE, this.config.RENDER.SHADOW_MAP_SIZE);
        this.keyLight.shadow.camera.near = 1;
        this.keyLight.shadow.camera.far = 150;
        this.keyLight.shadow.camera.left = -60;
        this.keyLight.shadow.camera.right = 60;
        this.keyLight.shadow.camera.top = 60;
        this.keyLight.shadow.camera.bottom = -60;
        this.fillLight = new THREE.DirectionalLight(0x4f86d9, 0.32);
        this.fillLight.position.set(-20, 30, -10);
        this.rimLight = new THREE.DirectionalLight(0x39d9ff, 0.62);
        this.rimLight.position.set(-35, 18, -45);
        this.scene.add(this.ambientLight, this.keyLight, this.fillLight, this.rimLight);
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
        this._applyDirectionalLight(this.keyLight, lighting.key);
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

    _applySkyDomeColors(colors) {
        applySkyGradientColors(this.skyDome.geometry, colors, this._skyRadius);
    }

    dispose() {
        for (const object of [this.skyDome, this.starField]) {
            this.scene.remove(object);
            object.geometry.dispose();
            object.material.dispose();
        }
        this.scene.remove(this.ambientLight, this.keyLight, this.fillLight, this.rimLight);
    }
}
