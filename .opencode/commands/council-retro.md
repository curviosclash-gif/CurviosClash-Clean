---
description: Council-Retro: analysiert Loop-Verlauf und schlägt Prompt-Verbesserungen vor
---

Analysiere den abgeschlossenen Coding-Council-Loop und erstelle Verbesserungsvorschläge für die Agent-Prompts.

## METHODIK

### 1. State-Datei laden
Lies `$env:TEMP\opencode\code-council-loop-state.json` und analysiere:
- Welche Scopes produzierten die meisten Findings?
- Welche Scopes wurden übersprungen (keine Änderungen)?
- Gab es Oszillationen (gleiche Findings in aufeinanderfolgenden Iterationen)?
- Wie viele Iterationen bis zur Konvergenz?

### 2. git reflog analysieren
Prüfe ob während des Loops Code hin- und her-geändert wurde:
```
git diff HEAD@{N} HEAD@{N-1} --stat
```

### 3. False-Positive-Muster identifizieren
Suche nach Mustern in Findings, die:
- In Iteration N als 🔴 gemeldet wurden
- In Iteration N+1 nicht mehr auftauchten (weil sie false positives waren oder bereits gefixt)

### 4. Prompt-Verbesserungen vorschlagen
Für jeden Scope, der auffällig war:

| Scope | Muster | Prompt-Änderung |
|-------|--------|-----------------|
| sec | False positive: `_wasConnected` als Logikfehler gemeldet | Prompt ergänzen: "Prüfe ob Code in verschiedenen if-Blöcken steht bevor du 'setzt sofort zurück' meldest" |
| perf | Übersah dass `_collisionLog` write-only war | Prompt ergänzen: "Prüfe VOR Optimierungsvorschlag: wird die Variable jemals GELESEN?" |

### 5. LESSONS_LEARNED schreiben
Schreibe `$env:TEMP\opencode\council-lessons.json`:
```json
{
  "runId": "<timestamp>",
  "iterations": N,
  "exitReason": "<reason>",
  "scopeStats": {
    "review": { "findings": N, "falsePositives": N, "promptFix": "<vorschlag>" }
  },
  "globalLessons": [
    "Write-Only Detection vor jedem Vorschlag",
    "Float-Vergleiche mit === 0 erkennen"
  ]
}
```

## AUSGABE
```
VERDICT: IMPROVEMENTS_FOUND | NO_IMPROVEMENTS
## Scope-spezifische Verbesserungen
| Scope | Problem | Prompt-Fix |
|-------|---------|------------|
## Globale Verbesserungen
- Lesson 1
- Lesson 2
## Lessons-Datei: $env:TEMP\opencode\council-lessons.json
```
