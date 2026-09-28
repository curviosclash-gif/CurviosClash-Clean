import * as THREE from 'three';
import atlas from '../../../assets/vfx/conventional-runtime/profiles.json' with { type: 'json' };
import { selectConventionalExplosionProfile } from './ConventionalExplosionProfiles.js';

const FIRE_URL = new URL('../../../assets/vfx/conventional-runtime/fire-atlas.png', import.meta.url).href;
const SMOKE_URL = new URL('../../../assets/vfx/conventional-runtime/smoke-atlas.png', import.meta.url).href;
export const EXPLOSION_BUDGET = Object.freeze({ events: 24, fireCards: 96, smokeCards: 192, sharedParticles: 1000 });
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

const VERTEX = `
attribute float explosionRow;
uniform sampler2D explosionData;
varying vec2 tileUv;
varying vec3 tileFrames;
varying float opacity;
void main() {
    vec4 center = texture2D(explosionData, vec2(.125, explosionRow));
    vec4 size = texture2D(explosionData, vec2(.375, explosionRow));
    vec4 phase = texture2D(explosionData, vec2(.625, explosionRow));
    vec4 view = texture2D(explosionData, vec2(.875, explosionRow));
    vec4 point = modelViewMatrix * vec4(center.xyz, 1.);
    point.xy += position.xy * size.xy;
    gl_Position = projectionMatrix * point;
    tileUv = uv;
    tileFrames = vec3(phase.x + view.x*8., phase.y, phase.z);
    opacity = center.w;
}`;
const FRAGMENT = `
uniform sampler2D explosionAtlas;
uniform float fireLayer;
varying vec2 tileUv;
varying vec3 tileFrames;
varying float opacity;
vec4 tile(float frame) {
    // Half-texel inset and transparent tile padding stop neighbouring frames bleeding in.
    vec2 p = mix(vec2(.5/128.), vec2(1.-.5/128.), tileUv);
    return texture2D(explosionAtlas, vec2((frame+p.x)/16., (9.-tileFrames.y+p.y)/10.));
}
void main() {
    vec4 color = mix(tile(tileFrames.x), tile(min(floor(tileFrames.x/8.)*8.+7., tileFrames.x+1.)), tileFrames.z);
    if (fireLayer > .5) {
        float heat = dot(color.rgb, vec3(.2126, .7152, .0722));
        color.rgb = mix(vec3(1., .16, .025), vec3(1., .82, .28), smoothstep(.36, .94, heat));
        color.a = pow(color.a, 1.15);
    } else {
        float soot = dot(color.rgb, vec3(.2126, .7152, .0722));
        color.rgb = vec3(.31, .35, .39) * mix(.8, 1.2, soot);
        color.a = pow(color.a, 1.25);
    }
    color.a *= opacity;
    if (color.a < .003) discard;
    gl_FragColor = color;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export class ConventionalExplosionEffect {
    constructor(renderer, { loadTexture = null } = {}) {
        this.renderer = renderer;
        this.disposed = false;
        this.ready = false;
        this.count = 0;
        this.nextId = 1;
        this.epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        this.events = Array.from({ length: EXPLOSION_BUDGET.events }, () => ({
            id: 0, profile: null, age: 0, scale: 1, color: 0, kind: '', replicate: true, useAtlas: false,
            projectileType: '', wireId: '', fireSuppressed: false,
            position: new THREE.Vector3(), orientation: new THREE.Quaternion(),
        }));
        this._point = new THREE.Vector3();
        this._normal = new THREE.Vector3();
        this._eventOrder = this.events.slice();
        this.layers = [];
        this.textures = [];
        // Contract/headless consumers keep the existing geometric fallback.
        if (!loadTexture && typeof document === 'undefined') {
            this.loading = Promise.resolve(false);
            return;
        }
        const loader = loadTexture || ((url) => new THREE.TextureLoader().loadAsync(url));
        this.loading = Promise.allSettled([loader(FIRE_URL), loader(SMOKE_URL)]).then((results) => {
            const textures = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
            if (this.disposed || textures.length !== 2) {
                for (const texture of new Set(textures)) texture.dispose();
                return false;
            }
            this.textures = textures;
            for (const texture of textures) {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.generateMipmaps = false;
                texture.minFilter = texture.magFilter = THREE.LinearFilter;
            }
            this._createLayer('fire', textures[0], EXPLOSION_BUDGET.fireCards);
            this._createLayer('smoke', textures[1], EXPLOSION_BUDGET.smokeCards);
            this.ready = true;
            return true;
        }).catch(() => false);
    }

    _createLayer(kind, texture, capacity) {
        const quad = new THREE.PlaneGeometry(1, 1);
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = quad.index;
        geometry.attributes.position = quad.attributes.position;
        geometry.attributes.uv = quad.attributes.uv;
        const rows = new Float32Array(capacity);
        for (let i = 0; i < capacity; i++) rows[i] = (i+.5)/capacity;
        geometry.setAttribute('explosionRow', new THREE.InstancedBufferAttribute(rows, 1));
        geometry.instanceCount = 0;
        const data = new Float32Array(capacity*16);
        const dataTexture = new THREE.DataTexture(data, 4, capacity, THREE.RGBAFormat, THREE.FloatType);
        dataTexture.needsUpdate = true;
        const material = new THREE.ShaderMaterial({
            uniforms: { explosionData: { value: dataTexture }, explosionAtlas: { value: texture },
                fireLayer: { value: kind === 'fire' ? 1 : 0 } },
            vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true,
            depthTest: true, depthWrite: false, toneMapped: kind !== 'fire',
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `conventional-explosion-${kind}_nocol_noshadow`;
        mesh.frustumCulled = false;
        mesh.renderOrder = kind === 'smoke' ? 4 : 5;
        const layer = { kind, capacity, data, dataTexture, mesh, active: 0,
            cards: Array.from({ length: capacity }, () => ({ x: 0, y: 0, z: 0, width: 0, height: 0,
                opacity: 0, frame: 0, row: 0, blend: 0, view: 0, depth: 0 })) };
        layer.compare = (a, b) => a.depth-b.depth;
        // Data textures are uploaded when uniforms bind, after onBeforeRender. Unlike
        // vertex attributes this therefore works on the first draw and for every split view.
        mesh.onBeforeRender = (_webgl, scene, camera) => this.prepareLayer(layer, camera, scene);
        this.layers.push(layer);
        this.renderer?.addToScene?.(mesh);
    }

    spawn(position, context = {}, scale = 1, color = 0xffa050, age = 0) {
        if (this.disposed || !position) return false;
        const profile = selectConventionalExplosionProfile(context);
        if (!atlas.profiles[profile.id]) return false;
        let index = -1;
        for (let i = 0; i < this.events.length; i++) if (!this.events[i].profile) { index = i; break; }
        if (index < 0) {
            index = 0;
            for (let i = 1; i < this.events.length; i++) if (this.events[i].age > this.events[index].age) index = i;
        } else this.count++;
        const event = this.events[index];
        event.id = this.nextId++;
        event.profile = profile;
        event.age = Math.max(0, Number(age) || 0);
        event.scale = Math.max(.1, Math.min(4, Number(scale) || 1));
        event.color = color;
        event.kind = context.kind || 'rocket';
        event.projectileType = context.projectileType || '';
        event.replicate = context.replicate !== false;
        event.useAtlas = this.ready;
        event.wireId = context.networkId || '';
        event.fireSuppressed = context.fireSuppressed === true;
        event.position.copy(position);
        if (event.kind === 'death' || event.kind === 'ground-unit') {
            // A fatal impact keeps its fragments/smoke and audio, but the vehicle's
            // larger fire pulse replaces the fresh overlapping rocket fire shell.
            for (const impact of this.events) {
                if (impact !== event && impact.profile && impact.kind === 'rocket' && impact.age <= .08
                    && impact.position.distanceToSquared(position) < (impact.profile.radius*impact.scale)**2) {
                    impact.fireSuppressed = true;
                }
            }
        }
        event.orientation.identity();
        const normal = context.contact?.hit === true ? context.contact.normal : null;
        if (Array.isArray(context.orientation) && context.orientation.length === 4 && context.orientation.every(Number.isFinite)) {
            event.orientation.fromArray(context.orientation).normalize();
            return this.ready;
        }
        if (normal) {
            this._normal.copy(normal);
            if (this._normal.lengthSq() > .000001) {
                this._normal.normalize();
                event.orientation.setFromUnitVectors(profile.id === 'ground-breach' ? RIGHT : UP, this._normal);
            }
        } else if (profile.id === 'air-elongated' && context.direction) {
            this._normal.copy(context.direction);
            if (this._normal.lengthSq() > .000001) event.orientation.setFromUnitVectors(RIGHT, this._normal.normalize());
        }
        return this.ready;
    }

    update(dt) {
        for (const event of this.events) {
            if (!event.profile) continue;
            event.age += Math.max(0, Number(dt) || 0);
            if (event.age >= event.profile.lifetime) { event.profile = null; this.count--; }
        }
        if (!this.count) for (const layer of this.layers) layer.mesh.geometry.instanceCount = 0;
    }

    prepareLayer(layer, camera, scene) {
        if (this.disposed) return;
        let active = 0;
        const low = String(scene?.userData?.graphicsQuality || '').toUpperCase() === 'LOW';
        const view = camera.matrixWorldInverse.elements;
        for (let i = 1; i < this._eventOrder.length; i++) {
            const event = this._eventOrder[i]; let j = i-1;
            while (j >= 0 && this._eventOrder[j].id < event.id) { this._eventOrder[j+1] = this._eventOrder[j]; j--; }
            this._eventOrder[j+1] = event;
        }
        // Newest events keep their fire. Smoke LOD considers this draw's camera, not
        // whichever split view happened to render first.
        for (let i = 0; i < this._eventOrder.length; i++) {
            const event = this._eventOrder[i];
            if (!event.profile || !event.useAtlas || (layer.kind === 'fire' && event.fireSuppressed)) continue;
            const source = atlas.profiles[event.profile.id];
            const phase = 1+71*Math.min(1, event.age/event.profile.lifetime);
            let key = 0;
            while (key < atlas.frames.length-2 && phase > atlas.frames[key+1]) key++;
            const blend = Math.min(1, (phase-atlas.frames[key])/(atlas.frames[key+1]-atlas.frames[key]));
            const scale = event.profile.radius*event.scale/source.referenceRadius;
            const groundLift = event.profile.id.startsWith('ground-') && event.profile.id !== 'ground-breach';
            if (groundLift) this._normal.copy(UP).applyQuaternion(event.orientation);
            const distance = camera.position.distanceTo(event.position)/Math.max(1, event.profile.radius*event.scale);
            const stride = layer.kind === 'smoke' ? (distance > 45 ? 8 : distance > 24 || low ? 3 : 1) : (low ? 2 : 1);
            let ordinal = 0;
            for (const sourceCard of source.cards) {
                if (sourceCard.layer !== layer.kind) continue;
                if (ordinal++ % stride) continue;
                if (active >= layer.capacity) break;
                const a = sourceCard.poses[key], b = sourceCard.poses[key+1];
                const card = layer.cards[active++];
                card.width = Math.max(a[3]+(b[3]-a[3])*blend, a[5]+(b[5]-a[5])*blend)*scale*1.3;
                card.height = (a[4]+(b[4]-a[4])*blend)*scale*1.3;
                this._point.set(a[0]+(b[0]-a[0])*blend, a[1]+(b[1]-a[1])*blend, a[2]+(b[2]-a[2])*blend)
                    .multiplyScalar(scale).applyQuaternion(event.orientation).add(event.position);
                if (groundLift) {
                    const clearance = (this._point.x-event.position.x)*this._normal.x
                        +(this._point.y-event.position.y)*this._normal.y
                        +(this._point.z-event.position.z)*this._normal.z;
                    this._point.addScaledVector(this._normal, Math.max(0, card.height*.5-clearance)+.02*scale);
                }
                card.x = this._point.x; card.y = this._point.y; card.z = this._point.z;
                const fade = Math.min(1, Math.max(0, (1-event.age/event.profile.lifetime)/.3));
                card.opacity = (layer.kind === 'fire' ? .9 : .68)*fade;
                const texturePhase = Math.max(1, phase-(sourceCard.delay || 0));
                let textureKey = 0;
                while (textureKey < atlas.frames.length-2 && texturePhase > atlas.frames[textureKey+1]) textureKey++;
                card.frame = textureKey;
                card.blend = Math.min(1, (texturePhase-atlas.frames[textureKey])/(atlas.frames[textureKey+1]-atlas.frames[textureKey]));
                card.row = source.row;
                card.view = camera.position.z >= event.position.z ? 1 : 0;
                card.depth = view[2]*card.x+view[6]*card.y+view[10]*card.z+view[14];
            }
        }
        // Sort only active entries; unused pool rows never displace live cards.
        // Insertion sort is bounded and avoids a fresh array for each camera draw.
        for (let i = 1; i < active; i++) {
            const card = layer.cards[i]; let j = i-1;
            while (j >= 0 && layer.compare(layer.cards[j], card) > 0) { layer.cards[j+1] = layer.cards[j]; j--; }
            layer.cards[j+1] = card;
        }
        for (let i = 0; i < active; i++) {
            const card = layer.cards[i], offset = i*16;
            layer.data[offset] = card.x; layer.data[offset+1] = card.y; layer.data[offset+2] = card.z;
            layer.data[offset+3] = card.opacity; layer.data[offset+4] = card.width; layer.data[offset+5] = card.height;
            layer.data[offset+8] = card.frame; layer.data[offset+9] = card.row; layer.data[offset+10] = card.blend;
            layer.data[offset+12] = card.view;
        }
        layer.data.fill(0, active*16);
        layer.active = active;
        layer.mesh.geometry.instanceCount = active;
        layer.dataTexture.needsUpdate = true;
    }

    clear() {
        this.count = 0;
        for (const event of this.events) event.profile = null;
        for (const layer of this.layers) {
            layer.active = 0; layer.data.fill(0); layer.dataTexture.needsUpdate = true;
            layer.mesh.geometry.instanceCount = 0;
        }
    }

    serializeNetworkState() {
        const entries = [];
        for (const event of this.events) {
            if (!event.profile || !event.replicate) continue;
            entries.push({ id: `${this.epoch}:${event.id}`, profile: event.profile.id, kind: event.kind,
                pos: event.position.toArray(), orientation: event.orientation.toArray(), age: event.age,
                scale: event.scale, color: event.color, projectileType: event.projectileType,
                ...(event.fireSuppressed ? { fireSuppressed: true } : {}) });
        }
        return entries;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.ready = false;
        this.clear();
        for (const layer of this.layers) {
            this.renderer?.removeFromScene?.(layer.mesh);
            layer.mesh.geometry.dispose(); layer.mesh.material.dispose(); layer.dataTexture.dispose();
        }
        for (const texture of new Set(this.textures)) texture.dispose();
        this.layers.length = this.textures.length = 0;
        this.renderer = null;
    }
}
