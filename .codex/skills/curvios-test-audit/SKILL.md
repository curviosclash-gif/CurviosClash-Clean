---
name: curvios-test-audit
description: Prüft die vollständige CurviosClash-Testsuite, erfasst alle roten und nicht ausgeführten Tests samt Dauer und erstellt daraus priorisierte Fix- und Infrastrukturpläne. Verwenden für vollständige Testbestandsaufnahmen und Folgeplanung, nicht für einen einzelnen gezielten Testfix.
---

# CurviosClash-Testaudit

Arbeite im Repository `CurviosClash-Clean`. Lies dessen aktuelle `AGENTS.md`, `package.json`, Testcluster-Konfiguration und Playwright-Wrapper; frühere Audit-Zahlen sind nur Vergleichswerte. Nutze einen vorhandenen aktuellen Ergebnisbericht statt eines neuen Vollaufs, wenn der Nutzer ausschließlich eine Folgeplanung daraus verlangt.

## Vollständigen Lauf erfassen

- Halte Commit, Branch, Arbeitsbaum und parallel belegte Ressourcen vor dem Lauf fest. Wenn Builds oder Tests Dateien erzeugen, nutze einen eigenen Worktree nach den aktuellen Repository-Regeln. Prüfe zuvor die Sitzungsgrenze. Berühre oder bereinige keine fremden Änderungen und keine untracked Dateien.
- Ermittle die tatsächlich vollständige Matrix aus den aktuellen Skripten: Quality und Contract-Gates, Desktop-Smoke, reguläre Desktop-Cluster, schwere Physik-, GPU- und Stress-Cluster sowie Browser-Kompatibilität. Führe angeforderte Plattformen aus; Desktop hat Vorrang. Deaktiviere das Playwright-Schloss nie und starte keine zwei Playwright-Läufe zugleich.
- Sammle maschinenlesbare Ergebnisse und Laufzeiten für jeden eindeutigen Test. Trenne Testdauer (bei Retries Summe der Versuche) von Cluster- und Gesamtdauer. Erfasse Pass, Fail, Flaky, bewusst übersprungen und `didNotRun` getrennt. Prüfe, ob ein serieller Fehler Folgetests verhindert hat, und führe diese gezielt nach; weise Original- und Nachlaufergebnis separat aus.
- Liste **jeden** roten Test mit Spec/Zeile, Titel, gemessener Dauer und erster aussagekräftiger Fehlermeldung. Unterscheide bestehende Katalogeinträge, neue Fehler und vermutete Infrastruktur-/Umgebungsfehler. Ein Katalogeintrag nach Titel belegt keine unveränderte Ursache; prüfe die aktuelle Fehlermeldung. Mehrere Fehler mit derselben Ursache dürfen zusätzlich gruppiert werden, aber die Einzelauflistung nicht ersetzen.
- Verifiziere strittige Ursachen mit dem kleinsten geeigneten Nachlauf. Erhöhe Timeouts, überspringe Tests oder erweitere die Liste bekannter Fehler nicht, um einen roten Lauf grün erscheinen zu lassen. Bewahre ausführliche Rohlogs oder Berichte nur außerhalb des Repositorys auf und verlinke sie; lösche Testartefakte nur nach den lokalen Freigaberegeln.

## Aus Befunden handeln

- Leite konkrete Verbesserungen der Testinfrastruktur aus beobachteten Fehlern und Wartezeiten ab. Trenne gesicherte Ursachen von Hypothesen; nenne die Prüfmethode für offene Fragen.
- Wenn Pläne verlangt sind, erstelle zwei getrennte, ausführbare Pläne: **alle roten Tests beheben** und **Testinfrastruktur überarbeiten**. Jeder Plan enthält Reihenfolge nach gemeinsamer Ursache, betroffene Bereiche, kleine Prüfgates und ein überprüfbares Abschlusskriterium. Empfiehl anhand der Evidenz, welcher zuerst beginnen sollte. Ein Infrastrukturblocker, der viele fachliche Tests verdeckt, hat Vorrang vor deren Diagnose; reine Laufzeitoptimierung kann warten.
- Wenn Arbeitsaufträge für zwei Agenten verlangt sind, formuliere zwei eigenständig lesbare Übergaben mit Dateiverantwortung, Abhängigkeit, Eingangsbelegen, Abnahme und den aktuellen Regeln für Worktrees, parallele Arbeit, Commit, Merge und Push. Starte Agenten nur auf ausdrücklichen Ausführungsauftrag und im Rahmen der geltenden Freigaben.
- Beende jeden für Codex erstellten Arbeits- oder Umsetzungsplan mit **Modellnutzung**: empfohlenes aktuell verfügbares Modell und Reasoning-Aufwand je Phase, Zweck, Qualitätsprüfung und konkreter Anlass zum Wechsel oder Eskalieren. Eine Empfehlung schaltet kein Modell um und erlaubt keine zusätzliche Delegation.

Berichte den belegten Stand und seine Grenzen: Ein Lauf auf einem älteren Commit ist keine Aussage über den aktuellen Hauptbranch. Nenne ausgefallene oder nicht ausgeführte Gates ausdrücklich.
