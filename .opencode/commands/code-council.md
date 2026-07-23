---
description: Coding Council: technisch getrennte Vorschlags-, Apply-, Review- und Verify-Phasen
---
Orchestriere einen Coding-Council-Durchlauf mit 3-Wege-Redundanz pro relevantem Scope.

$ARGUMENTS

## Ablauf

### 0. ISOLIERTER RUN-STATE

Erzeuge eine eindeutige Lauf-ID und initialisiere den maschinengeprüften State:

```powershell
$env:COUNCIL_RUN_ID = [guid]::NewGuid().ToString('N')
npm run council:runner:init -- "$ARGUMENTS"
```

Der State liegt repository- und laufisoliert unter `$env:TEMP\opencode\council\<repository-hash>\<run-id>\state.json`. Er enthält Base-Commit, Task-Hash und den unveränderten Start-Snapshot. Ändert sich `HEAD`, wird der Lauf abgebrochen.

### 1. REDUNDANTE PLANUNG (2x)
Starte den plan-Agenten ZWEIMAL parallel:
- **plan-minimal**: "Erstelle einen Plan mit minimalen Änderungen, maximaler Wiederverwendung für: $ARGUMENTS"
- **plan-robust**: "Erstelle einen Plan mit robuster, defensiver Lösung, alle Edge-Cases für: $ARGUMENTS"
Warte auf beide Pläne. Merge zu einem Master-Plan: übernimm aus plan-minimal die effizientesten Ansätze, aus plan-robust die notwendigen Safety-Netze.

### 2. DATEI-INVENTAR
Analysiere den Master-Plan und liste alle potenziell betroffenen Dateien. Bereits vor Council-Start veränderte oder untracked Dateien sind geschützte Nutzerdateien und kein Council-Inventar.

Gruppiere die geplanten Dateien nach Modul und Risiko. Wähle standardmäßig nur relevante Implementierungs-Scopes. `review` ist für Bugfixes, `test` für Teständerungen, `sec` für Vertrauensgrenzen, `perf` für Hot Paths, `arch` für Runtime-/Modulgrenzen und `refactor` nur für belegte Strukturarbeit aktiv. Nur ein ausdrücklich als vollständig angeforderter Lauf aktiviert alle sechs Scopes.

```powershell
npm run council:runner:implementation-plan -- '["src/example.js"]'
```

Der Runner validiert das Inventar gegen geschützte Nutzerdateien und gibt die aktiven Scopes in ihrer verbindlichen Reihenfolge aus. Nur für einen ausdrücklich vollständig angeforderten Lauf wird als zweites Argument `full` übergeben.

### 2.5 BASELINE-SNAPSHOT (vor allen Scopes)
Sammle Profiling-Daten VOR jeglichen Code-Änderungen — dies ist die echte Baseline (unveränderter Ausgangszustand):
```
Starte council-baseline: "Sammle Profiling-Snapshot vor Coding-Council-Start"
```
Der Baseline-Agent schreibt nach `$env:TEMP\opencode\council\<repository-hash>\<run-id>\perf-snapshot.json`.
Diese Baseline dient als Referenz für spätere Vergleiche und wird an den perf-Scope weitergegeben.

### 3. SEQUENTIELLE IMPLEMENTIERUNG (relevante Scopes)

**WICHTIG: Scopes laufen SEQUENTIELL, nicht parallel.** Jeder Scope startet mit dem bereinigten Code des vorherigen Scopes. Das eliminiert Cross-Scope-Merge-Konflikte.

Reihenfolge der aktivierten Scopes: **arch → refactor → review → sec → test → perf**

Der Grund für diese Reihenfolge:
- **arch** zuerst: strukturelle Änderungen bilden die Basis
- **refactor** danach: Cleanup auf stabiler Architektur
- **review** als drittes: Bugfixes auf bereinigtem Code
- **sec** als viertes: Security auf korrektem Code
- **test** als fünftes: Tests auf gesichertem Code
- **perf** zuletzt: Performance auf vollständig funktionalem Code (Profiling braucht lauffähigen Code)

