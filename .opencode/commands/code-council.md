---
description: Coding Council: 18 Coding-Experten in 3 Varianten pro Scope, Lead selektiert beste Lösung
---
Orchestriere einen vollständigen Coding-Council-Durchlauf mit 3-Wege-Redundanz pro Scope.

$ARGUMENTS

## Ablauf

### 1. REDUNDANTE PLANUNG (2x)
Starte den plan-Agenten ZWEIMAL parallel:
- **plan-minimal**: "Erstelle einen Plan mit minimalen Änderungen, maximaler Wiederverwendung für: $ARGUMENTS"
- **plan-robust**: "Erstelle einen Plan mit robuster, defensiver Lösung, alle Edge-Cases für: $ARGUMENTS"
Warte auf beide Pläne. Merge zu einem Master-Plan: übernimm aus plan-minimal die effizientesten Ansätze, aus plan-robust die notwendigen Safety-Netze.

### 2. DATEI-INVENTAR
Ermittle alle potenziell betroffenen Dateien:
```
git diff --name-only HEAD       (falls bereits Änderungen existieren)
```
ODER: Analysiere den Master-Plan und liste alle referenzierten Dateien.
Gruppiere die Dateien nach Modul/Zuständigkeit. Diese Liste dient als Orientierung für die Scope-Agenten.

### 2.5 BASELINE-SNAPSHOT (vor allen Scopes)
Sammle Profiling-Daten VOR jeglichen Code-Änderungen — dies ist die echte Baseline (unveränderter Ausgangszustand):
```
Starte council-baseline: "Sammle Profiling-Snapshot vor Coding-Council-Start"
```
Der Baseline-Agent schreibt nach `$env:TEMP\opencode\council-perf-snapshot.json`.
Diese Baseline dient als Referenz für spätere Vergleiche und wird an den perf-Scope weitergegeben.

### 3. SEQUENTIELLE IMPLEMENTIERUNG (6 Scopes nacheinander)

**WICHTIG: Scopes laufen SEQUENTIELL, nicht parallel.** Jeder Scope startet mit dem bereinigten Code des vorherigen Scopes. Das eliminiert Cross-Scope-Merge-Konflikte.

Reihenfolge: **arch → refactor → review → sec → test → perf**

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

**b) 3 Agenten parallel als Read-only-Vorschlagsphase starten**

| Scope | Ausgewogen (primary) | Robustheit (alt1) | Minimalismus (alt2) |
|-------|---------------------|-------------------|---------------------|
| arch | council-code-arch | council-code-arch-alt1 | council-code-arch-alt2 |
| refactor | council-code-refactor | council-code-refactor-alt1 | council-code-refactor-alt2 |
| review | council-code-review | council-code-review-alt1 | council-code-review-alt2 |
| sec | council-code-sec | council-code-sec-alt1 | council-code-sec-alt2 |
| test | council-code-test | council-code-test-alt1 | council-code-test-alt2 |
| perf | council-code-perf | council-code-perf-alt1 | council-code-perf-alt2 |

Jeder Agent erhält: Master-Plan + Datei-Inventar + $ARGUMENTS + seinen Scope + (nur perf: Profiling-Snapshot) + CROSS-CUTTING-AWARENESS-Prompt (siehe unten).

WICHTIG: In dieser Phase darf KEIN Agent Dateien ändern oder Shell-Befehle mit Seiteneffekten ausführen. Alle drei Varianten liefern ausschließlich einen konkreten Änderungsvorschlag. So bleiben die Varianten vergleichbar, ohne gleichzeitig denselben Arbeitsbaum zu verändern.

