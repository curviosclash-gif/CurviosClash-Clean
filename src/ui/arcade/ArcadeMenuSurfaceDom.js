import { resolveMenuCatalogText } from '../menu/MenuTextCatalog.js';
import { createHangarWindowLauncher } from '../hangar/HangarWindowMenuBridge.js';
import { createArcadeDailyMenuCard } from './ArcadeDailyMenuView.js';
import { createArcadeLeaderboardMenuCard } from './ArcadeLeaderboardMenuView.js';
import { createArcadeNightmareToggle } from './ArcadeNightmareToggle.js';

function t(textId, fallback) {
    return resolveMenuCatalogText(textId, fallback);
}

function createElement(tag, className, textContent = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
}

function createMetric(labelText, valueText = '-') {
    const metric = createElement('div', 'arcade-hud-metric');
    const label = createElement('span', 'arcade-hud-metric-label', labelText);
    const value = createElement('strong', 'arcade-hud-metric-value', valueText);
    metric.appendChild(label);
    metric.appendChild(value);
    return { metric, value };
}

export function buildArcadeSurface(level3Body, ui) {
    const details = createElement('details', 'menu-section menu-accordion start-section-card arcade-inline-surface hidden');
    details.id = 'arcade-inline-surface';
    details.dataset.startSection = 'arcade';

    const summary = createElement('summary', 'menu-accordion-summary');
    const summaryTitle = createElement('span', 'section-title', t('menu.arcade.title', 'Arcade Run'));
    const summaryCopy = createElement('span', 'menu-accordion-copy', t('menu.arcade.summary', 'Sektoren meistern, Punkte sammeln und nach dem Sieg freiwillig weiterspielen'));
    summary.appendChild(summaryTitle);
    summary.appendChild(summaryCopy);
    details.appendChild(summary);

    const body = createElement('div', 'menu-accordion-body arcade-surface-body');

    // The run starts come first, each with one sentence; seed and
    // statistics follow below as their own block.
    const startGroup = createElement('section', 'arcade-start-group');
    startGroup.appendChild(createElement('h3', 'arcade-surface-card-title', 'Lauf starten'));
    const runLine = createElement('p', 'menu-hint arcade-run-line');
    runLine.id = 'arcade-run-line';
    startGroup.appendChild(runLine);
    // "Albtraum" only hardens the arcade sector plan, so it sits with the starts it affects.
    const nightmareToggle = createArcadeNightmareToggle();
    startGroup.appendChild(nightmareToggle.label);
    const createStartOption = (id, label, copy) => {
        const option = createElement('div', 'arcade-start-option');
        const button = createElement('button', 'start-btn', label);
        button.type = 'button';
        button.id = id;
        option.appendChild(button);
        option.appendChild(createElement('p', 'arcade-start-option-copy', copy));
        startGroup.appendChild(option);
        return button;
    };
    const startRunButton = createStartOption('btn-arcade-start-inline', t('menu.arcade.start.label', 'Arcade Run starten'),
        'Sektoren nacheinander meistern und Punkte sammeln – derselbe Lauf wie „Spiel starten“.');
    const startEndlessButton = createStartOption('btn-arcade-endless-start-inline', 'Endlosjagd starten',
        'Endloser Kampf-Parcours: Tore bringen Punkte und verlängern deine Serie.');
    const startFiveFrontsButton = createStartOption('btn-arcade-five-fronts-start-inline', 'Fünf Fronten',
        'Fünf Arenen mit anrollenden Bot-Wellen; zwischen den Wellen wählst du Verbesserungen.');
    const startFivePortalsButton = createStartOption('btn-arcade-five-portals-start-inline', 'Fünf Portale',
        'Fünf Parcours-Karten auf Zeit; das Ausgangsportal bringt dich jeweils zur nächsten.');
    const startWeaponRaceButton = createStartOption('btn-arcade-weapon-race-start-inline', 'Waffenrennen',
        'Fünf Fahrer jagen durch den Angriffsparcours und wechseln ihre Waffe an festen Checkpoints.');
    const { card: dailyCard, line: dailyLine, button: dailyButton } = createArcadeDailyMenuCard(
        createElement,
        t('menu.arcade.postrun.daily.label', 'Daily starten')
    );
    dailyCard.classList.add('arcade-daily-start-card');
    startGroup.appendChild(dailyCard);
    body.appendChild(startGroup);

    const statusBlock = createElement('section', 'arcade-stats-block arcade-current-status');
    statusBlock.appendChild(createElement('h3', 'arcade-surface-card-title', 'Dein aktueller Stand'));
    const recordsLine = createElement('p', 'menu-hint');
    recordsLine.id = 'arcade-records-line';
    statusBlock.appendChild(recordsLine);

    const seedCard = createElement('section', 'arcade-surface-card');
    seedCard.appendChild(createElement('h3', 'arcade-surface-card-title', t('menu.arcade.seed.title', 'Seed und Challenge')));
    const seedLine = createElement('p', 'arcade-surface-card-value');
    seedLine.id = 'arcade-seed-line';
    seedCard.appendChild(seedLine);
    const seedActions = createElement('div', 'arcade-surface-actions');
    const rerollSeedButton = createElement('button', 'secondary-btn', t('menu.arcade.seed.reroll.label', 'Seed neu rollen'));
    rerollSeedButton.type = 'button';
    rerollSeedButton.id = 'btn-arcade-seed-reroll';
    const copySeedButton = createElement('button', 'secondary-btn', t('menu.arcade.seed.copy.label', 'Seed als Challenge nutzen'));
    copySeedButton.type = 'button';
    copySeedButton.id = 'btn-arcade-seed-copy';
    seedActions.appendChild(rerollSeedButton);
    seedActions.appendChild(copySeedButton);
    seedCard.appendChild(seedActions);
    // Ein gesetzter Seed erzeugt dieselbe Strecke erneut - damit lassen sich Laeufe teilen.
    const seedEntry = createElement('div', 'arcade-surface-actions');
    const seedInput = createElement('input', 'menu-input');
    seedInput.type = 'number';
    seedInput.min = '1';
    seedInput.max = '2147483647';
    seedInput.step = '1';
    seedInput.id = 'input-arcade-seed';
    seedInput.placeholder = t('menu.arcade.seed.input.placeholder', 'Seed eingeben');
    const applySeedButton = createElement('button', 'secondary-btn', t('menu.arcade.seed.apply.label', 'Seed setzen'));
    applySeedButton.type = 'button';
    applySeedButton.id = 'btn-arcade-seed-apply';
    seedEntry.appendChild(seedInput);
    seedEntry.appendChild(applySeedButton);
    seedCard.appendChild(seedEntry);
    const hudGrid = createElement('div', 'arcade-hud-shell-grid');
    const metricScore = createMetric(t('menu.arcade.hud.score.label', 'Punkte'), '0');
    const metricMultiplier = createMetric(t('menu.arcade.hud.multiplier.label', 'Multiplikator'), 'x1.0');
    const metricSector = createMetric(t('menu.arcade.hud.sector.label', 'Sektor'), '1');
    const metricChain = createMetric(t('menu.arcade.hud.chain.label', 'Combo'), '0');
    hudGrid.appendChild(metricScore.metric);
    hudGrid.appendChild(metricMultiplier.metric);
    hudGrid.appendChild(metricSector.metric);
    hudGrid.appendChild(metricChain.metric);
    statusBlock.appendChild(hudGrid);
    const postRunLine = createElement('p', 'arcade-surface-card-value');
    postRunLine.id = 'arcade-post-run-line';
    statusBlock.appendChild(postRunLine);
    body.appendChild(statusBlock);

    const leaderboardRefs = createArcadeLeaderboardMenuCard(createElement);
    body.appendChild(leaderboardRefs.card);

    const advanced = createElement('details', 'arcade-advanced-options');
    const advancedSummary = createElement('summary', 'arcade-advanced-options-summary', 'Weitere Optionen');
    advanced.appendChild(advancedSummary);
    const advancedBody = createElement('div', 'arcade-surface-grid arcade-advanced-options-grid');
    advancedBody.appendChild(seedCard);

    const postRunCard = createElement('section', 'arcade-surface-card');
    postRunCard.appendChild(createElement('h3', 'arcade-surface-card-title', 'Replay'));
    const postRunActions = createElement('div', 'arcade-surface-actions');
    const replayButton = createElement('button', 'secondary-btn', t('menu.arcade.postrun.replay.label', 'Replay exportieren'));
    replayButton.type = 'button';
    replayButton.id = 'btn-arcade-replay';
    postRunActions.appendChild(replayButton);
    postRunCard.appendChild(postRunActions);
    advancedBody.appendChild(postRunCard);

    const masteryCard = createElement('section', 'arcade-surface-card');
    masteryCard.appendChild(createElement('h3', 'arcade-surface-card-title', t('menu.arcade.mastery.title', 'Fahrzeugfortschritt')));
    const masteryLine = createElement('p', 'arcade-surface-card-value');
    masteryLine.id = 'arcade-mastery-line';
    masteryCard.appendChild(masteryLine);
    advancedBody.appendChild(masteryCard);

    const endlessCard = createElement('section', 'arcade-surface-card');
    endlessCard.appendChild(createElement('h3', 'arcade-surface-card-title', 'Endlosjagd-Rekorde'));
    const endlessRecordsLine = createElement('p', 'arcade-surface-card-value');
    endlessRecordsLine.id = 'arcade-endless-records-line';
    endlessCard.appendChild(endlessRecordsLine);
    advancedBody.appendChild(endlessCard);

    const { card: hangarLaunchCard, button: openHangarButton } = createHangarWindowLauncher(createElement);
    advancedBody.appendChild(hangarLaunchCard);
    advanced.appendChild(advancedBody);
    body.appendChild(advanced);

    details.appendChild(body);

    const multiplayerSection = level3Body.querySelector('[data-start-section="multiplayer"]');
    if (multiplayerSection && multiplayerSection.parentElement === level3Body) {
        level3Body.insertBefore(details, multiplayerSection);
    } else {
        level3Body.appendChild(details);
    }

    ui.arcadeInlineSurface = details;
    ui.arcadeStartInlineButton = startRunButton;
    ui.arcadeEndlessStartInlineButton = startEndlessButton;
    ui.arcadeFiveFrontsStartInlineButton = startFiveFrontsButton;
    ui.arcadeFivePortalsStartInlineButton = startFivePortalsButton;
    ui.arcadeWeaponRaceStartInlineButton = startWeaponRaceButton;
    ui.arcadeSeedRerollButton = rerollSeedButton;
    ui.arcadeSeedCopyButton = copySeedButton;
    ui.arcadeSeedInput = seedInput;
    ui.arcadeSeedApplyButton = applySeedButton;
    ui.arcadeReplayButton = replayButton;
    ui.arcadeDailyButton = dailyButton;

    return {
        details,
        runLine,
        recordsLine,
        endlessRecordsLine,
        seedLine,
        postRunLine,
        dailyLine,
        masteryLine,
        leaderboardLine: leaderboardRefs.line,
        leaderboardList: leaderboardRefs.list,
        leaderboardResult: leaderboardRefs.result,
        leaderboardResultTitle: leaderboardRefs.resultTitle,
        leaderboardResultDetail: leaderboardRefs.resultDetail,
        leaderboardEmpty: leaderboardRefs.empty,
        leaderboardTableWrap: leaderboardRefs.tableWrap,
        leaderboardToggle: leaderboardRefs.toggle,
        metricScore: metricScore.value,
        metricMultiplier: metricMultiplier.value,
        metricSector: metricSector.value,
        metricChain: metricChain.value,
        startRunButton,
        startEndlessButton,
        startFiveFrontsButton,
        startFivePortalsButton,
        startWeaponRaceButton,
        rerollSeedButton,
        copySeedButton,
        seedInput,
        applySeedButton,
        replayButton,
        dailyButton,
        hangarLaunchCard,
        openHangarButton,
        nightmareInput: nightmareToggle.input,
    };
}
