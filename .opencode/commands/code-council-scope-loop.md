---
description: Scope-interner Verbesserungs-Loop: verfeinert einen einzelnen Scope iterativ bis zur Selbstreview-Reinheit
---

Führe einen einzelnen Coding-Council-Scope in einer inneren Verbesserungsschleife aus. Der Scope wird wiederholt implementiert und selbstreviewt, bis keine selbst gefundenen Probleme mehr existieren oder das Iterationslimit erreicht ist.

$ARGUMENTS

## Aufruf

```
/code-council-scope-loop <scope> [--focus "<datei1,datei2>"] [--findings "<🔴-finding1; 🔴-finding2>"]
```

| Argument | Beschreibung |
|----------|--------------|
| scope | Einer von: arch, refactor, review, sec, test, perf |
| --focus | Optionale Dateiliste für fokussierte Bearbeitung |
| --findings | Optionale Findings aus vorherigen Durchläufen (als String, `;` getrennt) |

### Nicht-interaktiver CLI-Dispatch

Der Command MUSS über `--command` gestartet werden. Eine gewöhnliche Message umgeht die Command-Orchestrierung. Da der Scope-State im Temp-Verzeichnis liegt, benötigt der CLI-Lauf außerdem eine explizite Freigabe:

```
opencode run --auto --dir "<repo-root>" --command code-council-scope-loop "<argumente>"
```

Fallback-Warnungen auf einen Default-Agenten, fehlende Variantenreports oder ein fehlender Lead-Report machen den Lauf ungültig. Der Aufrufer setzt pro Phase ein Zeitlimit von fünf Minuten, verlangt mindestens alle 60 Sekunden einen Fortschrittsnachweis und beendet nach spätestens 15 Minuten den gesamten Scope-Lauf einschließlich verwaister Kindprozesse.

## Loop-Parameter

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| MAX_SCOPE_ITERATIONS | 2 | Maximale interne Iterationen pro Scope |
| MIN_SELF_ISSUES_FOR_RERUN | 1 | Mindestanzahl selbst gefundener Probleme für Wiederholung |
| SELF_REVIEW_DEPTH | shallow | shallow=nur eigene Änderungen prüfen, deep=auch Abhängigkeiten |

## State-Tracking

Nutze die beim Council-Start gesetzte `COUNCIL_RUN_ID`. Ein optionaler Scope-State liegt ausschließlich im Laufverzeichnis:

```
$env:TEMP\opencode\council\<repository-hash>\<run-id>\scope-<scope>.json
```

```json
{
  "scope": "<scope>",
  "task": "$ARGUMENTS",
  "iteration": 0,
  "history": [],
  "selectedVariant": null,
  "selfReviewIssues": [],
  "converged": false,
  "exitReason": ""
}
```

## Ablauf pro Scope-Iteration

### 1. PRE-CHECK
- Lade Scope-State
- Wenn `iteration >= MAX_SCOPE_ITERATIONS`: EXIT mit "max_scope_iterations"
- Inkrementiere `iteration`

### 2. KONTEXT BAUEN

**Iteration 1:** Erstelle initialen Prompt:
```
## Scope-Auftrag: <scope>
## Aufgabe: $ARGUMENTS
## Fokus-Dateien: <--focus oder "alle relevanten Dateien">
## Zu behebende Findings: <--findings oder "keine">
```

**Iteration 2+:** Erweitere um Selbstreview-Ergebnisse aus Iteration N-1:
```
## Scope-Auftrag: <scope> (Nachbesserung)
## Aufgabe: $ARGUMENTS
## Selbstreview-Ergebnisse aus Iteration <N-1>:
### Gefundene Probleme in eigenen Änderungen:
- [Datei:Zeile] Problembeschreibung
### Vom Lead abgelehnte Aspekte:
- Warum die gewählte Variante in bestimmten Punkten suboptimal war
## ANWEISUNG: Behebe ALLE oben genannten Probleme. Keine neuen Features.
```

### 3. 3-AGENTEN-PARALLEL-LAUF (TECHNISCH READ-ONLY)

Starte `council-code-proposal` dreimal parallel mit dem KONTEXT aus Schritt 2, dem Scope und jeweils einer Variante `primary`, `alt1` oder `alt2`. Der Proposal-Agent erzwingt `edit: deny`, `bash: deny` und `task: deny`; schreibberechtigte Apply-Agenten dürfen in dieser Phase nicht gestartet werden.

### 4. REPORTS EINSAMMELN

Jeder Agent liefert Report mit Pflichtfeldern:
```
## Scope: <scope>
## Ansatz: <Variante>
## Vorgeschlagene Änderungen
- [Datei:Zeile] Beschreibung → Grund
## Risiken des Vorschlags
- [Datei:Zeile] Risiko → Schwere (🔴/🟠/🟡)
## Cross-Cutting Impacts
- Auswirkung auf andere Scopes
## Nicht bearbeitet
- Was bewusst nicht angefasst wurde
```

Wichtig: Die Vorschlagsphase ist vollständig read-only. Dadurch gibt es keine Änderungen von Verlierern, die später zurückgesetzt werden müssten.

### 5. LEAD-SELEKTION

Übergib die 3 Reports an council-lead mit erweiterten Kriterien:

```
Vergleiche 3 Implementierungen für Scope <scope> (Iteration <N>).

ZUSÄTZLICHE KRITERIEN (neben Qualität/Konfliktfreiheit/Aufwand):
- RISIKOQUALITÄT: Hat der Agent die Risiken seines Vorschlags erkannt?
- VOLLSTÄNDIGKEIT: Deckt der Vorschlag den gesamten Scope-Auftrag ab?
- VERBESSERUNG: Ist diese Iteration besser als die vorherige? (falls Iteration >1)

Wähle die BESTE Variante. Bei Gleichstand: bevorzuge die kleinste vollständige Variante mit den geringsten Risiken.
```