#### Pro Scope: 3-Wege-Implementierung und Selektion

Für JEDEN Scope (in obiger Reihenfolge):

**a) Profiling-Snapshot (NUR vor perf-Scope)**
Bevor der perf-Scope startet, sammle einen AKTUELLEN Profiling-Snapshot (nach allen vorherigen Scope-Änderungen):
```
npm run profile     (falls vorhanden)
```
ODER: Starte die Anwendung kurz und sammle RuntimePerfProfiler-Daten.
Falls kein Profiler existiert: Vermerk im Prompt "Kein Snapshot verfügbar — statische Analyse".

Der perf-Scope erhält sowohl den Baseline-Snapshot (Schritt 2.5, unveränderter Ausgangszustand) als auch diesen aktuellen Snapshot, um das Delta zu messen.

**b) 3 technisch read-only Vorschläge parallel starten**

Starte `council-code-proposal` dreimal parallel mit demselben Master-Plan, Datei-Inventar, Auftrag und Scope, aber den Varianten `primary`, `alt1` und `alt2`. Dieser Agent erzwingt `edit: deny`, `bash: deny` und `task: deny`. Die schreibberechtigten `council-code-<scope>*`-Agenten dürfen in dieser Phase nicht gestartet werden.

**c) Reports einsammeln**
Jeder Agent liefert Report im Pflichtformat:
```
## Scope: <name>
## Variante: <primary|alt1|alt2>
## Ansatz: <Ausgewogen|Robustheit|Minimalismus>
## Geplante Dateien
- <relativer Repository-Pfad>
## Vorgeschlagene Änderungen
- [Datei:Symbol] Beschreibung der vorgeschlagenen Änderung -> Grund
## Verifikation
- Kleinster passender Test oder Build
## Nicht bearbeitet (ausserhalb Scope)
- Was bewusst nicht angefasst wurde
```

**d) Lead-Selektion**
Übergib die 3 Reports an council-lead:
"Vergleiche 3 Implementierungen für Scope <X>. Kriterien:
- QUALITÄT: Welche Lösung ist korrekt und vollständig?
- KONFLIKTFREIHEIT: Welche Lösung kollidiert am wenigsten mit anderen Scopes?
- AUFWAND/NUTZEN: Welches Verhältnis?
Wähle die BESTE. Begründe die Wahl."

**e) Nutzerkonflikt-Gate und einmalige Implementierung**

Extrahiere `Geplante Dateien` aus dem gewählten Vorschlag und starte den Scope-Snapshot:

```powershell
npm run council:runner:scope-start -- <scope> '["src/example.js"]'
```

Der Runner stoppt, wenn eine geplante Datei bereits vor Council-Start verändert oder untracked war. Starte danach ausschließlich die gewählte schreibberechtigte Variante:

| Variante | Apply-Agent |
|----------|-------------|
| primary | `council-code-<scope>` |
| alt1 | `council-code-<scope>-alt1` |
| alt2 | `council-code-<scope>-alt2` |

Der Apply-Agent erhält den ausgewählten Vorschlag und darf nur diesen umsetzen.

**f) MASCHINELLES SCOPE-DELTA UND GATE**

```powershell
npm run council:runner:scope-record -- <scope>
```

Der Runner berechnet das echte Hash-Delta zwischen Scope-Start und Scope-Ende, ordnet nur diese Dateien dem Scope zu und führt die aus diesem Delta abgeleiteten Tests beziehungsweise Builds aus. Er stoppt auch bei einer unerwarteten Berührung geschützter Nutzerdateien.

Bei einem Gate-Fehler darf der gewählte Apply-Agent genau einmal mit dem Fehlerlog nachbessern. Vor der Nachbesserung wird erneut `scope-start` aufgerufen; danach erneut `scope-record`. Schlägt das Gate wieder fehl, stoppt der Ablauf ohne Revert, Löschung oder Bereinigung.

