# Entwickler-Training

Dieser Bereich enthaelt die aus der Anwendung herausgeloesten Werkzeuge fuer Bot-Training, Batch-Laeufe, Evaluation, Gates und Validierung. Er ist **kein Bestandteil der Produktlaufzeit** und wird weder vom normalen Startpfad noch vom Electron-Paket eingebunden.

## Abgrenzung

- Die zur Laufzeit benoetigten Bots, Sensoren, Heuristiken und Spielmodi bleiben unter `src/`.
- Optionale Aktionsinferenz bleibt als schlanke Laufzeit-Schnittstelle unter `src/entities/ai/inference/`.
- Trainer-Bridge, Trainingsvertraege, Reward-/Gate-Logik, Batch-Runner, Validierung und Trainingsoberflaechen-Code liegen ausschliesslich hier.
- Playwright darf Validierungshelfer nur waehrend expliziter Testlaeufe ueber `tests/support/E2ETestRuntimeBridge.js` laden.

## Verwendung

Die weiterhin gepflegten Entwicklungslaeufe werden explizit aus dem Repository-Stamm gestartet:

```text
npm run test:dev:training
npm run bot:validate
npm run bot:validate:team
npm run bot:analyze
npm run bot:improve:team
npm run bot:improve:team:auto
npm run bot:improve:team:status
npm run bot:improve:team:verify
npm run bot:improve:team:audit
npm run benchmark:baseline
```

`bot:validate:team` startet dieselben reproduzierbaren Desktop-Runtime-Checks fuer
Flaggen- und Escort-Teamspiele. Der Report prueft neben Policy, Modus und Botanzahl
auch Teamzuordnung, aktives Teamziel sowie beobachtete Botrollen. Die Lane ist das
Abnahme-Gate fuer spaetere Heuristik- oder Modellkandidaten; sie trainiert und
promotet keinen Kandidaten automatisch.

`bot:improve:team` fuehrt genau einen begrenzten, deterministischen Suchschritt fuer
das `balanced`-Heuristikprofil aus. Jeder Kandidat spielt auf festen Trainings-Seeds
Flaggen und Escort jeweils als Alpha und Bravo gegen das unveraenderte Produktprofil.
Eine Aenderung wird nur in den Kandidatenzustand uebernommen, wenn sie anschliessend
auf getrennten Holdout-Seeds den Gesamtscore verbessert, keinen der beiden Modi
wesentlich verschlechtert und die beobachtete Zielzuordnung erhaelt.

Der Zustand liegt standardmaessig als
`curviosclash-team-objective-improvement-state.json` im Temp-Verzeichnis des
Betriebssystems; `TEAM_OBJECTIVE_LOOP_STATE_PATH` kann einen anderen externen Pfad
setzen. `bot:improve:team:auto` wiederholt die begrenzten Schritte seriell bis zum
Plateau oder bis zum Iterations-/Zeitlimit. `bot:improve:team:status` zeigt den
Kandidaten, `bot:improve:team:verify` vergleicht ihn erneut auf den bereits fuer
die Auswahl verwendeten Holdout-Seeds mit dem Produktprofil. Nach Abschluss der
Suche prueft `bot:improve:team:audit` ihn auf drei bis dahin unberuehrten Seeds;
dieser Audit darf nicht zur weiteren Kandidatenauswahl verwendet werden. Keiner
der Befehle veraendert Produktionswerte oder schreibt
Trainingsartefakte ins Repository; eine Promotion bleibt eine bewusste Codeaenderung
mit anschliessendem `bot:validate:team`-Gate.

Der Headless-Suchlauf verwendet die Produktgroesse der Standardarena und deren
Preset-Hindernisse, aber laedt keine GLB-Geometrie. Der Test verlangt deshalb echte
Flaggenschaden-Messungen und die separate Desktop-Validierung bleibt vor jeder
Promotion erforderlich.

Die Headless-Trainer-Werkzeuge erwarten zusaetzlich einen Python-Sidecar unter `python/` beziehungsweise einen ueber `BT91_PYTHON_EXE` angegebenen Interpreter. Dieser Sidecar ist im Clean-Repository nicht enthalten; die Werkzeuge sind daher nur ein abgegrenztes Entwicklungsgeruest und keine zugesicherte Produktfunktion.

Die Produktions-Builds pruefen mit `scripts/check-production-training-boundary.mjs`, dass weder Trainingsoberflaeche noch Trainings-/Trainer-Bundles erzeugt werden. Die Paketpruefung kontrolliert zusaetzlich, dass keine Trainingsquellen in den Electron-Ressourcen landen.