### 6. GEWÄHLTE VARIANTE IMPLEMENTIEREN UND SELBSTREVIEWEN

Extrahiere zuerst die geplanten Dateien und starte `npm run council:runner:scope-start -- <scope> '<planned-files-json>'`. Starte anschließend ausschließlich den zur gewählten Variante gehörenden Apply-Agenten (`council-code-<scope>`, `-alt1` oder `-alt2`). Dieser Lauf darf den ausgewählten Vorschlag implementieren und muss anschließend die eigenen Änderungen read-only selbstreviewen.

Der Implementierungslauf liefert `## Änderungen` und `## Selbstreview-Findings`; diese Felder werden für die folgenden Schritte verwendet.

### 7. SCOPE-DELTA-GATE

```
npm run council:runner:scope-record -- <scope>
```
- Der Runner ordnet nur das echte Vorher-/Nachher-Delta diesem Scope zu und wählt passende Tests beziehungsweise Builds.
- Bei Fehler: Scope erneut starten und den gewählten Apply-Agenten EINMALIG mit Fehlerlog nachbessern lassen.
- Bei erneutem Fehlschlag: Scope als "build_blocked" markieren → EXIT.

### 8. SELBSTREVIEW-ANALYSE

Extrahiere die Selbstreview-Fundings aus dem GEWÄHLTEN Report.
Kategorisiere:

```
### Selbstreview-Fundings nach Schwere
| # | Severity | Datei:Zeile | Problem |
|---|----------|-------------|---------|
```

### 9. KONVERGENZ PRÜFEN

**SELBSTREVIEW_CLEAN**: Wenn Selbstreview-Fundings == 0:
  → EXIT mit "selfreview_clean"

**MAX_ITERATIONS**: Wenn iteration >= MAX_SCOPE_ITERATIONS:
  → EXIT mit "max_scope_iterations"

**IMPROVEMENT**: Wenn Anzahl Selbstreview-Fundings < Vor-Iteration:
  → nächste Iteration (zurück zu 1) — die Selbstreview-Fundings werden zu --findings

**STAGNATION**: Wenn Selbstreview-Fundings >= Vor-Iteration (keine Verbesserung):
  → EXIT mit "scope_stagnation" — weitere Iterationen bringen nichts

### 10. SCOPE-STATE AKTUALISIEREN

```json
{
  "iteration": N,
  "selectedVariant": "<ausgewogen|robustheit|minimalismus>",
  "selfReviewIssues": [
    { "file": "...", "line": N, "severity": "🔴", "problem": "..." }
  ],
  "filesChanged": N,
  "buildPassed": true/false,
  "timestamp": "ISO"
}
```

## Exit-Handling

| Exit-Code | Bedeutung | Was zurückgegeben wird |
|-----------|-----------|----------------------|
| selfreview_clean | Scope-Output ist selbstreview-sauber | Gewählter Report + leere Issue-Liste |
| max_scope_iterations | Limit erreicht | Gewählter Report + verbleibende Selbstreview-Issues |
| scope_stagnation | Keine Verbesserung mehr | Report + alle Selbstreview-Issues + Stagnationswarnung |
| build_blocked | Build fehlgeschlagen | Fehlerlog + unveränderte problematische Scope-Änderungen zur manuellen Bereinigung; kein destruktiver Revert |

## Rückgabe an Aufrufer (z.B. code-council-loop)

```
## Scope-Loop-Ergebnis: <scope>
### Status: <exitCode>
### Gewählte Variante: <ausgewogen|robustheit|minimalismus>
### Iterationen: <N>
### Änderungen
- [Datei:Zeile] Beschreibung
### Verbleibende Selbstreview-Issues
| # | Severity | Datei:Zeile | Problem | Seit Iteration |
|---|----------|-------------|---------|----------------|
### Build: <PASSED/FAILED>
```

## Integration in code-council-loop

Der code-council-loop ruft diesen Scope-Loop als Subroutine auf:

```
# Im code-council-loop, Schritt 3 (Implementierung):
# Statt: 3 schreibende Agenten → Lead → destruktiver Revert → nächster Scope
# Neu:    code-council-scope-loop <scope> → wenn selfreview_clean → nächster Scope
#                                       → wenn issues bleiben → dokumentieren, trotzdem nächster Scope
```

ABWEICHUNG: Der code-council-loop verwendet diesen inneren Loop NUR für Scopes, die in der vorherigen äusseren Iteration 🔴-Findings produziert haben. Scopes ohne Findings durchlaufen den schnellen 3-Agenten-Pfad (ohne inneren Loop).

## Unterschied zum äusseren code-council-loop

| Aspekt | code-council-loop (äusser) | code-council-scope-loop (inner) |
|--------|---------------------------|-------------------------------|
| Granularität | Alle risikobasiert aktiven Scopes | Ein einzelner Scope |
| Review-Quelle | Risikobasiert aktivierte externe Council-Reviews | Selbstreview des Agenten |
| Verbesserungs-Quelle | Extern gefundene Probleme | Selbst erkannte Probleme |
| Abbruchkriterium | 0 🔴 extern | 0 Selbstreview-Issues |
| Max Iterationen | 3 | 2 |
| Build-Check | Global nach allen Scopes | Pro Scope sofort |
| Einsatz | Vollständige Code-Verbesserung | Hartnäckige Einzel-Scopes |