**g) Weiter zum nächsten aktiven Scope** (zurück zu Schritt a)

### 4. ZENTRALES DESKTOP-GATE

Nach allen aktiven Scopes:

```powershell
npm run council:runner:gates -- final
```

Der Runner wählt die Gates aus dem tatsächlichen Council-Delta und erzwingt im finalen Lauf immer `npm run build:app` sowie `npm run test:contract:fast`. Bei einem Fehler wird nur der anhand des Scope-Deltas verantwortliche Scope einmal nachgebessert.

### 5. RISIKOBASIERTE REDUNDANTE CODE-REVIEWS

Erzeuge den maschinenlesbaren Review-Plan:

```powershell
npm run council:runner:review-plan
```

Der Plan koppelt Reviews an das Risiko der geänderten Dateien, nicht an den Agenten, der sie bearbeitet hat:

- `review` und `test` prüfen das gesamte Council-Delta.
- `arch` prüft Änderungen an Runtime-, Modul-, Tooling- und Konfigurationsgrenzen.
- `sec` prüft Vertrauensgrenzen, IPC, Netzwerk, Persistenz, Berechtigungen und Agentenkonfiguration.
- `perf` prüft Render-, Update-, Physik-, Kamera-, Bot-, Worker- und Profilingpfade.
- `refactor` wird bei breiterem strukturellem Delta aktiviert.

Starte für jeden im Plan enthaltenen Review-Scope die fünf read-only Geschwister mit exakt demselben scope-spezifischen Diff und Prompt. Eine Datei darf mehreren Review-Scopes zugeordnet sein. Dadurch prüft beispielsweise `sec` auch eine sicherheitsrelevante Änderung, die ursprünglich vom `review`-Apply-Agenten stammt.

### 6. LEAD-KONSOLIDIERUNG
Sammle alle gewählten Coding-Reports, Selektion-Begründungen und risikobasiert aktivierten Council-Reviews und übergib sie an council-lead:
"Konsolidiere:
- Coding-Reports der aktiven Implementierungs-Scopes
- 5 Reviews pro aktivem Risiko-Scope
Identifiziere:
- Widersprüche (Coding-Agent vs Council-Review)
- Lücken (kein Scope hat Aspekt X bearbeitet)
- Regressionen (Council-Review fand neue Probleme)
- Hochkonfidente Findings (4+ von 5 fb-Modellen stimmen überein)
Normalisiere Severity: 🔴 Crash/Datenverlust, 🟠 logischer Fehler, 🟡 Stil/Wartbarkeit."

### 7. REDUNDANTE VERIFIKATION (2x)
Starte `council-verify` und `council-verify-fb` parallel mit allen POTENTIAL_HIGH- und POTENTIAL_MEDIUM-Kandidaten:
- **council-verify**: beweisorientierte adversariale Prüfung mit DeepSeek
- **council-verify-fb**: widerlegungsorientierte Zweitprüfung mit einer anderen Modellfamilie

Beide erhalten dieselben Kandidaten, aber niemals den Bericht oder das Ergebnis des jeweils anderen Laufs. Verwende für beide den begrenzten `council:agent`-Wrapper.
Nur Findings mit BEIDE BUG gelten als bestätigt. Jeder andere oder abweichende Ausgang → "nicht verifizierbar" beziehungsweise kein bestätigter Produktfehler.

### 8. BEGRENZTER REPAIR-LOOP (maximal zwei Reparaturrunden)
Falls nach Verifikation BESTÄTIGTE 🔴- oder 🟠-Findings existieren:
1. Validiere das Finding-Schema, erzeuge die stabile Finding-ID und fordere einen Ursachenbeleg (`test`, `reproduction`, `contract`, `invariant` oder `static-rule`)
2. Ordne jedes Finding dem verantwortlichen Scope zu
3. Starte ausschließlich die betroffenen Scopes mit dem Finding als Zusatzkontext:
   "Zusätzlich zu deinem Scope-Auftrag: Behebe dieses von council-verify bestätigte Problem: <Finding>"
