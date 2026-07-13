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
    if (ui.fightPlayerHpSlider) ui.fightPlayerHpSlider.disabled = !fightModePathActive;
    if (ui.fightMgDamageSlider) ui.fightMgDamageSlider.disabled = !fightModePathActive;
    if (ui.fightTuningHint) ui.fightTuningHint.classList.toggle('hidden', fightModePathActive);
}
