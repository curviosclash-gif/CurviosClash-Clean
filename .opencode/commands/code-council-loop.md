---
description: Coding Council Loop: iterative Verbesserungsschleife mit Konvergenz-Tracking und Learning-Feedback
---

Führe den Coding Council iterativ aus, bis Konvergenz-Kriterien erreicht sind oder die maximale Anzahl von Iterationen überschritten wurde.

$ARGUMENTS

## Loop-Parameter

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| MAX_ITERATIONS | 3 | Erstdurchlauf plus maximal zwei Reparaturrunden |
| CONVERGENCE_THRESHOLD | 0 | Keine doppelt bestätigten 🔴/🟠-Findings mehr |
| MIN_IMPROVEMENT | 1 | Mindest-Reduktion an Findings pro Iteration |
| EARLY_EXIT_ON_PASS | true | Beenden, wenn Build+Test grün und keine bestätigten 🔴/🟠 offen sind |

## State-Tracking (Datei)

Setze zu Beginn eine eindeutige Lauf-ID und initialisiere den repository- und laufisolierten Runner-State:

```powershell
$env:COUNCIL_RUN_ID = [guid]::NewGuid().ToString('N')
npm run council:runner:init -- "$ARGUMENTS"
```

Der State liegt unter `$env:TEMP\opencode\council\<repository-hash>\<run-id>\state.json` und enthält zusätzlich Base-Commit, Task-Hash, Start-Snapshot sowie maschinell erfasste Scope-Deltas. Ein geänderter Base-Commit oder eine Überschneidung mit bereits vorhandenen Nutzeränderungen stoppt den Lauf.

Inhalt:
```json
{
  "task": "$ARGUMENTS",
  "iteration": 0,
  "history": [],
  "converged": false,
  "exitReason": ""
}
```

Beim Start wird außerdem ein Hash-Snapshot aller bereits geänderten Dateien gespeichert. Reviews, Budgets und Metriken verwenden danach nur Dateien, deren Arbeitsbaum-Hash sich gegenüber dem letzten Snapshot geändert hat. Vorhandene Nutzeränderungen bleiben außerhalb des Council-Deltas.

## Verbindliches Finding-Schema

Jedes Finding wird strikt validiert. Seine ID entsteht deterministisch aus `scope`, `file`, `category` und dem stabilen Contract-/Funktions-/Regel-`symbol`; Zeilenverschiebungen ändern sie nicht. Eine mitgelieferte ID muss exakt entsprechen.

```json
{
  "id": "review:null-guard:<12-stelliger-hash>",
  "severity": "🟠",
  "scope": "review",
  "file": "src/runtime/example.js",
  "line": 12,
  "endLine": 15,
  "category": "null-guard",
  "symbol": "resolveExample",
  "problem": "Konkrete Fehlerbeschreibung",
  "verifyRun1": "BUG",
  "verifyRun2": "BUG",
  "evidence": { "type": "test|reproduction|contract|invariant|static-rule", "detail": "Konkreter Ursachenbeleg" }
}
```

Absolute Pfade, `..`, unbekannte Enum-Werte, doppelte IDs, inkonsistente Zähler oder bestätigte 🔴/🟠-Findings ohne Evidence stoppen die Eingabevalidierung.

## Iterations-Schleife

### PRO ITERATION:

#### 1. PRE-CHECK
- Lade State-Datei
- Wenn `iteration >= MAX_ITERATIONS`: EXIT mit "max_iterations"
- Inkrementiere `iteration`

#### 2. FEEDBACK-KONTEXT BAUEN
Sammle aus den vorherigen Iterationen (`history`):
- Nur 🔴- und 🟠-Findings, die in beiden unabhängigen adversarialen Verify-Läufen BUG erhielten
- Änderungs-Statistik (wie viele Dateien geändert, Lines Added/Removed)
- Build/Test-Ergebnis der vorherigen Iteration