4. Nur 1 Agent pro Scope (keine 3-Wege-Selektion), direkt implementieren
5. Erzwinge das Reparaturbudget: keine Dependencies, Contracts, Deletes/Renames; maximal fünf zusätzliche Nicht-Testdateien
6. Führe die aus dem Datei-Delta gewählten Tests und Builds aus; im finalen Gate immer Desktop-App-Build und schnelle Contracts
7. Fokussiertes Re-Review durch den risikobasiert zuständigen Fach-Reviewer und danach `council-verify` und `council-verify-fb` erneut unabhängig
8. Wiederhole höchstens einmal (maximal zwei Reparaturrunden insgesamt). Keine neue Architekturentscheidung, keine parallelen Schreibzugriffe.
9. Bleibt dieselbe Finding-ID bestehen, erscheint eine behobene ID erneut, entstehen neue Regressionen oder widersprechen sich die Verify-Läufe: STOP mit spezifischem Exit-Zustand
10. Wenn reproduzierbar, ergänze zuerst einen Regressionstest und behebe danach die gemeinsame Ursache

### 9. ABSCHLUSS
Präsentiere den konsolidierten Report:
- Pro Scope: welcher Ansatz gewann und warum
- Zusammenfassung aller umgesetzten Änderungen
- Konfidenz-Score je aktivem Risiko-Scope (gültige Läufe und 4-von-5-Übereinstimmung)
- 🔴-Findings: bestätigt / behoben / offen
- 🟠-Findings: bestätigt / behoben / offen
- Build & Test: bestanden / fehlgeschlagen
- Verifikationsergebnisse mit Übereinstimmungsstatus

## Scope-Reihenfolge-Begründung

| # | Scope | Warum an dieser Position |
|---|-------|--------------------------|
| 1 | arch | Strukturelle Basis — alle anderen Scopes bauen darauf auf |
| 2 | refactor | Cleanup auf stabiler Architektur — reduziert Rauschen für Bugfinder |
| 3 | review | Bugfixes auf bereinigtem Code — keine falschen Alarme durch Dead Code |
| 4 | sec | Security auf korrektem Code — keine Lücken durch unentdeckte Bugs |
| 5 | test | Tests auf gesichertem Code — testet was tatsächlich deployed wird |
| 6 | perf | Performance zuletzt — Profiling braucht vollständig lauffähigen Code |

## CROSS-CUTTING AWARENESS (an alle 18 Coding-Agenten)

Jeder Coding-Agent erhält zusätzlich zu seinem Scope-Prompt diesen Abschnitt:

```
## CROSS-CUTTING AWARENESS
Deine Änderungen können Auswirkungen auf andere Scopes haben. Prüfe VOR jedem Edit:
- KÖNNTE diese Änderung einen bestehenden Test brechen? (test)
- KÖNNTE diese Änderung eine Security-Lücke öffnen? (sec)
- KÖNNTE diese Änderung Performance merklich verschlechtern? (perf)
- KÖNNTE diese Änderung einen Bug einführen? (review)
- KÖNNTE diese Änderung Architektur-Grenzen verletzen? (arch)
- KÖNNTE diese Änderung Code-Duplizierung erzeugen? (refactor)

Wenn JA: dokumentiere das Risiko im Bericht unter einem neuen Abschnitt "## Cross-Cutting Impacts".
Dieser Abschnitt MUSS Teil deines Berichtsformats sein.
```

## DELTA-BASIERTE SCOPE-AUSWAHL (für Loop/Iteration)

Wenn der Code-Council iterativ ausgeführt wird (z.B. durch code-council-loop):
- Überspringe Scopes, die in der vorherigen Iteration KEINE Änderungen produziert haben
- Nur Scopes mit tatsächlichem Delta erneut ausführen
- Ausnahme: Wenn ein Scope in der vorherigen Iteration übersprungen wurde aber neue 🔴- oder 🟠-Findings in seinem Bereich existieren, wird er wieder aktiviert