**c) Reports einsammeln**
Jeder Agent liefert Report im Pflichtformat:
```
## Scope: <name>
## Ansatz: <Ausgewogen|Robustheit|Defensiv|Stabilität|Durchsatz|Minimalismus|Pragmatisch|Kritische Pfade|Vollständig>
## Vorgeschlagene Änderungen
- [Datei:Zeile] Beschreibung der vorgeschlagenen Änderung -> Grund
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

**e) Gewählte Variante einmalig implementieren**
Starte ausschließlich den vom Lead gewählten Agenten erneut. Dieser zweite Lauf erhält den gewählten Vorschlag und die ausdrückliche Erlaubnis, ihn jetzt im gemeinsamen Arbeitsbaum zu implementieren. Die beiden nicht gewählten Varianten werden nicht erneut gestartet und haben keine Dateien verändert.

**f) PER-SCOPE BUILD GATE**
Nach der Implementierung führe einen inkrementellen Build-Check aus:
```
npm run build 2>&1
```
- Bei Build-Erfolg: Weiter mit Schritt g (Scope-File-Tracking)
- Bei Build-Fehler:
  1. Analysiere den Fehler (welche Datei/Zeile)
  2. Ordne ihn dem gewählten Agenten zu
  3. Starte diesen Agenten EINMALIG neu mit dem Build-Fehler als Zusatzkontext
  4. Erneut Build-Check
  5. Bei erneutem Fehlschlag: Stoppe den Ablauf und melde die betroffenen Dateien. Setze keine Dateien zurück und lösche keine untracked-Dateien ohne ausdrückliche Nutzerfreigabe.

**g) Scope-File-Tracking**
Ermittle die vom GEWÄHLTEN Agenten geänderten Dateien:
```
git diff --name-only HEAD
```
Speichere diese Dateiliste pro Scope für Step 5 (scope-gefilterte Reviews). Schreibe/aktualisiere:
```
$env:TEMP\opencode\code-council-scope-files.json
```
Format:
```json
{
  "scopes": {
    "arch": ["src/core/engine.js", "src/ui/panel.js"],
    "refactor": ["src/utils/helpers.js"],
    "...": []
  }
}
```

**h) Weiter zum nächsten Scope** (zurück zu Schritt a)

### 4. BUILD & TEST GATE
Nachdem ALLE 6 Scopes abgeschlossen sind (je 1 Gewinner-Implementierung):

1. Führe den Build aus:
   ```
   npm run build
   ```
2. Falls erfolgreich, führe Tests aus:
   ```
   npm test
   ```
3. **Fehlschlag-Behandlung**:
   - Bei Build-Fehler: `git diff` analysieren, fehlerhaften Scope identifizieren
   - Bei Test-Fehler: `git diff` + Fehlerlog analysieren, verantwortlichen Scope identifizieren
   - Betroffenen Scope EINMALIG mit dem Fehler als Zusatzkontext neu starten (3 Read-only-Vorschläge → Lead-Selektion → genau eine Implementierung)
   - Erneut Build & Test

### 5. REDUNDANTE CODE-REVIEW (30x, scope-gefiltert)
Erzeuge den vollständigen git Diff der bereinigten Änderungen:
```
git diff HEAD
```

Lade die pro-Scope Dateiliste aus `$env:TEMP\opencode\code-council-scope-files.json`.

JEDER Reviewer erhält NUR den Diff der Dateien seines eigenen Scopes (nicht den Gesamtdiff). Konstruiere für jeden Review-Scope:
```
git diff HEAD -- <dateien aus scope-files.json für diesen scope>
```
Falls ein Scope keine Dateien geändert hat: überspringe die Review für diesen Scope (0 statt 5 Reviewer).

Starte den read-only Council mit 5x-Parallel-Review pro Scope (jeder fb-Agent mit anderem Perspektiv-Prompt):

| Review-Scope | Agenten (5x) | fb-Perspektive | Scope-Diff |
|-------------|--------------|----------------|------------|
| review | council-review + fb + fb2 + fb3 + fb4 | fb: Standard / fb2: Neues Teammitglied / fb3: QA-Ingenieur / fb4: Spieler-Perspektive | Nur review-geänderte Dateien |
| arch | council-arch + fb + fb2 + fb3 + fb4 | fb: Standard / fb2: Microservices-Erfahrung / fb3: Monolith-Verfechter / fb4: Plattform-übergreifend | Nur arch-geänderte Dateien |
| sec | council-sec + fb + fb2 + fb3 + fb4 | fb: Standard / fb2: OWASP-Spezialist / fb3: Penetration-Tester / fb4: Angreifer-Perspektive | Nur sec-geänderte Dateien |
| perf | council-perf + fb + fb2 + fb3 + fb4 | fb: Standard / fb2: Mobile/Embedded / fb3: High-End-GPU / fb4: GC-Analyst | Nur perf-geänderte Dateien |
| test | council-test + fb + fb2 + fb3 + fb4 | fb: Standard / fb2: E2E-Spezialist / fb3: Unit-Test-Purist / fb4: Chaos-Engineer | Nur test-geänderte Dateien |
| refactor | council-refactor + fb + fb2 + fb3 + fb4 | fb: Standard / fb2: Clean-Code-Evangelist / fb3: Pragmatiker / fb4: Performance-fokussiert | Nur refactor-geänderte Dateien |

Jeder fb-Agent erhält ZUSÄTZLICH zum Basis-Prompt: `PERSPEKTIVE: <fb-Perspektive>. Bewerte den Code aus dieser Sicht.`

Jeder Reviewer erhält: "Review den scope-spezifischen Diff (nur <scope>-Änderungen) auf $ARGUMENTS. Finde Regressionen, unerwünschte Seiteneffekte, übersehene Probleme."

**Cross-Scope-Impact-Erkennung**: Zusätzlich erhält JEDER Reviewer den GESAMTDIFF zur Kenntnis (read-only, nicht im Fokus), damit Cross-Scope-Auswirkungen nicht übersehen werden. Der Prompt lautet:
```
HINWEIS: Der folgende Diff enthält NUR die Änderungen deines Scopes (<scope>).
Zur Orientierung hier der Gesamtdiff aller Scopes (nur zur Kenntnis, nicht im Review-Fokus):
<gesamtdiff>
```

### 6. LEAD-KONSOLIDIERUNG
Sammle ALLE Ergebnisse (6 gewählte Coding-Reports + 6 Selektion-Begründungen + 30 Council-Reviews) und übergib an council-lead:
"Konsolidiere:
- 6 Coding-Reports (mit Auswahlbegründung warum dieser Ansatz gewann)
- 30 Council-Reviews
Identifiziere:
- Widersprüche (Coding-Agent vs Council-Review)
- Lücken (kein Scope hat Aspekt X bearbeitet)
- Regressionen (Council-Review fand neue Probleme)
- Hochkonfidente Findings (4+ von 5 fb-Modellen stimmen überein)
Normalisiere Severity: 🔴 Crash/Datenverlust, 🟠 logischer Fehler, 🟡 Stil/Wartbarkeit."

### 7. REDUNDANTE VERIFIKATION (2x)
Starte council-verify ZWEIMAL parallel mit allen 🔴-Findings und 🟠-Findings:
- **verify-run-1**: Prüft jedes Finding (TRUE/FALSE/UNCERTAIN)
- **verify-run-2**: Unabhängige Zweitmeinung
Nur Findings mit BEIDE TRUE gelten als bestätigt. Disagree → "nicht verifizierbar".

### 8. FEEDBACK-LOOP (eine Iteration)
Falls nach Verifikation BESTÄTIGTE 🔴- oder 🟠-Findings existieren:
1. Ordne jedes Finding dem verantwortlichen Scope zu
2. Starte die betroffenen Scopes EINMALIG neu mit dem Finding als Zusatzkontext:
   "Zusätzlich zu deinem Scope-Auftrag: Behebe dieses von council-verify bestätigte Problem: <Finding>"
3. Nur 1 Agent pro Scope (keine 3-Wege-Selektion), direkt implementieren
4. Erneut Build & Test Gate (Schritt 4)
5. KEINE weitere Iteration — nicht behobene Findings als "offen" dokumentieren

### 9. ABSCHLUSS
Präsentiere den konsolidierten Report:
- Pro Scope: welcher Ansatz gewann und warum
- Zusammenfassung aller umgesetzten Änderungen
- Konfidenz-Score (wie viele der 30 Reviews fanden KEINE neuen Probleme)
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