Erzeuge einen FEEDBACK-KONTEXT-String:
```
## Feedback aus Iteration N-1
### Build & Test: <PASSED/FAILED>
### Doppelt bestätigte 🔴/🟠-Findings:
- [Scope] [Datei:Zeile] Beschreibung
### Änderungsstatistik vorherige Iteration: N Dateien, +X/-Y Lines
```

#### 3. CODE-COUNCIL AUSFÜHREN
Starte den vollständigen code-council Command MIT dem Feedback-Kontext:

```
/code-council $ARGUMENTS

ZUSATZKONTEXT:
$FEEDBACK_KONTEXT
```

Der code-council erhält die vorherigen Findings als Teil seiner $ARGUMENTS. 
ABWEICHUNG vom Standard-Code-Council:
- **Schritt 1 (Planung)**: Plane NUR für die doppelt bestätigten 🔴/🟠-Findings, nicht das gesamte $ARGUMENTS neu
- **Schritt 2 (Datei-Inventar)**: Fokussiere auf Dateien aus vorherigen Findings
- **Schritt 3 (Implementierung)**: Überspringe Scopes die in der vorherigen Iteration KEINE Änderungen produziert haben
- **Schritt 5 (Review)**: Reviews anhand des maschinellen Risiko-Plans; anschließend `council-verify` und `council-verify-fb` unabhängig
- Keine neue Architekturentscheidung in einer Reparaturrunde und niemals parallele Schreibzugriffe

#### 4. METRIKEN SAMMELN
Nach Abschluss des code-council-Kommando:
- Zähle 🔴, 🟠, 🟡 Findings aus dem konsolidierten Report
- Erfasse Build-Ergebnis
- Erfasse Test-Ergebnis
- Zähle nur Dateien mit geändertem Hash gegenüber dem letzten Arbeitsbaum-Snapshot
- Berechne DIFF_SCORE = (vorherige 🔴 - aktuelle 🔴) - (neue 🔴)
- Wähle die betroffenen Gates aus dem Council-Delta. Das finale Gate enthält immer Desktop-App-Build und schnelle Contracts.

#### 4a. REPARATURBUDGET

Ab Reparaturrunde 1 gelten maschinell:
- Finding-Zieldateien, Testdateien und maximal fünf weitere Dateien
- keine neuen Abhängigkeiten oder öffentlichen Contract-Änderungen
- keine Löschungen oder Umbenennungen

Eine Verletzung beendet den Loop mit `repair_budget_exceeded`.

#### 5. STATE AKTUALISIEREN
Hänge an `history`:
```json
{
  "iteration": N,
  "buildPassed": true/false,
  "testsPassed": true/false,
  "findings": { "critical": N, "major": N, "minor": N },
  "filesChanged": N,
  "linesAdded": N,
  "linesRemoved": N,
  "diffScore": N,
  "timestamp": "ISO"
}
```

#### 6. KONVERGENZ PRÜFEN

**EARLY_EXIT_ON_PASS**: Wenn Build PASSED UND Tests PASSED UND keine doppelt bestätigten 🔴/🟠-Findings offen sind:
  → EXIT mit "passed"

**PERSISTENZ**: Wenn dieselbe stabile Finding-ID nach einer Reparatur weiter besteht:
  → EXIT mit "finding_persisted"

**OSCILLATION**: Wenn die letzten 2 Iterationen abwechselnd Findings erzeugen und beheben (Ping-Pong):
  → EXIT mit "oscillation_detected"

Sonst: nächste Iteration (zurück zu 1)

#### 7. OSZILLATIONS-ERKENNUNG (Detail)
Verbindlich ist der Vergleich der stabilen Finding-IDs der letzten drei Iterationen: War eine ID offen, danach verschwunden und erscheint erneut, endet der Loop mit `oscillation_detected`. Eine neue bestätigte ID in einer Reparaturrunde endet mit `regression_introduced`. Die nachfolgenden Datei-/Zeilenvergleiche dienen nur als Diagnosehinweis und entscheiden den Exit nicht.
Vergleiche `history[N-1]` mit `history[N-2]`:
- Gleiche Dateien geändert aber Findings-Typ wechselt (z.B. war 🔴 in N-2, wurde in N-1 behoben, ist in N wieder 🔴)
- Gleiche Codezeilen werden hin- und her-geändert
→ Hash über die betroffenen Dateien+Zeilen der letzten Iterationen bilden und auf Wiederholung prüfen.

