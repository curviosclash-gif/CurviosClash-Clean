---
description: Coding Council: 18 Coding-Experten in 3 Varianten pro Scope, Lead selektiert beste Lösung
---
Orchestriere einen vollständigen Coding-Council-Durchlauf mit 3-Wege-Redundanz pro Scope:

$ARGUMENTS

## Ablauf

### 1. REDUNDANTE PLANUNG (2x)
Starte den plan-Agenten ZWEIMAL parallel:
- **plan-minimal**: "Erstelle einen Plan mit minimalen Änderungen, maximaler Wiederverwendung für: $ARGUMENTS"
- **plan-robust**: "Erstelle einen Plan mit robuster, defensiver Lösung, alle Edge-Cases für: $ARGUMENTS"
Warte auf beide Pläne. Merge zu einem Master-Plan: übernimm aus plan-minimal die effizientesten Ansätze, aus plan-robust die notwendigen Safety-Netze.

### 2. PARALLELE IMPLEMENTIERUNG (18 Agenten)
Starte 18 Coding-Agenten parallel (6 Scopes × 3 Varianten) mit dem task-Tool:

| Scope | Ausgewogen (primary) | Robustheit (alt1) | Minimalismus (alt2) |
|-------|---------------------|-------------------|---------------------|
| arch | council-code-arch | council-code-arch-alt1 | council-code-arch-alt2 |
| perf | council-code-perf | council-code-perf-alt1 | council-code-perf-alt2 |
| refactor | council-code-refactor | council-code-refactor-alt1 | council-code-refactor-alt2 |
| review | council-code-review | council-code-review-alt1 | council-code-review-alt2 |
| sec | council-code-sec | council-code-sec-alt1 | council-code-sec-alt2 |
| test | council-code-test | council-code-test-alt1 | council-code-test-alt2 |

Jeder Agent erhält: Master-Plan + $ARGUMENTS + seinen Scope.

WICHTIG: Jeder Agent arbeitet NUR in seinem Scope (siehe Scope-Disziplin im jeweiligen Agenten).

### 3. REPORTS EINSAMMELN
Jeder Agent liefert Report im Format:
```
## Scope: <name>
## Ansatz: <Ausgewogen|Robustheit|Defensiv|Stabilität|Durchsatz|Minimalismus|Kritische Pfade|Vollständig|...>
## Änderungen
- [Datei:Zeile] Beschreibung -> Grund
## Nicht bearbeitet (ausserhalb Scope)
- Was bewusst nicht angefasst wurde
```

### 4. PER-SCOPE SELEKTION (Lead-gestützt)
**Wichtig: 3 Agenten pro Scope haben dieselben Dateien editiert. Nur EINER pro Scope bleibt.**

Für JEDEN Scope (arch, perf, refactor, review, sec, test):
1. Übergib die 3 Reports an council-lead mit Prompt:
   "Vergleiche 3 Implementierungen für Scope <X>. Kriterien:
   - QUALITÄT: Welche Lösung ist korrekt und vollständig?
   - KONFLIKTFREIHEIT: Welche Lösung kollidiert am wenigsten mit anderen Scopes?
   - AUFWAND/NUTZEN: Welche Lösung hat das beste Verhältnis?
   Wähle die BESTE Implementierung. Begründe die Wahl."
2. Nach Lead-Entscheidung: REVERTIERE die Änderungen der 2 NICHT gewählten Agenten pro Scope.
   ```
   git checkout -- <dateien die der verlierer editiert hat>
   ```
   ODER: Wenn ein verlierender Agent nur neue Files erstellt hat:
   ```
   git clean -f <neue dateien des verlierers>
   ```
3. Nach Bereinigung: 6 Agenten-Implementierungen bleiben (1 pro Scope).

### 5. REDUNDANTE CODE-REVIEW (30x)
Erzeuge den vollständigen git Diff der BEREINIGTEN Änderungen. Starte den read-only Council mit 5x-Parallel-Review:
- council-review + fb + fb2 + fb3 + fb4 (5x)
- council-arch + fb + fb2 + fb3 + fb4 (5x)
- council-sec + fb + fb2 + fb3 + fb4 (5x)
- council-perf + fb + fb2 + fb3 + fb4 (5x)
- council-test + fb + fb2 + fb3 + fb4 (5x)
- council-refactor + fb + fb2 + fb3 + fb4 (5x)

Alle 30 erhalten: "Review diesen Diff auf $ARGUMENTS. Finde Regressionen, unerwünschte Seiteneffekte, übersehene Probleme."

### 6. LEAD-KONSOLIDIERUNG
Sammle ALLE Ergebnisse (6 gewählte Coding-Reports + 6 Selektion-Begründungen + 30 Council-Reviews) und übergib an council-lead:
"Konsolidiere:
- 6 Coding-Reports (mit Auswahlbegründung warum dieser Ansatz gewann)
- 30 Council-Reviews
Identifiziere:
- Merge-Konflikte zwischen gewählten Scopes
- Widersprüche (Coding-Agent vs Council-Review)
- Lücken (kein Scope hat Aspekt X bearbeitet)
- Regressionen (Council-Review fand neue Probleme)
- Hochkonfidente Findings (4+ von 5 fb-Modellen stimmen überein)
Normalisiere Severity: 🔴 Crash/Datenverlust, 🟠 logischer Fehler, 🟡 Stil/Wartbarkeit."

### 7. REDUNDANTE VERIFIKATION (2x)
Starte council-verify ZWEIMAL parallel mit allen 🔴-Findings:
- **verify-run-1**: Prüft Findings (TRUE/FALSE/UNCERTAIN)
- **verify-run-2**: Unabhängige Zweitmeinung
Nur Findings mit BEIDE TRUE gelten als bestätigt. Disagree → "nicht verifizierbar".

### 8. ABSCHLUSS
Präsentiere den konsolidierten Report:
- Pro Scope: welcher Ansatz gewann und warum
- Zusammenfassung aller umgesetzten Änderungen
- Konfidenz-Score (wie viele der 30 Reviews fanden KEINE neuen Probleme)
- Erkannte Konflikte (Datei/Zeile)
- Verifikationsergebnisse mit Übereinstimmungsstatus
