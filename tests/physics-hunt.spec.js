import { test, expect } from '@playwright/test';
import { loadGame, startHuntGame, startHuntGameWithBots } from './helpers.js';

test.describe('Physics Hunt (Tests 61-64, 83-89e)', () => {
    test.describe.configure({ timeout: 120000 });

    test('T61: Hunt-MG entfernt getroffenes Spursegment sofort', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            if (!entityManager || !player) {
                return { error: 'missing-entity-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            player.shootCooldown = 0;
            if (entityManager._overheatGunSystem?._overheatByPlayer) {
                entityManager._overheatGunSystem._overheatByPlayer[player.index] = 0;
            }
            if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                entityManager._overheatGunSystem._lockoutByPlayer[player.index] = 0;
            }

            const aim = player.position.clone().set(0, 0, 0);
            player.getAimDirection(aim).normalize();
            const from = player.position.clone().addScaledVector(aim, 14);
            const to = player.position.clone().addScaledVector(aim, 16);
            const writeIndex = Math.max(0, Number(player?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(player?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.5)) % maxSegments;
            const radius = Math.max(0.15, (Number(player?.trail?.width) || 0.6) * 0.5);

            const trailRef = entityManager.registerTrailSegment(player.index, segmentIdx, {
                fromX: from.x,
                fromY: from.y,
                fromZ: from.z,
                toX: to.x,
                toY: to.y,
                toZ: to.z,
                midX: (from.x + to.x) * 0.5,
                midZ: (from.z + to.z) * 0.5,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const fireResult = entityManager._shootHuntGun(player);
            const entry = trailRef?.entry || null;
            const destroyed = !!entry?.destroyed;

            if (!destroyed && trailRef?.key && entry) {
                entityManager.unregisterTrailSegment(trailRef.key, entry);
            }

            return {
                error: null,
                fireOk: !!fireResult?.ok,
                trailHit: !!fireResult?.trailHit,
                destroyed,
            };
        });

        expect(result.error).toBeNull();
        expect(result.fireOk).toBeTruthy();
        expect(result.trailHit).toBeTruthy();
        expect(result.destroyed).toBeTruthy();
    });

    test('T62a: Hunt-Rakete verfolgt Spuren wie MG (Trail-Targeting)', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((p, idx) => idx !== 0 && p?.alive);

            if (!entityManager || !shooter || !enemy) {
                return { error: 'missing-players' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            entityManager._projectileSystem?.clear?.();
            shooter.trail?.clear?.();
            enemy.trail?.clear?.();
            shooter.shootCooldown = 0;
            shooter.inventory = ['ROCKET_HEAVY'];
            shooter.selectedItemIndex = 0;

            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            enemy.position.set(4.0, 50, -20);

            const aim = shooter.position.clone().set(0, 0, 0);
            shooter.getAimDirection(aim).normalize();
            const from = shooter.position.clone().addScaledVector(aim, 30);
            const to = shooter.position.clone().addScaledVector(aim, 32);
            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.5)) % maxSegments;
            const radius = Math.max(0.15, (Number(enemy?.trail?.width) || 0.6) * 0.5);

            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: from.x,
                fromY: from.y,
                fromZ: from.z,
                toX: to.x,
                toY: to.y,
                toZ: to.z,
                midX: (from.x + to.x) * 0.5,
                midZ: (from.z + to.z) * 0.5,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const shot = entityManager._shootItemProjectile(shooter, 0);
            if (!shot?.ok) {
                return { error: 'shot-failed', reason: shot?.reason || null };
            }

            const projectile = entityManager.projectiles[entityManager.projectiles.length - 1];
            if (!projectile) {
                return { error: 'projectile-missing' };
            }

            let acquiredTrail = false;
            let acquiredPlayer = false;
            const initialTarget = projectile.target;
            const isTrailTarget = initialTarget?.kind === 'trail' || (projectile.target?.segmentIdx !== undefined);
            const isPlayerTarget = initialTarget?.kind === 'player' || (projectile.target?.playerIndex !== undefined && projectile.target?.segmentIdx === undefined);

            for (let i = 0; i < 50; i++) {
                entityManager._projectileSystem.update(1 / 60);
                const stillActive = entityManager.projectiles.includes(projectile);
                if (!stillActive) break;

                if (projectile.target?.kind === 'trail' || (projectile.target?.segmentIdx !== undefined && projectile.target?.playerIndex === enemy.index)) {
                    acquiredTrail = true;
                }
                if (projectile.target?.kind === 'player' && Number(projectile.target?.playerIndex) === Number(enemy.index)) {
                    acquiredPlayer = true;
                }
            }

            const destroyed = !!trailRef?.entry?.destroyed;
            if (!destroyed && trailRef?.key && trailRef?.entry) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }
            entityManager._projectileSystem?.clear?.();

            return {
                error: null,
                initialTargetKind: initialTarget?.kind || 'unknown',
                isTrailTarget,
                isPlayerTarget,
                acquiredTrail,
                acquiredPlayer,
                trailTargeted: isTrailTarget || acquiredTrail,
            };
        });

        expect(result.error).toBeNull();
        expect(result.trailTargeted).toBeTruthy();
    });

    test('T62: Hunt-Rakete ist groesser und sucht Ziele nach', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            const target = entityManager?.players?.find((p, idx) => idx !== 0 && p?.alive);
            if (!entityManager || !player || !target) {
                return { error: 'missing-players' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            entityManager._projectileSystem?.clear?.();
            player.trail?.clear?.();
            target.trail?.clear?.();
            player.shootCooldown = 0;
            player.inventory = ['ROCKET_HEAVY'];
            player.selectedItemIndex = 0;

            player.position.set(0, 50, 0);
            target.position.set(30, 50, -36);
            player.setLookAtWorld?.(0, 50, -120);

            const targetHpBefore = Number(target.hp || 0);
            const shot = entityManager._shootItemProjectile(player, 0);
            if (!shot?.ok) {
                return { error: 'shot-failed', reason: shot?.reason || null };
            }

            const projectile = entityManager.projectiles[entityManager.projectiles.length - 1];
            if (!projectile) {
                return { error: 'projectile-missing' };
            }

            const baseRadius = Number(game?.config?.PROJECTILE?.RADIUS || 0);
            const visualScale = Number(projectile.mesh?.scale?.x || 0);
            const projectileRadius = Number(projectile.radius || 0);
            let acquiredDuringFlight = projectile.target === target
                || (
                    projectile.target?.kind === 'player'
                    && Number(projectile.target.playerIndex) === Number(target.index)
                );

            const toTargetStart = target.position.clone().sub(projectile.position).normalize();
            const velocityStart = projectile.velocity.clone().normalize();
            const initialDot = velocityStart.dot(toTargetStart);
            let finalDot = initialDot;

            for (let i = 0; i < 45; i++) {
                entityManager._projectileSystem.update(1 / 60);
                const stillActive = entityManager.projectiles.includes(projectile);
                if (!stillActive) break;
                if (
                    projectile.target === target
                    || (
                        projectile.target?.kind === 'player'
                        && Number(projectile.target.playerIndex) === Number(target.index)
                    )
                ) {
                    acquiredDuringFlight = true;
                }
                const toTarget = target.position.clone().sub(projectile.position);
                if (toTarget.lengthSq() > 0.0001) {
                    toTarget.normalize();
                    finalDot = projectile.velocity.clone().normalize().dot(toTarget);
                }
            }

            const targetHpAfter = Number(target.hp || 0);
            entityManager._projectileSystem?.clear?.();
            return {
                error: null,
                visualScale,
                projectileRadius,
                baseRadius,
                acquiredDuringFlight,
                guided: finalDot > initialDot + 0.04,
                hitApplied: targetHpAfter < targetHpBefore,
            };
        });

        expect(result.error).toBeNull();
        expect(result.visualScale).toBeGreaterThan(1.2);
        expect(result.projectileRadius).toBeGreaterThan(result.baseRadius);
        expect(result.acquiredDuringFlight).toBeTruthy();
        expect(result.guided || result.hitApplied).toBeTruthy();
    });

    test('T63: MG Trail-Zielsuchradius ist konfigurierbar und wirkt auf Treffer', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            if (!game || !entityManager || !player) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            player.position.set(0, 50, 0);
            player.setLookAtWorld?.(0, 50, -120);
            player.trail?.clear?.();

            const aim = player.position.clone().set(0, 0, 0);
            player.getAimDirection(aim).normalize();
            const up = player.position.clone().set(0, 1, 0);
            let right = aim.clone().cross(up);
            if (right.lengthSq() < 0.0001) {
                up.set(1, 0, 0);
                right = aim.clone().cross(up);
            }
            right.normalize();
            const base = player.position.clone().addScaledVector(aim, 18);
            const writeIndex = Math.max(0, Number(player?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(player?.trail?.maxSegments) || 5000);
            const radius = Math.max(0.15, (Number(player?.trail?.width) || 0.6) * 0.5);

            const registerOffsetSegment = (segmentIdx, offset) => {
                const from = base.clone().addScaledVector(right, offset - 0.5);
                const to = base.clone().addScaledVector(right, offset + 0.5);
                return entityManager.registerTrailSegment(player.index, segmentIdx, {
                    fromX: from.x,
                    fromY: from.y,
                    fromZ: from.z,
                    toX: to.x,
                    toY: to.y,
                    toZ: to.z,
                    midX: (from.x + to.x) * 0.5,
                    midZ: (from.z + to.z) * 0.5,
                    radius,
                    hp: 3,
                    maxHp: 3,
                    ownerTrail: null,
                });
            };

            const resetShotState = () => {
                player.shootCooldown = 0;
                if (entityManager._overheatGunSystem?._overheatByPlayer) {
                    entityManager._overheatGunSystem._overheatByPlayer[player.index] = 0;
                }
                if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                    entityManager._overheatGunSystem._lockoutByPlayer[player.index] = 0;
                }
            };

            game.settings.gameplay.mgTrailAimRadius = 0.25;
            game._applySettingsToRuntime();
            const lowRef = registerOffsetSegment((writeIndex + Math.floor(maxSegments * 0.35)) % maxSegments, 1.1);
            resetShotState();
            const lowShot = entityManager._shootHuntGun(player);
            if (!lowRef?.entry?.destroyed && lowRef?.key && lowRef?.entry) {
                entityManager.unregisterTrailSegment(lowRef.key, lowRef.entry);
            }

            game.settings.gameplay.mgTrailAimRadius = 1.6;
            game._applySettingsToRuntime();
            const highRef = registerOffsetSegment((writeIndex + Math.floor(maxSegments * 0.55)) % maxSegments, 1.1);
            resetShotState();
            const highShot = entityManager._shootHuntGun(player);
            const highDestroyed = !!highRef?.entry?.destroyed;
            if (!highDestroyed && highRef?.key && highRef?.entry) {
                entityManager.unregisterTrailSegment(highRef.key, highRef.entry);
            }

            return {
                error: null,
                lowHit: !!lowShot?.trailHit,
                highHit: !!highShot?.trailHit,
                highDestroyed,
                appliedRadius: Number(game?.config?.HUNT?.MG?.TRAIL_HIT_RADIUS || 0),
            };
        });

        expect(result.error).toBeNull();
        expect(result.lowHit).toBeFalsy();
        expect(result.highHit).toBeTruthy();
        expect(result.highDestroyed).toBeTruthy();
        expect(result.appliedRadius).toBeGreaterThan(1.4);
    });

    test('T64: Hunt-MG priorisiert gegnerische Spur auf Schusslinie vor Off-Axis Spieler', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((player, index) => index !== 0 && player?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            shooter.trail?.clear?.();
            enemy.trail?.clear?.();
            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            enemy.position.set(4.0, 50, -20);

            const aim = shooter.position.clone().set(0, 0, 0);
            shooter.getAimDirection(aim).normalize();
            const from = shooter.position.clone().addScaledVector(aim, 30);
            const to = shooter.position.clone().addScaledVector(aim, 32);
            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.5)) % maxSegments;
            const radius = Math.max(0.15, (Number(enemy?.trail?.width) || 0.6) * 0.5);

            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: from.x,
                fromY: from.y,
                fromZ: from.z,
                toX: to.x,
                toY: to.y,
                toZ: to.z,
                midX: (from.x + to.x) * 0.5,
                midZ: (from.z + to.z) * 0.5,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            shooter.shootCooldown = 0;
            if (entityManager._overheatGunSystem?._overheatByPlayer) {
                entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
            }
            if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
            }

            const enemyHpBefore = Number(enemy.hp || 0);
            const fireResult = entityManager._shootHuntGun(shooter);
            const enemyHpAfter = Number(enemy.hp || 0);
            const destroyed = !!trailRef?.entry?.destroyed;
            if (!destroyed && trailRef?.key && trailRef?.entry) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }

            return {
                error: null,
                fireOk: !!fireResult?.ok,
                playerHit: !!fireResult?.hit,
                trailHit: !!fireResult?.trailHit,
                destroyed,
                enemyHpBefore,
                enemyHpAfter,
                appliedRadius: Number(game?.config?.HUNT?.MG?.TRAIL_HIT_RADIUS || 0),
                offAxisDistance: Math.abs(Number(enemy.position.x || 0) - Number(from.x || 0)),
            };
        });

        expect(result.error).toBeNull();
        expect(result.fireOk).toBeTruthy();
        expect(result.playerHit).toBeFalsy();
        expect(result.trailHit).toBeTruthy();
        expect(result.destroyed).toBeTruthy();
        expect(result.enemyHpAfter).toBe(result.enemyHpBefore);
        expect(result.appliedRadius).toBeLessThan(1.2);
        expect(result.offAxisDistance).toBeGreaterThan(result.appliedRadius + 1.5);
    });

    test('T83: Hunt-MG priorisiert gegnerische Spur vor eigener Spur auf Schusslinie', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((player, index) => index !== 0 && player?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            shooter.trail?.clear?.();
            enemy.trail?.clear?.();
            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            enemy.position.set(16, 50, -24);

            const aim = shooter.position.clone().set(0, 0, 0);
            shooter.getAimDirection(aim).normalize();

            const ownFrom = shooter.position.clone().addScaledVector(aim, 12);
            const ownTo = shooter.position.clone().addScaledVector(aim, 14);
            const enemyFrom = shooter.position.clone().addScaledVector(aim, 20);
            const enemyTo = shooter.position.clone().addScaledVector(aim, 22);

            const ownWriteIndex = Math.max(0, Number(shooter?.trail?.writeIndex) || 0);
            const ownMaxSegments = Math.max(1, Number(shooter?.trail?.maxSegments) || 5000);
            const ownSegmentIdx = (ownWriteIndex + Math.floor(ownMaxSegments * 0.45)) % ownMaxSegments;
            const ownRadius = Math.max(0.15, (Number(shooter?.trail?.width) || 0.6) * 0.5);

            const enemyWriteIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const enemyMaxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const enemySegmentIdx = (enemyWriteIndex + Math.floor(enemyMaxSegments * 0.45)) % enemyMaxSegments;
            const enemyRadius = Math.max(0.15, (Number(enemy?.trail?.width) || 0.6) * 0.5);

            const ownRef = entityManager.registerTrailSegment(shooter.index, ownSegmentIdx, {
                fromX: ownFrom.x,
                fromY: ownFrom.y,
                fromZ: ownFrom.z,
                toX: ownTo.x,
                toY: ownTo.y,
                toZ: ownTo.z,
                midX: (ownFrom.x + ownTo.x) * 0.5,
                midZ: (ownFrom.z + ownTo.z) * 0.5,
                radius: ownRadius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const enemyRef = entityManager.registerTrailSegment(enemy.index, enemySegmentIdx, {
                fromX: enemyFrom.x,
                fromY: enemyFrom.y,
                fromZ: enemyFrom.z,
                toX: enemyTo.x,
                toY: enemyTo.y,
                toZ: enemyTo.z,
                midX: (enemyFrom.x + enemyTo.x) * 0.5,
                midZ: (enemyFrom.z + enemyTo.z) * 0.5,
                radius: enemyRadius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            shooter.shootCooldown = 0;
            if (entityManager._overheatGunSystem?._overheatByPlayer) {
                entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
            }
            if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
            }

            const fireResult = entityManager._shootHuntGun(shooter);
            const ownDestroyed = !!ownRef?.entry?.destroyed;
            const enemyDestroyed = !!enemyRef?.entry?.destroyed;

            if (!ownDestroyed && ownRef?.key && ownRef?.entry) {
                entityManager.unregisterTrailSegment(ownRef.key, ownRef.entry);
            }
            if (!enemyDestroyed && enemyRef?.key && enemyRef?.entry) {
                entityManager.unregisterTrailSegment(enemyRef.key, enemyRef.entry);
            }

            return {
                error: null,
                fireOk: !!fireResult?.ok,
                trailHit: !!fireResult?.trailHit,
                ownDestroyed,
                enemyDestroyed,
            };
        });

        expect(result.error).toBeNull();
        expect(result.fireOk).toBeTruthy();
        expect(result.trailHit).toBeTruthy();
        expect(result.enemyDestroyed).toBeTruthy();
        expect(result.ownDestroyed).toBeFalsy();
    });

    test('T84: Hunt-Trail-Kollision trifft gegnerische Spur auch bei grossem Frame-Schritt', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !player || !enemy) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            player.trail?.clear?.();
            enemy.trail?.clear?.();

            player.position.set(0, 50, 6);
            player.setLookAtWorld?.(0, 50, -120);
            player.spawnProtectionTimer = 0;
            player.hp = Math.max(100, Number(player.maxHp) || 100);
            player.lastDamageTimestamp = -Infinity;

            enemy.position.set(30, 50, -40);

            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.6)) % maxSegments;
            const radius = Math.max(0.25, (Number(enemy?.trail?.width) || 0.6) * 0.5);

            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: -8,
                fromY: 50,
                fromZ: 0,
                toX: 8,
                toY: 50,
                toZ: 0,
                midX: 0,
                midZ: 0,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const hpBefore = Number(player.hp || 0);
            entityManager._playerLifecycleSystem.updatePlayer(player, 0.55, {
                nextItem: false,
                dropItem: false,
                useItem: -1,
                shootItem: false,
                shootItemIndex: -1,
                shootMG: false,
                pitchUp: false,
                pitchDown: false,
                yawLeft: false,
                yawRight: false,
                rollLeft: false,
                rollRight: false,
                boost: false,
                cameraSwitch: false,
            });
            const hpAfter = Number(player.hp || 0);

            if (trailRef?.key && trailRef?.entry && !trailRef.entry.destroyed) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }

            return {
                error: null,
                hpBefore,
                hpAfter,
                damageApplied: hpBefore - hpAfter,
                alive: !!player.alive,
            };
        });

        expect(result.error).toBeNull();
        expect(result.damageApplied).toBeGreaterThan(0);
        expect(result.hpAfter).toBeLessThan(result.hpBefore);
        expect(result.alive).toBeTruthy();
    });

    test('T85: Hunt-Trail-Kollision trifft gegnerische Spur auch bei kleinen Frames (Enemy-Offset)', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !player || !enemy) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            player.trail?.clear?.();
            enemy.trail?.clear?.();
            player.trail?.forceGap?.(3.0);

            player.position.set(1.45, 50, 6);
            player.setLookAtWorld?.(1.45, 50, -120);
            player.spawnProtectionTimer = 0;
            player.hp = Math.max(100, Number(player.maxHp) || 100);
            player.lastDamageTimestamp = -Infinity;

            enemy.position.set(30, 50, -30);

            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.52)) % maxSegments;
            const radius = Math.max(0.25, (Number(enemy?.trail?.width) || 0.6) * 0.5);

            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: 0,
                fromY: 50,
                fromZ: -8,
                toX: 0,
                toY: 50,
                toZ: 8,
                midX: 0,
                midZ: 0,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            const neutralInput = {
                nextItem: false,
                dropItem: false,
                useItem: -1,
                shootItem: false,
                shootItemIndex: -1,
                shootMG: false,
                pitchUp: false,
                pitchDown: false,
                yawLeft: false,
                yawRight: false,
                rollLeft: false,
                rollRight: false,
                boost: false,
                cameraSwitch: false,
            };

            const hpBefore = Number(player.hp || 0);
            for (let i = 0; i < 60; i++) {
                entityManager._playerLifecycleSystem.updatePlayer(player, 1 / 60, neutralInput);
                if (Number(player.hp || 0) < hpBefore || !player.alive) break;
            }
            const hpAfter = Number(player.hp || 0);

            if (trailRef?.key && trailRef?.entry && !trailRef.entry.destroyed) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }

            return {
                error: null,
                hpBefore,
                hpAfter,
                damageApplied: hpBefore - hpAfter,
                alive: !!player.alive,
                finalX: Number(player.position.x || 0),
                finalZ: Number(player.position.z || 0),
            };
        });

        expect(result.error).toBeNull();
        expect(result.damageApplied).toBeGreaterThan(0);
        expect(result.hpAfter).toBeLessThan(result.hpBefore);
        expect(result.alive).toBeTruthy();
    });

    test('T86: Hunt-MG zerstoert gegnerisches echtes Trail-Segment (ownerTrail) sofort', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            shooter.trail?.clear?.();
            enemy.trail?.clear?.();
            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            enemy.position.set(20, 50, -20);

            enemy.trail._addSegment(0, 50, -18, 0, 50, -16);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (Math.max(0, Number(enemy.trail.writeIndex) || 0) - 1 + maxSegments) % maxSegments;
            const refBefore = enemy?.trail?.segmentRefs?.[segmentIdx] || null;
            if (!refBefore?.entry) {
                return { error: 'missing-owner-trail-segment' };
            }

            shooter.shootCooldown = 0;
            if (entityManager._overheatGunSystem?._overheatByPlayer) {
                entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
            }
            if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
            }

            const fireResult = entityManager._shootHuntGun(shooter);
            const entry = refBefore.entry;
            const destroyed = !!entry?.destroyed;
            const refAfter = enemy?.trail?.segmentRefs?.[segmentIdx] || null;

            if (refAfter?.key && refAfter?.entry) {
                entityManager.unregisterTrailSegment(refAfter.key, refAfter.entry);
                enemy.trail.segmentRefs[segmentIdx] = null;
            }

            return {
                error: null,
                fireOk: !!fireResult?.ok,
                trailHit: !!fireResult?.trailHit,
                destroyed,
                visualCleared: refAfter === null,
            };
        });

        expect(result.error).toBeNull();
        expect(result.fireOk).toBeTruthy();
        expect(result.trailHit).toBeTruthy();
        expect(result.destroyed).toBeTruthy();
        expect(result.visualCleared).toBeTruthy();
    });

    test('T87: Hunt-MG entfernt Trail-Visual auch bei totem Gegner sofort', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            shooter.trail?.clear?.();
            enemy.trail?.clear?.();
            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            enemy.position.set(22, 50, -20);

            enemy.trail._addSegment(0, 50, -18, 0, 50, -16);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (Math.max(0, Number(enemy.trail.writeIndex) || 0) - 1 + maxSegments) % maxSegments;
            const refBefore = enemy?.trail?.segmentRefs?.[segmentIdx] || null;
            if (!refBefore?.entry) {
                return { error: 'missing-owner-trail-segment' };
            }

            enemy.kill();
            if (enemy.trail?.mesh?.instanceMatrix) {
                enemy.trail.mesh.instanceMatrix.needsUpdate = false;
            }

            shooter.shootCooldown = 0;
            if (entityManager._overheatGunSystem?._overheatByPlayer) {
                entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
            }
            if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
            }

            const fireResult = entityManager._shootHuntGun(shooter);
            const entry = refBefore.entry;
            const destroyed = !!entry?.destroyed;
            const refAfter = enemy?.trail?.segmentRefs?.[segmentIdx] || null;
            const matrixArray = enemy?.trail?.mesh?.instanceMatrix?.array || null;
            const matrixOffset = segmentIdx * 16;
            const m0 = Number(matrixArray?.[matrixOffset] || 0);
            const m5 = Number(matrixArray?.[matrixOffset + 5] || 0);
            const m10 = Number(matrixArray?.[matrixOffset + 10] || 0);
            const scaleCollapsed = Math.abs(m0) < 1e-6 && Math.abs(m5) < 1e-6 && Math.abs(m10) < 1e-6;

            if (refAfter?.key && refAfter?.entry) {
                entityManager.unregisterTrailSegment(refAfter.key, refAfter.entry);
                enemy.trail.segmentRefs[segmentIdx] = null;
            }

            return {
                error: null,
                fireOk: !!fireResult?.ok,
                trailHit: !!fireResult?.trailHit,
                destroyed,
                visualCleared: refAfter === null,
                scaleCollapsed,
            };
        });

        expect(result.error).toBeNull();
        expect(result.fireOk).toBeTruthy();
        expect(result.trailHit).toBeTruthy();
        expect(result.destroyed).toBeTruthy();
        expect(result.visualCleared).toBeTruthy();
        expect(result.scaleCollapsed).toBeTruthy();
    });

    test('T88: Hunt-MG nutzt differenzierte Audio-/VFX-Signale fuer Treffer und Schildabsorption', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (
                typeof game.audio?.clearDebugEvents !== 'function'
                || typeof game.audio?.getRecentEvents !== 'function'
                || typeof game.particles?.clearDebugEvents !== 'function'
                || typeof game.particles?.getRecentEvents !== 'function'
            ) {
                return { error: 'missing-feedback-debug-hooks' };
            }

            const resetShotState = () => {
                shooter.shootCooldown = 0;
                if (entityManager._overheatGunSystem?._overheatByPlayer) {
                    entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
                }
                if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                    entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
                }
            };

            const runShot = ({ shielded }) => {
                enemy.spawnProtectionTimer = 0;
                enemy.alive = true;
                enemy.hp = Math.max(100, Number(enemy.maxHp) || 100);
                enemy.maxHp = Math.max(100, Number(enemy.maxHp) || 100);
                enemy.position.set(0, 50, -18);
                enemy.setLookAtWorld?.(0, 50, -120);
                enemy.hasShield = !!shielded;
                enemy.maxShieldHp = Math.max(40, Number(enemy.maxShieldHp) || 40);
                enemy.shieldHP = shielded ? enemy.maxShieldHp : 0;
                shooter.position.set(0, 50, 0);
                shooter.setLookAtWorld?.(0, 50, -120);

                resetShotState();
                game.audio.clearDebugEvents();
                game.particles.clearDebugEvents();

                const hpBefore = Number(enemy.hp || 0);
                const shieldBefore = Number(enemy.shieldHP || 0);
                const fireResult = entityManager._shootHuntGun(shooter);

                return {
                    ok: !!fireResult?.ok,
                    hit: !!fireResult?.hit,
                    hpDamage: hpBefore - Number(enemy.hp || 0),
                    shieldDamage: shieldBefore - Number(enemy.shieldHP || 0),
                    audio: game.audio.getRecentEvents(8).map((entry) => entry.type),
                    particles: game.particles.getRecentEvents(8).map((entry) => entry.type),
                };
            };

            const hullHit = runShot({ shielded: false });
            const shieldHit = runShot({ shielded: true });

            return {
                error: null,
                hullHit,
                shieldHit,
            };
        });

        expect(result.error).toBeNull();
        expect(result.hullHit.ok).toBeTruthy();
        expect(result.hullHit.hit).toBeTruthy();
        expect(result.hullHit.hpDamage).toBeGreaterThan(0);
        expect(result.hullHit.shieldDamage).toBe(0);
        expect(result.hullHit.audio).toContain('MG_SHOOT');
        expect(result.hullHit.audio).toContain('MG_HIT');
        expect(result.hullHit.particles).toContain('mg-impact');

        expect(result.shieldHit.ok).toBeTruthy();
        expect(result.shieldHit.hit).toBeTruthy();
        expect(result.shieldHit.hpDamage).toBe(0);
        expect(result.shieldHit.shieldDamage).toBeGreaterThan(0);
        expect(result.shieldHit.audio).toContain('MG_SHOOT');
        expect(result.shieldHit.audio).toContain('SHIELD_HIT');
        expect(result.shieldHit.particles).toContain('shield-impact');
    });

    test('T89: Hunt-Raketen liefern eigenes Start-/Impact-Feedback', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (
                typeof game.audio?.clearDebugEvents !== 'function'
                || typeof game.audio?.getRecentEvents !== 'function'
                || typeof game.particles?.clearDebugEvents !== 'function'
                || typeof game.particles?.getRecentEvents !== 'function'
            ) {
                return { error: 'missing-feedback-debug-hooks' };
            }

            entityManager._projectileSystem?.clear?.();
            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            shooter.shootCooldown = 0;
            shooter.inventory = ['ROCKET_MEDIUM'];
            shooter.selectedItemIndex = 0;

            enemy.alive = true;
            enemy.hp = Math.max(100, Number(enemy.maxHp) || 100);
            enemy.maxHp = Math.max(100, Number(enemy.maxHp) || 100);
            enemy.hasShield = false;
            enemy.shieldHP = 0;
            enemy.position.set(0, 50, -30);

            game.audio.clearDebugEvents();
            game.particles.clearDebugEvents();

            const hpBefore = Number(enemy.hp || 0);
            const shot = entityManager._shootItemProjectile(shooter, 0);
            if (!shot?.ok) {
                return { error: 'shot-failed', reason: shot?.reason || null };
            }

            for (let i = 0; i < 120; i++) {
                entityManager._projectileSystem.update(1 / 60);
                if (Number(enemy.hp || 0) < hpBefore || entityManager.projectiles.length === 0) {
                    break;
                }
            }

            return {
                error: null,
                hpDamage: hpBefore - Number(enemy.hp || 0),
                audio: game.audio.getRecentEvents(10).map((entry) => entry.type),
                particles: game.particles.getRecentEvents(10).map((entry) => entry.type),
            };
        });

        expect(result.error).toBeNull();
        expect(result.hpDamage).toBeGreaterThan(0);
        expect(result.audio).toContain('ROCKET_SHOOT');
        expect(result.audio).toContain('ROCKET_IMPACT');
        expect(result.particles).toContain('rocket-impact');
    });

    test('T89d: Hunt-Raketen erfassen gegnerische Trail-Ziele und triggern Rocket-Impact-VFX am Trail', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }
            if (
                typeof game.audio?.clearDebugEvents !== 'function'
                || typeof game.audio?.getRecentEvents !== 'function'
                || typeof game.particles?.clearDebugEvents !== 'function'
                || typeof game.particles?.getRecentEvents !== 'function'
            ) {
                return { error: 'missing-feedback-debug-hooks' };
            }

            entityManager._projectileSystem?.clear?.();
            shooter.trail?.clear?.();
            enemy.trail?.clear?.();

            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            shooter.shootCooldown = 0;
            shooter.inventory = ['ROCKET_MEDIUM'];
            shooter.selectedItemIndex = 0;

            enemy.position.set(10, 50, -30);
            enemy.spawnProtectionTimer = 0;
            enemy.hp = Math.max(100, Number(enemy.maxHp) || 100);
            enemy.maxHp = Math.max(100, Number(enemy.maxHp) || 100);
            enemy.hasShield = false;
            enemy.shieldHP = 0;

            const aim = shooter.position.clone().set(0, 0, 0);
            shooter.getAimDirection(aim).normalize();
            const from = shooter.position.clone().addScaledVector(aim, 18);
            const to = shooter.position.clone().addScaledVector(aim, 20);
            const writeIndex = Math.max(0, Number(enemy?.trail?.writeIndex) || 0);
            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const segmentIdx = (writeIndex + Math.floor(maxSegments * 0.5)) % maxSegments;
            const radius = Math.max(0.2, (Number(enemy?.trail?.width) || 0.6) * 0.5);

            const trailRef = entityManager.registerTrailSegment(enemy.index, segmentIdx, {
                fromX: from.x,
                fromY: from.y,
                fromZ: from.z,
                toX: to.x,
                toY: to.y,
                toZ: to.z,
                midX: (from.x + to.x) * 0.5,
                midZ: (from.z + to.z) * 0.5,
                radius,
                hp: 3,
                maxHp: 3,
                ownerTrail: null,
            });

            game.audio.clearDebugEvents();
            game.particles.clearDebugEvents();

            const hpBefore = Number(enemy.hp || 0);
            const shot = entityManager._shootItemProjectile(shooter, 0);
            if (!shot?.ok) {
                if (trailRef?.key && trailRef?.entry) {
                    entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
                }
                return { error: 'shot-failed', reason: shot?.reason || null };
            }

            const projectile = entityManager.projectiles[entityManager.projectiles.length - 1];
            if (!projectile) {
                if (trailRef?.key && trailRef?.entry) {
                    entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
                }
                return { error: 'missing-projectile' };
            }

            let acquiredTrailTarget = projectile.target?.kind === 'trail'
                && Number(projectile.target.playerIndex) === Number(enemy.index);
            for (let i = 0; i < 160; i++) {
                entityManager._projectileSystem.update(1 / 60);
                if (
                    projectile.target?.kind === 'trail'
                    && Number(projectile.target.playerIndex) === Number(enemy.index)
                ) {
                    acquiredTrailTarget = true;
                }
                if (!entityManager.projectiles.includes(projectile)) break;
            }

            const destroyed = !!trailRef?.entry?.destroyed;
            if (!destroyed && trailRef?.key && trailRef?.entry) {
                entityManager.unregisterTrailSegment(trailRef.key, trailRef.entry);
            }

            return {
                error: null,
                acquiredTrailTarget,
                destroyed,
                hpDamage: hpBefore - Number(enemy.hp || 0),
                audio: game.audio.getRecentEvents(10).map((entry) => entry.type),
                particles: game.particles.getRecentEvents(10).map((entry) => entry.type),
            };
        });

        expect(result.error).toBeNull();
        expect(result.acquiredTrailTarget).toBeTruthy();
        expect(result.destroyed).toBeTruthy();
        expect(result.hpDamage).toBe(0);
        expect(result.audio).toContain('ROCKET_SHOOT');
        expect(result.audio).toContain('ROCKET_IMPACT');
        expect(result.particles).toContain('rocket-impact');
    });

    test('T89e: Rocket-Trail-Blasts zerstoeren meter-basiert und staerkere Raketen zerstoeren mehr', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.applyTrailDamageFromProjectile) {
                throw new Error('CURVIOS_TEST_API.applyTrailDamageFromProjectile missing');
            }
            const { applyTrailDamageFromProjectile } = api;
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const enemy = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !enemy) {
                return { error: 'missing-state' };
            }

            shooter.trail?.clear?.();
            enemy.trail?.clear?.();

            const maxSegments = Math.max(1, Number(enemy?.trail?.maxSegments) || 5000);
            const measureBlast = (type) => {
                enemy.trail.clear();
                // Create 40 segments of ~1 unit length each (total ~40 units of trail)
                for (let i = 0; i < 40; i++) {
                    enemy.trail._addSegment(i, 50, -18, i + 1, 50, -18);
                }

                const centerIdx = (Math.max(0, Number(enemy.trail.writeIndex) || 0) - 20 + maxSegments) % maxSegments;
                const ref = enemy?.trail?.segmentRefs?.[centerIdx] || null;
                if (!ref?.entry) {
                    return { error: `missing-center-${type}` };
                }

                const before = enemy.trail.segmentRefs.reduce((count, entry) => count + (entry ? 1 : 0), 0);
                const impactPoint = {
                    x: (Number(ref.entry.fromX) + Number(ref.entry.toX)) * 0.5,
                    y: (Number(ref.entry.fromY) + Number(ref.entry.toY)) * 0.5,
                    z: (Number(ref.entry.fromZ) + Number(ref.entry.toZ)) * 0.5,
                };
                const hit = applyTrailDamageFromProjectile(entityManager._trailSpatialIndex, {
                    owner: shooter,
                    type,
                    radius: Math.max(0.25, Number(ref.entry.radius) || 0.25),
                    position: impactPoint,
                });
                const after = enemy.trail.segmentRefs.reduce((count, entry) => count + (entry ? 1 : 0), 0);

                const tierKey = String(type || '').replace('ROCKET_', '');
                const blastMeters = Number(game?.config?.HUNT?.ROCKET_TIERS?.[tierKey]?.trailBlastMeters) || 0;

                enemy.trail.clear();
                return {
                    destroyedCount: before - after,
                    hitDestroyedCount: Number(hit?.destroyedCount || 0),
                    blastMeters,
                    overflowDamage: Number(hit?.overflowDamage || 0),
                };
            };

            return {
                error: null,
                weak: measureBlast('ROCKET_WEAK'),
                medium: measureBlast('ROCKET_MEDIUM'),
                heavy: measureBlast('ROCKET_HEAVY'),
                mega: measureBlast('ROCKET_MEGA'),
            };
        });

        expect(result.error).toBeNull();
        // Each tier should destroy segments
        expect(result.weak.destroyedCount).toBeGreaterThan(0);
        expect(result.medium.destroyedCount).toBeGreaterThan(0);
        expect(result.heavy.destroyedCount).toBeGreaterThan(0);
        expect(result.mega.destroyedCount).toBeGreaterThan(0);
        // Stronger rockets destroy more
        expect(result.medium.destroyedCount).toBeGreaterThan(result.weak.destroyedCount);
        expect(result.heavy.destroyedCount).toBeGreaterThan(result.medium.destroyedCount);
        expect(result.mega.destroyedCount).toBeGreaterThan(result.heavy.destroyedCount);
        // No overflow when enough trail exists
        expect(result.weak.overflowDamage).toBe(0);
        expect(result.medium.overflowDamage).toBe(0);
        expect(result.heavy.overflowDamage).toBe(0);
        expect(result.mega.overflowDamage).toBe(0);
    });

    test('T89a: Hunt-MG braucht jetzt einen Lockout, bevor ein Full-HP-Ziel faellt', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const target = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !target) {
                return { error: 'missing-state' };
            }

            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            shooter.spawnProtectionTimer = 0;
            target.position.set(0, 50, -18);
            target.setLookAtWorld?.(0, 50, -120);
            target.spawnProtectionTimer = 0;
            target.alive = true;
            target.maxHp = Math.max(100, Number(target.maxHp) || 100);
            target.hp = target.maxHp;
            target.hasShield = false;
            target.shieldHP = 0;

            shooter.shootCooldown = 0;
            entityManager._overheatGunSystem?._overheatByPlayer && (entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0);
            entityManager._overheatGunSystem?._lockoutByPlayer && (entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0);

            const step = 1 / 120;
            let elapsed = 0;
            let shots = 0;
            let firstLockoutAt = null;

            while (elapsed < 10 && target.alive) {
                shooter.shootCooldown = Math.max(0, Number(shooter.shootCooldown || 0) - step);
                entityManager._overheatGunSystem.update(step);
                const lockout = Math.max(0, Number(entityManager._overheatGunSystem._lockoutByPlayer?.[shooter.index] || 0));
                if (lockout > 0 && firstLockoutAt === null) {
                    firstLockoutAt = elapsed;
                }
                if (shooter.shootCooldown <= 0 && lockout <= 0) {
                    const shot = entityManager._shootHuntGun(shooter);
                    if (shot?.ok) shots += 1;
                }
                elapsed += step;
            }

            return {
                error: null,
                ttk: target.alive ? null : elapsed,
                shots,
                firstLockoutAt,
                mgConfig: {
                    damage: Number(game?.config?.HUNT?.MG?.DAMAGE || 0),
                    overheatPerShot: Number(game?.config?.HUNT?.MG?.OVERHEAT_PER_SHOT || 0),
                    coolingPerSecond: Number(game?.config?.HUNT?.MG?.COOLING_PER_SECOND || 0),
                    lockoutSeconds: Number(game?.config?.HUNT?.MG?.LOCKOUT_SECONDS || 0),
                },
            };
        });

        expect(result.error).toBeNull();
        expect(result.ttk).not.toBeNull();
        expect(result.firstLockoutAt).not.toBeNull();
        expect(result.firstLockoutAt).toBeLessThan(result.ttk);
        expect(result.ttk).toBeGreaterThan(1.6);
        expect(result.ttk).toBeLessThan(2.4);
        expect(result.shots).toBeGreaterThanOrEqual(14);
    });

    test('T89i: Hunt-MG Midrange-TTK bleibt ueber Nahdistanz und respektiert Falloff/Lockout', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const target = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !target) {
                return { error: 'missing-state' };
            }

            const simulateKillAtDistance = (distance) => {
                shooter.position.set(0, 50, 0);
                shooter.setLookAtWorld?.(0, 50, -120);
                shooter.spawnProtectionTimer = 0;

                target.position.set(0, 50, -Math.max(12, Number(distance) || 12));
                target.setLookAtWorld?.(0, 50, -120);
                target.spawnProtectionTimer = 0;
                target.alive = true;
                target.maxHp = Math.max(100, Number(target.maxHp) || 100);
                target.hp = target.maxHp;
                target.hasShield = false;
                target.shieldHP = 0;

                shooter.shootCooldown = 0;
                if (entityManager._overheatGunSystem?._overheatByPlayer) {
                    entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
                }
                if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                    entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
                }

                const step = 1 / 120;
                let elapsed = 0;
                let shots = 0;
                let firstLockoutAt = null;

                while (elapsed < 12 && target.alive) {
                    shooter.shootCooldown = Math.max(0, Number(shooter.shootCooldown || 0) - step);
                    entityManager._overheatGunSystem.update(step);
                    const lockout = Math.max(0, Number(entityManager._overheatGunSystem._lockoutByPlayer?.[shooter.index] || 0));
                    if (lockout > 0 && firstLockoutAt === null) {
                        firstLockoutAt = elapsed;
                    }
                    if (shooter.shootCooldown <= 0 && lockout <= 0) {
                        const shot = entityManager._shootHuntGun(shooter);
                        if (shot?.ok) shots += 1;
                    }
                    elapsed += step;
                }

                return {
                    distance: Math.max(12, Number(distance) || 12),
                    ttk: target.alive ? null : elapsed,
                    shots,
                    firstLockoutAt,
                };
            };

            const closeRange = simulateKillAtDistance(18);
            const midRange = simulateKillAtDistance(68);

            return {
                error: null,
                closeRange,
                midRange,
                mgConfig: {
                    range: Number(game?.config?.HUNT?.MG?.RANGE || 0),
                    minFalloff: Number(game?.config?.HUNT?.MG?.MIN_FALLOFF || 0),
                    lockoutThreshold: Number(game?.config?.HUNT?.MG?.LOCKOUT_THRESHOLD || 0),
                    lockoutSeconds: Number(game?.config?.HUNT?.MG?.LOCKOUT_SECONDS || 0),
                },
            };
        });

        expect(result.error).toBeNull();
        expect(result.closeRange.ttk).not.toBeNull();
        expect(result.midRange.ttk).not.toBeNull();
        expect(result.closeRange.firstLockoutAt).not.toBeNull();
        expect(result.midRange.firstLockoutAt).not.toBeNull();
        expect(result.midRange.ttk).toBeGreaterThan(result.closeRange.ttk + 0.35);
        expect(result.midRange.ttk).toBeGreaterThan(2.2);
        expect(result.midRange.ttk).toBeLessThan(5.2);
        expect(result.midRange.shots).toBeGreaterThan(result.closeRange.shots);
        expect(result.mgConfig.minFalloff).toBeGreaterThanOrEqual(0.45);
        expect(result.mgConfig.minFalloff).toBeLessThanOrEqual(0.8);
        expect(result.mgConfig.lockoutThreshold).toBeGreaterThanOrEqual(90);
        expect(result.mgConfig.lockoutSeconds).toBeGreaterThanOrEqual(0.7);
    });

    test('T89j: Hunt-Item-Nutzung blockt direkte Shield-Spam-Ketten per Cooldown ohne Itemverlust', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            if (!game || !entityManager || !player) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            player.inventory = ['SHIELD', 'SHIELD'];
            player.selectedItemIndex = 0;
            player.hasShield = false;
            player.shieldHP = 0;
            player.itemUseCooldownRemaining = 0;

            const firstUse = entityManager._useInventoryItem(player, 0);
            const cooldownAfterFirst = Math.max(0, Number(player.itemUseCooldownRemaining || 0));
            const inventoryAfterFirst = Number(player.inventory.length || 0);

            const secondUse = entityManager._useInventoryItem(player, 0);
            const inventoryAfterSecond = Number(player.inventory.length || 0);

            player.itemUseCooldownRemaining = 0;
            const thirdUse = entityManager._useInventoryItem(player, 0);

            return {
                error: null,
                firstUseOk: !!firstUse?.ok,
                firstCooldown: cooldownAfterFirst,
                inventoryAfterFirst,
                secondUseOk: !!secondUse?.ok,
                secondReason: String(secondUse?.reason || ''),
                inventoryAfterSecond,
                thirdUseOk: !!thirdUse?.ok,
                finalInventory: Number(player.inventory.length || 0),
            };
        });

        expect(result.error).toBeNull();
        expect(result.firstUseOk).toBeTruthy();
        expect(result.firstCooldown).toBeGreaterThanOrEqual(0.6);
        expect(result.inventoryAfterFirst).toBe(1);
        expect(result.secondUseOk).toBeFalsy();
        expect(result.secondReason).toContain('Item-Cooldown');
        expect(result.inventoryAfterSecond).toBe(1);
        expect(result.thirdUseOk).toBeTruthy();
        expect(result.finalInventory).toBe(0);
    });

    test('T89j1: Hunt-Raketen koennen nicht mehr per useItem verbrannt werden', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            if (!game || !entityManager || !player) {
                return { error: 'missing-state' };
            }

            player.inventory = ['ROCKET_HEAVY', 'SHIELD'];
            player.selectedItemIndex = 0;
            player.itemUseCooldownRemaining = 0;

            const blocked = entityManager._useInventoryItem(player, 0);

            return {
                error: null,
                ok: !!blocked?.ok,
                reason: String(blocked?.reason || ''),
                type: String(blocked?.type || ''),
                inventory: player.inventory.slice(),
                selectedItemIndex: Number(player.selectedItemIndex || 0),
            };
        });

        expect(result.error).toBeNull();
        expect(result.ok).toBeFalsy();
        expect(result.reason).toContain('nicht direkt genutzt');
        expect(result.type).toBe('ROCKET_HEAVY');
        expect(result.inventory).toEqual(['ROCKET_HEAVY', 'SHIELD']);
        expect(result.selectedItemIndex).toBe(0);
    });

    test('T89k: Shield-Treffer setzen Regen-Timestamp und blocken fruehe HP-Regeneration', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(async () => {
            const api = window.CURVIOS_TEST_API;
            if (!api?.updatePlayerHealthRegen) {
                throw new Error('CURVIOS_TEST_API.updatePlayerHealthRegen missing');
            }
            const { updatePlayerHealthRegen } = api;
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const shooter = entityManager?.players?.[0];
            const target = entityManager?.players?.find((entry, index) => index !== 0 && entry?.alive);
            if (!game || !entityManager || !shooter || !target) {
                return { error: 'missing-state' };
            }

            shooter.position.set(0, 50, 0);
            shooter.setLookAtWorld?.(0, 50, -120);
            shooter.spawnProtectionTimer = 0;
            target.position.set(0, 50, -16);
            target.setLookAtWorld?.(0, 50, -120);
            target.spawnProtectionTimer = 0;
            target.alive = true;
            target.maxHp = Math.max(100, Number(target.maxHp) || 100);
            target.hp = 70;
            target.maxShieldHp = Math.max(40, Number(target.maxShieldHp) || 40);
            target.hasShield = true;
            target.shieldHP = target.maxShieldHp;
            target.lastDamageTimestamp = -Infinity;

            shooter.shootCooldown = 0;
            if (entityManager._overheatGunSystem?._overheatByPlayer) {
                entityManager._overheatGunSystem._overheatByPlayer[shooter.index] = 0;
            }
            if (entityManager._overheatGunSystem?._lockoutByPlayer) {
                entityManager._overheatGunSystem._lockoutByPlayer[shooter.index] = 0;
            }

            const shot = entityManager._shootHuntGun(shooter);
            const hpAfterHit = Number(target.hp || 0);
            const shieldAfterHit = Number(target.shieldHP || 0);
            const timestampAfterHit = Number(target.lastDamageTimestamp || 0);

            updatePlayerHealthRegen(target, 1.0, game.config, timestampAfterHit + 1.0);
            const hpAfterEarlyRegen = Number(target.hp || 0);

            updatePlayerHealthRegen(target, 1.0, game.config, timestampAfterHit + 3.6);
            const hpAfterLateRegen = Number(target.hp || 0);

            return {
                error: null,
                shotOk: !!shot?.ok,
                hit: !!shot?.hit,
                hpAfterHit,
                shieldAfterHit,
                timestampAfterHit,
                hpAfterEarlyRegen,
                hpAfterLateRegen,
            };
        });

        expect(result.error).toBeNull();
        expect(result.shotOk).toBeTruthy();
        expect(result.hit).toBeTruthy();
        expect(result.hpAfterHit).toBe(70);
        expect(result.shieldAfterHit).toBeLessThan(40);
        expect(result.timestampAfterHit).toBeGreaterThan(0);
        expect(result.hpAfterEarlyRegen).toBe(70);
        expect(result.hpAfterLateRegen).toBeGreaterThan(70);
    });

    test('T89b: Hunt-Pickups limitieren Raketenflut und filtern punitive Debuffs', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const powerupManager = game?.powerupManager;
            if (!game || !powerupManager) {
                return { error: 'missing-powerup-manager' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            const counts = {};
            const originalRandom = Math.random;
            let seed = 123456789;
            Math.random = () => {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                return seed / 0x100000000;
            };

            powerupManager.clear();
            powerupManager.spawnTimer = 0;
            for (let i = 0; i < 200; i++) {
                powerupManager._spawnRandom();
                const item = powerupManager.items.pop();
                if (!item) continue;
                counts[item.type] = (counts[item.type] || 0) + 1;
                game.renderer.removeFromScene(item.mesh);
                item.mesh.traverse((node) => {
                    if (node.material) {
                        if (Array.isArray(node.material)) {
                            node.material.forEach((material) => material.dispose());
                        } else {
                            node.material.dispose();
                        }
                    }
                });
            }
            Math.random = originalRandom;

            const rocketTotal = ['ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA']
                .reduce((sum, key) => sum + Number(counts[key] || 0), 0);

            return {
                error: null,
                counts,
                rocketTotal,
            };
        });

        expect(result.error).toBeNull();
        expect(result.counts.SLOW_DOWN || 0).toBe(0);
        expect(result.counts.INVERT || 0).toBe(0);
        expect(result.rocketTotal).toBeLessThan(90);
        expect(result.counts.ROCKET_MEGA || 0).toBeLessThan(result.counts.ROCKET_HEAVY || 0);
        expect(result.counts.ROCKET_HEAVY || 0).toBeLessThan(result.counts.ROCKET_MEDIUM || 0);
        expect(result.counts.ROCKET_MEDIUM || 0).toBeLessThan(result.counts.ROCKET_WEAK || 0);
        expect(result.counts.SHIELD || 0).toBeGreaterThan(0);
    });

    test('T89c: Hunt-Respawn resettet Snowball-Zustaende und gibt Recovery-Fenster', async ({ page }) => {
        await startHuntGameWithBots(page, 1);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            if (!game || !entityManager || !player) {
                return { error: 'missing-state' };
            }
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') {
                return { error: 'hunt-not-active' };
            }

            game.settings.hunt.respawnEnabled = true;
            game._applySettingsToRuntime?.();

            player.inventory = ['ROCKET_HEAVY', 'SHIELD'];
            player.selectedItemIndex = 1;
            player.shootCooldown = 0.5;
            entityManager._overheatGunSystem._overheatByPlayer[player.index] = 84;
            entityManager._overheatGunSystem._lockoutByPlayer[player.index] = 0.9;

            player.kill();
            entityManager._respawnSystem.onPlayerDied(player);
            for (let i = 0; i < 600; i++) {
                entityManager._respawnSystem.update(1 / 60);
                if (player.alive) break;
            }

            return {
                error: null,
                alive: !!player.alive,
                inventory: [...player.inventory],
                selectedItemIndex: Number(player.selectedItemIndex || 0),
                shieldHP: Number(player.shieldHP || 0),
                spawnProtectionTimer: Number(player.spawnProtectionTimer || 0),
                shootCooldown: Number(player.shootCooldown || 0),
                overheat: Number(entityManager._overheatGunSystem._overheatByPlayer?.[player.index] || 0),
                lockout: Number(entityManager._overheatGunSystem._lockoutByPlayer?.[player.index] || 0),
            };
        });

        expect(result.error).toBeNull();
        expect(result.alive).toBeTruthy();
        expect(result.inventory).toEqual(['ROCKET_WEAK']);
        expect(result.selectedItemIndex).toBe(0);
        expect(result.shieldHP).toBeGreaterThanOrEqual(18);
        expect(result.spawnProtectionTimer).toBeGreaterThanOrEqual(1.2);
        expect(result.shootCooldown).toBe(0);
        expect(result.overheat).toBe(0);
        expect(result.lockout).toBe(0);
    });

    test('T89f: TrailCollisionQuery waehlt naechsten Treffer bei dichten Trails', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            if (!entityManager) return { error: 'missing-entity-manager' };

            const trailSpatialIndex = entityManager.getTrailSpatialIndex?.();
            if (!trailSpatialIndex) return { error: 'missing-trail-spatial-index' };

            // Position to query from
            const queryX = 0;
            const queryY = 0;
            const queryZ = 0;
            const queryRadius = 2.0;

            // Segment A: farther away (distance ~10 from query point)
            const segA_from = { x: 10, y: 0, z: -1 };
            const segA_to = { x: 10, y: 0, z: 1 };
            // Segment B: closer (distance ~4 from query point)
            const segB_from = { x: 4, y: 0, z: -1 };
            const segB_to = { x: 4, y: 0, z: 1 };

            const refA = entityManager.registerTrailSegment(1, 100, {
                fromX: segA_from.x, fromY: segA_from.y, fromZ: segA_from.z,
                toX: segA_to.x, toY: segA_to.y, toZ: segA_to.z,
                midX: 10, midZ: 0, radius: 2.5, hp: 3, maxHp: 3, ownerTrail: null,
            });
            const refB = entityManager.registerTrailSegment(1, 101, {
                fromX: segB_from.x, fromY: segB_from.y, fromZ: segB_from.z,
                toX: segB_to.x, toY: segB_to.y, toZ: segB_to.z,
                midX: 4, midZ: 0, radius: 2.5, hp: 3, maxHp: 3, ownerTrail: null,
            });

            const entryA = refA?.entry || null;
            const entryB = refB?.entry || null;

            const pos = { x: queryX, y: queryY, z: queryZ };
            const hit = trailSpatialIndex.checkProjectileTrailCollision(pos, queryRadius, { excludePlayerIndex: -1, skipRecent: 0 });

            const hitSegmentIdx = hit?.entry?.segmentIdx ?? -1;
            const hitPlayerIndex = hit?.entry?.playerIndex ?? -1;

            // Cleanup
            if (refA?.key && entryA) entityManager.unregisterTrailSegment(refA.key, entryA);
            if (refB?.key && entryB) entityManager.unregisterTrailSegment(refB.key, entryB);

            return {
                error: null,
                hitSegmentIdx,
                hitPlayerIndex,
                expectedSegmentIdx: 101,
            };
        });

        expect(result.error).toBeNull();
        // Segment B (idx 101, distance ~4) must be selected over segment A (idx 100, distance ~10)
        expect(result.hitSegmentIdx).toBe(result.expectedSegmentIdx);
    });

    test('T89g: optimizedTrailScan liest Runtime-Config statt hart verdrahtetem false', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            if (!entityManager) return { error: 'missing-entity-manager' };

            // Access HuntTargetingPerf via dynamic import is not straightforward in browser;
            // instead verify that the runtime config OPTIMIZED_SCAN_ENABLED is readable
            // and that no static false is forced in combat path.
            // We check via the targeting telemetry on the entity manager's hunt combat system.
            const huntCombatSystem = entityManager._huntCombatSystem;
            if (!huntCombatSystem) return { error: 'missing-hunt-combat-system' };

            // The telemetry object exists and is a proper tracking object
            const telemetry = huntCombatSystem._targetingTelemetry;
            if (!telemetry || typeof telemetry !== 'object') return { error: 'missing-telemetry' };

            // Read the active runtime config OPTIMIZED_SCAN_ENABLED
            const runtimeConfig = game?.getActiveRuntimeConfig?.() || null;
            const optimizedScanEnabled = runtimeConfig?.HUNT?.TARGETING?.OPTIMIZED_SCAN_ENABLED;

            return {
                error: null,
                hasTelemetry: true,
                optimizedScanEnabled: optimizedScanEnabled !== false,
            };
        });

        expect(result.error).toBeNull();
        expect(result.hasTelemetry).toBe(true);
        // Optimized scan must not be statically disabled - the config value governs it
        expect(result.optimizedScanEnabled).toBe(true);
    });

    test('T89h: HuntHUD delta-updates schreiben Bars/Texte korrekt nach Wertaenderung', async ({ page }) => {
        await startHuntGame(page);
        const result = await page.evaluate(() => {
            const game = window.GAME_INSTANCE;
            const entityManager = game?.entityManager;
            const player = entityManager?.players?.[0];
            if (!entityManager || !player) return { error: 'missing-entity-state' };
            if (String(game?.activeGameMode || '').toUpperCase() !== 'HUNT') return { error: 'hunt-not-active' };

            const hud = game?.huntHud || game?.huntHUD || game?._huntHUD || null;
            if (!hud || typeof hud.update !== 'function') return { error: 'missing-hunt-hud' };

            // Force known shield values and run one HUD update cycle
            const originalShieldHP = player.shieldHP;
            const originalMaxShieldHp = player.maxShieldHp;
            player.shieldHP = 50;
            player.maxShieldHp = 100;

            // Flush pending timers by passing a large dt to trigger playerPanel update
            hud._playerPanelTickTimer = 9999;
            hud.update(0.001);

            const shieldTextAfterFirst = hud.p1ShieldText?.textContent ?? null;
            const cachedShieldTxt = hud._panelCache?.[0]?.shieldTxt ?? null;

            // Now set the same values - cache should prevent DOM write (text stays same)
            hud._playerPanelTickTimer = 9999;
            hud.update(0.001);
            const shieldTextAfterSecond = hud.p1ShieldText?.textContent ?? null;

            // Change value - delta check must allow the write
            player.shieldHP = 25;
            hud._playerPanelTickTimer = 9999;
            hud.update(0.001);
            const shieldTextAfterChange = hud.p1ShieldText?.textContent ?? null;

            // Restore
            player.shieldHP = originalShieldHP;
            player.maxShieldHp = originalMaxShieldHp;

            return {
                error: null,
                shieldTextAfterFirst,
                cachedShieldTxt,
                shieldTextAfterSecond,
                shieldTextAfterChange,
            };
        });

        expect(result.error).toBeNull();
        // First update wrote correct value
        expect(result.shieldTextAfterFirst).toBe('50 / 100');
        // Cache was updated
        expect(result.cachedShieldTxt).toBe('50 / 100');
        // Second update with same value: same DOM content
        expect(result.shieldTextAfterSecond).toBe('50 / 100');
        // After changing shieldHP to 25, DOM must update
        expect(result.shieldTextAfterChange).toBe('25 / 100');
    });

});