## Exit-Handling

| Exit-Code | Bedeutung | Aktion |
|-----------|-----------|--------|
| max_iterations | Limit erreicht | Report mit verbleibenden Findings |
| passed | Alle Gates grün, keine bestätigten Findings | Erfolgs-Report |
| build_failed | Passender Build fehlgeschlagen | Stop mit Build-Evidence |
| tests_failed | Betroffene Tests fehlgeschlagen | Stop mit Test-Evidence |
| finding_persisted | Stabile Finding-ID besteht weiter | Eskalation statt dritter Reparatur |
| regression_introduced | Reparatur erzeugte neue bestätigte ID | Stop und Neuplanung |
| verification_disagreed | Verify-Läufe widersprechen sich | Als nicht verifizierbar stoppen |
| repair_budget_exceeded | Reparatur verließ ihr Budget | Stop und Scope prüfen |
| oscillation_detected | Ping-Pong | Report mit Konflikt-Bereichen |

## Abschluss-Report

```
## Coding Council Loop — Abschluss nach N Iterationen
### Grund: <exitReason>
### Metriken über alle Iterationen
| Iteration | 🔴 | 🟠 | 🟡 | Build | Tests | Files | ±Lines |
|-----------|---|---|----|----|-------|-------|-------|--------|

### Trend
🔴: Start → Ende (Delta: -X)
🟠: Start → Ende (Delta: -Y)
🟡: Start → Ende (Delta: -Z)

### Verbleibende Findings (falls vorhanden)
| Severity | Datei:Zeile | Beschreibung | Seit Iteration |
|----------|-------------|--------------|----------------|

### Empfehlung
- Bei Stagnation: Welcher Scope produziert keine Verbesserung mehr?
- Bei Oszillation: Welche Dateien wechseln hin und her?
- Bei early_pass: Code ist bereit für Commit
```

## Zusätzliche Verbesserungen am Code-Council (strukturell)

Diese Änderungen gelten für JEDEN code-council-Durchlauf (auch ausserhalb des Loops):

### A. PER-SCOPE DELTA UND GATE
Statt eines pauschalen Web-Builds führt der Runner NACH jedem Scope die aus dem echten Vorher-/Nachher-Dateidelta abgeleiteten Gates aus:

1. Vor Apply: `npm run council:runner:scope-start -- <scope> '<planned-files-json>'`
2. Nach Apply: `npm run council:runner:scope-record -- <scope>`
3. Bei Gate-Fehler: Sofort den verantwortlichen Scope mit Fehlerlog einmal neu starten
4. Im Abschluss: `npm run council:runner:gates -- final` erzwingt Desktop-Build und schnelle Contracts

### B. CROSS-CUTTING AWARENESS
Jeder Coding-Agent erhält zusätzlich zu seinem Scope-Prompt:
```
## CROSS-CUTTING AWARENESS
Deine Änderungen können Auswirkungen auf andere Scopes haben. Prüfe VOR jedem Edit:
- KÖNNTE diese Änderung einen Test brechen? (test)
- KÖNNTE diese Änderung eine Security-Lücke öffnen? (sec)
- KÖNNTE diese Änderung Performance verschlechtern? (perf)
- KÖNNTE diese Änderung einen Bug einführen? (review)
- KÖNNTE diese Änderung Architektur-Grenzen verletzen? (arch)
- KÖNNTE diese Änderung Code-Duplizierung erzeugen? (refactor)

Wenn JA: dokumentiere das Risiko im Bericht unter "Cross-Cutting Impacts".
```

### C. DELTA-BASIERTE SCOPE-AUSWAHL
Statt ALLE 6 Scopes in jeder Iteration: überspringe Scopes die in der vorherigen Iteration 0 Änderungen produziert haben (Scope war zufrieden). Nur Scopes mit tatsächlichen Änderungen in der vorherigen Runde erneut ausführen.
