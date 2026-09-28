import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from './helpers.desktop.js';
import { collectErrors, startHuntGame, waitForLoadedGame } from './helpers.js';

// Regular runs keep their proof images in the run's own test-results folder. The
// 80-frame comparison clips per profile are delivery material, not assertions, so
// they are only rendered when a QA folder is requested explicitly.
const QA_DIR = process.env.EXPLOSION_QA_DIR || '';
const outputDir = (testInfo) => QA_DIR || testInfo.outputPath();

test('conventional explosions render from near, far and opposing gameplay cameras and end cleanly', async ({ page, electronApp }, testInfo) => {
    test.setTimeout(240_000);
    const OUT = outputDir(testInfo);
    const errors = collectErrors(page);
    await waitForLoadedGame(page);
    await startHuntGame(page);
    await page.waitForFunction(() => window.GAME_INSTANCE?.entityManager?.particles?.conventionalExplosionEffect?.ready === true,
        null, { timeout: 60_000 });
    const ownPid = electronApp.process().pid;
    const electronProcesses = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -match 'CurviosClash' -and $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"],
    { encoding: 'utf8', windowsHide: true });
    const processes = [].concat(JSON.parse(electronProcesses || '[]'));
    const otherApps = processes.filter((entry) => entry.ProcessId !== ownPid && entry.ParentProcessId !== ownPid)
        .map((entry) => entry.ProcessId);
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, 'electron-processes.json'), JSON.stringify({ ownPid, otherApps, processes }, null, 2));
    const proof = await page.evaluate(async ({ isolated, animationEnabled }) => {
        const game = window.GAME_INSTANCE, runtime = game.renderer;
        const sourceParticles = game.entityManager.particles;
        const scene = new runtime.scene.constructor();
        const particles = new sourceParticles.constructor({
            addToScene: (mesh) => scene.add(mesh), removeFromScene: (mesh) => scene.remove(mesh),
            getGraphicsStyle: () => 'modern', cameras: runtime.cameras,
        }, game.entityManager.entityRuntimeConfig);
        await particles.conventionalExplosionEffect.loading;
        const camera = runtime.cameras[0].clone();
        const Vector = camera.position.constructor;
        let box;
        runtime.scene.traverse((node) => { if (!box && node.geometry?.type === 'BoxGeometry') box = node.geometry.constructor; });
        const Mesh = particles.conventionalExplosionEffect.layers[0].mesh.constructor;
        const Material = particles.rocketBlastEffect.coreMesh.material.constructor;
        const floor = new Mesh(new box(80, 1, 80), new Material({ color: 0x303945 }));
        floor.position.y = -.5; scene.add(floor);
        const gl = runtime.renderer, canvas = gl.domElement;
        const held = { autoClear: gl.autoClear, width: canvas.width, height: canvas.height };
        gl.setScissorTest(false); gl.setViewport(0, 0, held.width, held.height);
        gl.autoClear = true;
        const captures = [], counts = [], timings = [], animation = [];
        const profiles = ['ground-tnt', 'ground-grenade', 'ground-rocket', 'ground-fuel', 'ground-breach',
            'air-compact', 'air-fragment', 'air-elongated', 'air-fuel', 'air-secondary'];
        for (const profile of profiles) {
            for (const [view, position] of [['near', [6, 5, 11]], ['side', [-14, 5, 4]],
                ['rear', [0, 7, -18]], ['far', [0, 15, 65]]]) {
                particles.clear();
                const at = new Vector(0, profile.startsWith('air') ? 8 : 0, 0);
                particles.spawnRocketImpact(at, 'ROCKET_MEDIUM', 0xff9955, { profile });
                particles.update(.32);
                camera.position.set(...position); camera.lookAt(at); camera.updateMatrixWorld();
                gl.info.reset(); gl.render(scene, camera);
                captures.push({ name: `${profile}-${view}.png`, data: canvas.toDataURL('image/png').split(',')[1] });
                counts.push({ profile, view, fire: particles.conventionalExplosionEffect.layers[0].active,
                    smoke: particles.conventionalExplosionEffect.layers[1].active, calls: gl.info.render.calls });
            }
            particles.update(5);
            gl.render(scene, camera);
            captures.push({ name: `${profile}-expired.png`, data: canvas.toDataURL('image/png').split(',')[1] });
            counts.push({ profile, view: 'expired', events: particles.conventionalExplosionEffect.count,
                fire: particles.conventionalExplosionEffect.layers[0].active, smoke: particles.conventionalExplosionEffect.layers[1].active,
                light: particles.rocketBlastEffect.light?.intensity || 0 });
        }
        const wall = new Mesh(new box(50, 50, 1), new Material({ color: 0x394c62 }));
        wall.position.set(0, 8, 7); scene.add(wall);
        particles.clear(); camera.position.set(0, 8, 18); camera.lookAt(new Vector(0, 8, 0)); camera.updateMatrixWorld();
        gl.render(scene, camera); const blockedBefore = canvas.toDataURL('image/png');
        particles.spawnRocketImpact(new Vector(0, 8, 0), 'ROCKET_MEDIUM', 0xff9955, { profile: 'air-compact' });
        particles.update(.32); gl.render(scene, camera);
        const blockedAfter = canvas.toDataURL('image/png');
        captures.push({ name: 'wall-occlusion.png', data: blockedAfter.split(',')[1] });
        scene.remove(wall); wall.geometry.dispose(); wall.material.dispose();
        const viewport = new runtime.viewportSystem.constructor(gl, { width: held.width, height: held.height });
        const cameras = Array.from({ length: 4 }, () => camera.clone());
        const views = [[6, 11, 18], [-18, 11, 2], [0, 15, -24], [0, 18, 70]];
        for (let i = 0; i < cameras.length; i++) { cameras[i].position.set(...views[i]); cameras[i].lookAt(new Vector(0, 8, 0)); cameras[i].updateMatrixWorld(); }
        for (const layout of ['two_columns', 'four_grid']) {
            viewport.setViewportLayout(layout, cameras); viewport.render(scene, cameras);
            captures.push({ name: `splitscreen-${layout}.png`, data: canvas.toDataURL('image/png').split(',')[1] });
        }
        // Same hardware, scene, pixels, poses and synchronous GPU completion. These
        // are render durations, not gameplay FPS or a universal performance promise.
        const effect = particles.conventionalExplosionEffect;
        const finish = () => gl.getContext().finish();
        for (const events of (isolated ? [8, 24] : [])) {
            for (const mode of ['baseline', 'runtime']) {
                particles.clear();
                effect.ready = mode !== 'baseline';
                for (let i = 0; i < events; i++) particles.spawnRocketImpact(
                    new Vector((i%4-1.5)*4, 8+Math.floor(i/4)*2, 0), 'ROCKET_MEDIUM', 0xff9955, { profile: 'air-compact' });
                particles.update(.32);
                for (const layout of ['single', 'four_grid']) {
                    viewport.setViewportLayout(layout, cameras);
                    for (let warm = 0; warm < 6; warm++) { viewport.render(scene, cameras); finish(); }
                    const samples = [];
                    for (let sample = 0; sample < 30; sample++) {
                        const begin = performance.now(); viewport.render(scene, cameras); finish(); samples.push(performance.now()-begin);
                    }
                    samples.sort((a, b) => a-b);
                    timings.push({ events, mode, layout, medianMs: samples[15], p95Ms: samples[28],
                        calls: gl.info.render.calls, fireCards: effect.layers[0].active, smokeCards: effect.layers[1].active });
                }
            }
        }
        effect.ready = true;
        // Deterministic runtime frames for the delivered comparison videos, after
        // timing measurements so PNG encoding cannot contaminate the benchmark.
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = 640; exportCanvas.height = 360;
        const exportContext = exportCanvas.getContext('2d');
        gl.setScissorTest(false); gl.setViewport(0, 0, held.width, held.height);
        for (const profile of (animationEnabled ? profiles : [])) {
            particles.clear();
            const at = new Vector(0, profile.startsWith('air') ? 8 : 0, 0);
            camera.position.copy(at).add(new Vector(9, 6, 16)); camera.lookAt(at); camera.updateMatrixWorld();
            particles.spawnRocketImpact(at, 'ROCKET_MEDIUM', 0xff9955, { profile });
            for (let frame = 0; frame < 80; frame++) {
                gl.render(scene, camera); exportContext.drawImage(canvas, 0, 0, 640, 360);
                exportContext.fillStyle = 'rgba(0,0,0,.65)'; exportContext.fillRect(0, 0, 640, 32);
                exportContext.font = '18px Arial'; exportContext.fillStyle = '#fff'; exportContext.fillText(profile, 12, 23);
                animation.push({ profile, frame, data: exportCanvas.toDataURL('image/png').split(',')[1] });
                particles.update(1/25);
            }
        }
        particles.dispose(); floor.geometry.dispose(); floor.material.dispose();
        gl.autoClear = held.autoClear; runtime.render();
        return { captures, counts, timings, animation, wallOccluded: blockedBefore === blockedAfter };
    }, { isolated: otherApps.length === 0, animationEnabled: Boolean(QA_DIR) && process.env.EXPLOSION_BENCH_ONLY !== '1' });
    for (const shot of proof.captures) await writeFile(path.join(OUT, shot.name), Buffer.from(shot.data, 'base64'));
    for (const frame of proof.animation) {
        const directory = path.join(OUT, 'frames', frame.profile);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, `${String(frame.frame).padStart(4, '0')}.png`), Buffer.from(frame.data, 'base64'));
    }
    await writeFile(path.join(OUT, 'desktop-metrics.json'), JSON.stringify({ counts: proof.counts,
        timings: proof.timings, isolated: otherApps.length === 0, otherElectronPids: otherApps }, null, 2));
    expect(proof.wallOccluded, 'a wall fully occludes both fire and smoke').toBe(true);
    for (const pose of proof.counts) {
        if (pose.view === 'expired') expect({ events: pose.events, fire: pose.fire, smoke: pose.smoke, light: pose.light })
            .toEqual({ events: 0, fire: 0, smoke: 0, light: 0 });
        else { expect(pose.fire).toBeGreaterThan(0); expect(pose.smoke).toBeGreaterThan(0); }
    }
    expect(errors).toEqual([]);
});

