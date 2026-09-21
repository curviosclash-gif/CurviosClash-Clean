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
npm run benchmark:baseline
```

`bot:validate:team` startet dieselben reproduzierbaren Desktop-Runtime-Checks fuer
Flaggen- und Escort-Teamspiele. Der Report prueft neben Policy, Modus und Botanzahl
auch Teamzuordnung, aktives Teamziel sowie beobachtete Botrollen. Die Lane ist das
Abnahme-Gate fuer spaetere Heuristik- oder Modellkandidaten; sie trainiert und
promotet keinen Kandidaten automatisch.

Die Headless-Trainer-Werkzeuge erwarten zusaetzlich einen Python-Sidecar unter `python/` beziehungsweise einen ueber `BT91_PYTHON_EXE` angegebenen Interpreter. Dieser Sidecar ist im Clean-Repository nicht enthalten; die Werkzeuge sind daher nur ein abgegrenztes Entwicklungsgeruest und keine zugesicherte Produktfunktion.

Die Produktions-Builds pruefen mit `scripts/check-production-training-boundary.mjs`, dass weder Trainingsoberflaeche noch Trainings-/Trainer-Bundles erzeugt werden. Die Paketpruefung kontrolliert zusaetzlich, dass keine Trainingsquellen in den Electron-Ressourcen landen.
