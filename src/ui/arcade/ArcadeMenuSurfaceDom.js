import { resolveMenuCatalogText } from '../menu/MenuTextCatalog.js';
import { createHangarWindowLauncher } from '../hangar/HangarWindowMenuBridge.js';
import { createArcadeDailyMenuCard } from './ArcadeDailyMenuView.js';
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

    // The four ways to start a run come first, each with one sentence; seed and
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
    body.appendChild(startGroup);

    const statsBlock = createElement('section', 'arcade-stats-block');
    statsBlock.appendChild(createElement('h3', 'arcade-surface-card-title', 'Seed & Statistik'));
    const recordsLine = createElement('p', 'menu-hint');
    recordsLine.id = 'arcade-records-line';
    statsBlock.appendChild(recordsLine);
    // Eigene Zeile fuer die Endlosjagd: Bestwert, Top-Liste und Meilensteine.
    const endlessRecordsLine = createElement('p', 'menu-hint');
    endlessRecordsLine.id = 'arcade-endless-records-line';
    statsBlock.appendChild(endlessRecordsLine);

    const cardGrid = createElement('div', 'arcade-surface-grid');

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
    cardGrid.appendChild(seedCard);

    const hudCard = createElement('section', 'arcade-surface-card');
    hudCard.appendChild(createElement('h3', 'arcade-surface-card-title', t('menu.arcade.hud.title', 'Run-Übersicht')));
    const hudGrid = createElement('div', 'arcade-hud-shell-grid');
    const metricScore = createMetric(t('menu.arcade.hud.score.label', 'Score'), '0');
    const metricMultiplier = createMetric(t('menu.arcade.hud.multiplier.label', 'x-Multi'), 'x1.0');
    const metricSector = createMetric(t('menu.arcade.hud.sector.label', 'Sektor'), '1');
    const metricChain = createMetric(t('menu.arcade.hud.chain.label', 'Combo'), '0');
    hudGrid.appendChild(metricScore.metric);
    hudGrid.appendChild(metricMultiplier.metric);
    hudGrid.appendChild(metricSector.metric);
    hudGrid.appendChild(metricChain.metric);
    hudCard.appendChild(hudGrid);
    cardGrid.appendChild(hudCard);

    const postRunCard = createElement('section', 'arcade-surface-card');
    postRunCard.appendChild(createElement('h3', 'arcade-surface-card-title', t('menu.arcade.postrun.title', 'Post-Run Feedback')));
    const postRunLine = createElement('p', 'arcade-surface-card-value');
    postRunLine.id = 'arcade-post-run-line';
    postRunCard.appendChild(postRunLine);
    const postRunActions = createElement('div', 'arcade-surface-actions');
    const replayButton = createElement('button', 'secondary-btn', t('menu.arcade.postrun.replay.label', 'Replay exportieren'));
    replayButton.type = 'button';
    replayButton.id = 'btn-arcade-replay';
    postRunActions.appendChild(replayButton);
    postRunCard.appendChild(postRunActions);
    cardGrid.appendChild(postRunCard);

    const { card: dailyCard, line: dailyLine, button: dailyButton } = createArcadeDailyMenuCard(
        createElement,
        t('menu.arcade.postrun.daily.label', 'Daily starten')
    );
    cardGrid.appendChild(dailyCard);

    const masteryCard = createElement('section', 'arcade-surface-card');
    masteryCard.appendChild(createElement('h3', 'arcade-surface-card-title', t('menu.arcade.mastery.title', 'Fahrzeugfortschritt')));
    const masteryLine = createElement('p', 'arcade-surface-card-value');
    masteryLine.id = 'arcade-mastery-line';
    masteryCard.appendChild(masteryLine);
    cardGrid.appendChild(masteryCard);

    statsBlock.appendChild(cardGrid);
    body.appendChild(statsBlock);

    const { card: hangarLaunchCard, button: openHangarButton } = createHangarWindowLauncher(createElement);
    body.appendChild(hangarLaunchCard);

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
        metricScore: metricScore.value,
        metricMultiplier: metricMultiplier.value,
        metricSector: metricSector.value,
        metricChain: metricChain.value,
        startRunButton,
        startEndlessButton,
        startFiveFrontsButton,
        startFivePortalsButton,
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