test('all ten profiles appear at their real game event entry points', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const OUT = outputDir(testInfo);
    const errors = collectErrors(page);
    await startHuntGame(page);
    await page.waitForFunction(() => window.GAME_INSTANCE?.entityManager?.particles?.conventionalExplosionEffect?.ready);
    const proof = await page.evaluate(() => {
        const game = window.GAME_INSTANCE, manager = game.entityManager;
        const combat = manager.runtimePorts.combat;
        const particles = manager.particles, system = combat.projectileSystem, arena = manager.arena;
        const human = manager.humanPlayers[0], bot = manager.players.find((player) => player.isBot);
        if (!bot) throw new Error('Hunt test requires a bot player');
        const floorY = Number(arena.bounds.minY ?? arena.bounds.min?.y) || 0;
        const maxX = Number(arena.bounds.maxX ?? arena.bounds.max?.x);
        const point = human.position.clone();
        const camera = game.renderer.cameras[0].clone();
        const gl = game.renderer.renderer, canvas = gl.domElement;
        const shots = [], events = [];
        const capture = (label, expected) => {
            const event = particles.conventionalExplosionEffect.events.find((candidate) => candidate.profile?.id === expected);
            if (!event) throw new Error(`Missing ${expected} at ${label}`);
            particles.update(.22);
            camera.position.copy(event.position).add(point.clone().set(label === 'rocket-wall' ? -12 : 12, 10, 18));
            camera.lookAt(event.position); camera.updateMatrixWorld();
            gl.setScissorTest(false); gl.setViewport(0, 0, canvas.width, canvas.height);
            gl.render(game.renderer.scene, camera);
            shots.push({ name: `event-${label}.png`, data: canvas.toDataURL('image/png').split(',')[1] });
            events.push({ label, profile: event.profile.id, position: event.position.toArray(), effectCount: particles.conventionalExplosionEffect.count });
        };
        const spawn = (owner, type, position, direction) => system.spawnExternalProjectile({ owner, type,
            position, direction, targetReacquireDisabled: true });
        for (const [label, type, position, direction, expected] of [
            ['rocket-floor', 'ROCKET_MEDIUM', [0, floorY+.1, 0], [0, -1, 0], 'ground-rocket'],
            ['weak-rocket-floor', 'ROCKET_WEAK', [0, floorY+.1, 0], [0, -1, 0], 'ground-grenade'],
            ['rocket-wall', 'ROCKET_MEDIUM', [maxX-.1, floorY+12, 0], [1, 0, 0], 'ground-breach'],
            ['rocket-air', 'ROCKET_MEDIUM', [20, floorY+42, 10], [0, 1, 0], 'air-compact'],
        ]) {
            system.clear(); particles.clear();
            const projectile = spawn(human, type, point.clone().set(...position), point.clone().set(...direction));
            if (label === 'rocket-air') projectile.ttl = 0;
            system.update(.02); capture(label, expected);
        }
        for (const gun of [false, true]) {
            system.clear(); particles.clear();
            const at = point.clone().set(20, floorY+45, 10);
            const target = spawn(bot, 'ROCKET_HEAVY', at.clone().add(point.clone().set(1.4, 0, 0)), point.clone().set(-1, 0, 0));
            if (gun) system.interceptRocket(target, human);
            else {
                const interceptor = spawn(human, 'ROCKET_WEAK', at, point.clone().set(1, 0, 0));
                interceptor.isInterceptor = true; interceptor.interceptTargetId = target.traversalId;
                system.update(.02);
            }
            capture(gun ? 'gun-intercept' : 'rocket-intercept', gun ? 'air-fragment' : 'air-elongated');
            if (particles.conventionalExplosionEffect.count !== 1) throw new Error('An intercept must have one shared visual event');
        }
        system.clear(); particles.clear();
        const units = combat.mapUnitSystem;
        if (!units.callBomberStrike(human)) throw new Error('Bomber call unavailable');
        const bomber = units.units.find((unit) => unit.summoned);
        bomber.bombCooldownRemaining = 0;
        bomber.groundPosition.x = 0; bomber.position.x = 0;
        units.update(.01); capture('bomber-bomb', 'ground-tnt');
        particles.clear();
        bomber.takeDamage(10000, { sourcePlayer: human });
        bomber.position.y = floorY+.1; bomber.groundPosition.copy(bomber.position);
        units.update(.1); capture('bomber-crash', 'ground-fuel');
        for (const [label, type, expected] of [['vehicle-death', 'ROCKET_HEAVY', 'air-fuel'],
            ['mega-vehicle-death', 'ROCKET_MEGA', 'air-secondary']]) {
            particles.clear();
            bot.alive = true; bot.hp = 100; bot.position.set(20, floorY+45, 10);
            manager.runtimePorts.runtimeContext.callbacks.lifecycle.killPlayer(bot, 'PROJECTILE', { killer: human, projectileType: type });
            capture(label, expected);
        }
        return { shots, events };
    });
    await mkdir(OUT, { recursive: true });
    for (const shot of proof.shots) await writeFile(path.join(OUT, shot.name), Buffer.from(shot.data, 'base64'));
    await writeFile(path.join(OUT, 'game-event-proof.json'), JSON.stringify(proof.events, null, 2));
    expect(new Set(proof.events.map((event) => event.profile)).size).toBe(10);
    expect(errors).toEqual([]);
});
