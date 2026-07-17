export const FIGHT_TUNING_PRESETS = Object.freeze({
    fast: Object.freeze({ fightPlayerHp: 80, fightMgDamage: 12 }),
    standard: Object.freeze({ fightPlayerHp: 100, fightMgDamage: 7.75 }),
    tactical: Object.freeze({ fightPlayerHp: 160, fightMgDamage: 8 }),
});

function estimateTtk(hitPoints, damagePerShot, mg = {}) {
    const shots = Math.max(1, Math.ceil(hitPoints / Math.max(0.01, damagePerShot)));
    const cooldown = Math.max(0.01, Number(mg.COOLDOWN) || 0.08);
    const heatPerShot = Math.max(0, Number(mg.OVERHEAT_PER_SHOT) || 9);
    const coolingPerSecond = Math.max(0, Number(mg.COOLING_PER_SECOND) || 20);
    const threshold = Math.max(1, Number(mg.LOCKOUT_THRESHOLD) || 96);
    const lockoutSeconds = Math.max(0, Number(mg.LOCKOUT_SECONDS) || 0.75);
    let heat = 0;
    let seconds = 0;
    for (let shot = 0; shot < shots; shot += 1) {
        heat = Math.min(100, heat + heatPerShot);
        if (shot === shots - 1) break;
        const wait = Math.max(cooldown, heat >= threshold ? lockoutSeconds : 0);
        seconds += wait;
        heat = Math.max(0, heat - coolingPerSecond * wait);
    }
    return { shots, seconds };
}

export function deriveFightTuningSummary({ settings, fightPlayerHp, fightMgDamage, config }) {
    const vehicleId = String(settings?.vehicles?.PLAYER_1 || 'ship5');
    const hpBonus = Number(settings?.localSettings?.fightHangar?.activeBonusesByVehicle?.[vehicleId]?.maxHpBonus) || 0;
    const effectiveHp = Math.max(1, fightPlayerHp + hpBonus);
    const mg = config?.HUNT?.MG || {};
    const minFalloff = Math.max(0.2, Math.min(1, Number(mg.MIN_FALLOFF) || 0.5));
    const near = estimateTtk(effectiveHp, fightMgDamage, mg);
    const mid = estimateTtk(effectiveHp, fightMgDamage * (1 - (1 - minFalloff) * 0.5), mg);
    const tone = near.seconds < 0.75 ? 'fast' : (near.seconds > 4 ? 'slow' : 'balanced');
    const toneLabel = tone === 'fast' ? 'Sehr kurze Kämpfe' : (tone === 'slow' ? 'Sehr lange Kämpfe' : 'Ausgewogene Kampfdauer');
    return {
        tone,
        text: `${toneLabel}: effektiv ${Math.round(effectiveHp)} HP · nah ${near.shots} Treffer/${near.seconds.toFixed(1)} s · mittel ${mid.shots} Treffer/${mid.seconds.toFixed(1)} s (ohne Schild)`,
    };
}

export function syncFightMenuTuningUi({ ui, settings, gameplay, config }) {
    if (!ui || !gameplay) return;

    const fightPlayerHp = Number.isFinite(Number(gameplay.fightPlayerHp))
        ? Math.round(Number(gameplay.fightPlayerHp))
        : Math.max(1, Number(config?.HUNT?.PLAYER_MAX_HP) || 100);
    if (ui.fightPlayerHpSlider) ui.fightPlayerHpSlider.value = String(fightPlayerHp);
    if (ui.fightPlayerHpLabel) ui.fightPlayerHpLabel.textContent = String(fightPlayerHp);

    const fightMgDamage = Number.isFinite(Number(gameplay.fightMgDamage))
        ? Number(gameplay.fightMgDamage)
        : Math.max(1, Number(config?.HUNT?.MG?.DAMAGE) || 7.75);
    if (ui.fightMgDamageSlider) ui.fightMgDamageSlider.value = String(fightMgDamage);
    if (ui.fightMgDamageLabel) ui.fightMgDamageLabel.textContent = fightMgDamage.toFixed(2);

    const modePath = String(settings?.localSettings?.modePath || 'normal').toLowerCase();
    const fightModePathActive = modePath === 'fight';
    if (ui.fightPlayerHpSetting) {
        ui.fightPlayerHpSetting.classList.toggle('hidden', !fightModePathActive);
        ui.fightPlayerHpSetting.setAttribute('aria-hidden', String(!fightModePathActive));
    }
    if (ui.fightMgDamageSetting) {
        ui.fightMgDamageSetting.classList.toggle('hidden', !fightModePathActive);
        ui.fightMgDamageSetting.setAttribute('aria-hidden', String(!fightModePathActive));
    }
    if (ui.fightTuningPresets) {
        ui.fightTuningPresets.classList.toggle('hidden', !fightModePathActive);
        ui.fightTuningPresets.setAttribute('aria-hidden', String(!fightModePathActive));
    }
    if (ui.fightPlayerHpSlider) ui.fightPlayerHpSlider.disabled = !fightModePathActive;
    if (ui.fightMgDamageSlider) ui.fightMgDamageSlider.disabled = !fightModePathActive;
    for (const button of ui.fightTuningPresetButtons || []) button.disabled = !fightModePathActive;
    if (ui.fightTuningHint) {
        ui.fightTuningHint.classList.remove('hidden');
        if (fightModePathActive) {
            const summary = deriveFightTuningSummary({ settings, fightPlayerHp, fightMgDamage, config });
            ui.fightTuningHint.textContent = summary.text;
            ui.fightTuningHint.dataset.tone = summary.tone;
        } else {
            ui.fightTuningHint.textContent = 'Nur im Spielstil Kampf aktiv.';
            delete ui.fightTuningHint.dataset.tone;
        }
    }
}
