---
name: idp-execution-router
description: Entscheidet nach einem freigegebenen IDP-Konzept und ausdrücklichem Umsetzungsauftrag zwischen direkter Arbeit, gezielter Recherche, begrenzten Subagenten und unabhängigem Review und führt die gewählte Route aus. Nur für die Umsetzung eines vollständigen IDP-Prompts verwenden, nicht während Ideenfindung, Konzeptfreigabe oder allgemeiner Delegationsberatung.
---

# IDP Execution Router

Wähle für einen freigegebenen IDP-Prompt die kleinste sichere Ausführungstopologie und setze sie anschließend um. Optimiere die gesamten Tokens bis zu einem akzeptierten Ergebnis, einschließlich Root-Kontext, Agentenstart, Übergaben, Wiederholungen, Review und Verifikation. Die Routingentscheidung ist ein interner Umsetzungsschritt und keine zusätzliche Nutzerfreigabe.

## Übergabe und Freigaben

- Übernimm den vollständigen `FINALER IMPLEMENTIERUNGSPROMPT` und `FREIGEGEBENER STAND` einschließlich Scope, Annahmen, Nicht-Zielen und Abnahmekriterien.
- Beginne erst nach einem ausdrücklichen `UMSETZEN` oder gleichwertigen Auftrag und außerhalb des Plan-Modus. Fehlt eine dieser Bedingungen, mutiere nichts und kehre zum IDP-Gate zurück.
- Behandle gesperrte IDP-Entscheidungen und aktuelle Repository-Anweisungen als bindend. Muss eine gesperrte Entscheidung geändert werden, halte nur den betroffenen Teil an und öffne die Konzeptfreigabe erneut.
- Fordere wegen der gewählten Agentenaufteilung keine weitere Freigabe an.

## Günstiger Preflight

Prüfe vor der ersten Mutation knapp und read-only:

- den vollständigen betroffenen Ablauf, vorhandene Contracts und wiederverwendbare Produktfunktionen;
- Arbeitsbaum, fremde Änderungen, Dateibesitz und gemeinsam belegte Ressourcen;
- unabhängige Wissensfragen, Abhängigkeiten zwischen Arbeitspaketen und den Integrationspunkt;
- Risiko für Sicherheit, Datenverlust, Parallelität, Netzwerk, Speicherformate, Physik oder schwer automatisierbares Verhalten;
- die kleinsten passenden Tests, Builds und Produkt-Gates.

Wende dabei [Adaptive Model Routing](../adaptive-model-routing/SKILL.md) und dessen Ponytail-lite-Basis an. Bewerte nicht nur Dateizahl oder geschätzte Dauer: Abhängigkeiten, geteilter Zustand, Prüfbarkeit und Koordinationskosten entscheiden.

## Tokenziel mit Qualitätsuntergrenze

- Delegiere nur, wenn der erwartete Kontextgewinn oder die vermiedenen Fehlversuche Übergabe-, Anlauf- und Integrationskosten übersteigen.
- Bündele verwandte read-only Fragen in einem präzisen Auftrag, statt für jede Perspektive einen Agenten zu starten.
- Übergib nur freigegebene Anforderungen, benötigte lokale Regeln, relevante Pfade, Dateibesitz, Abnahmekriterien und den gewünschten Ergebnisvertrag; nie den vollständigen Verlauf ohne konkreten Bedarf.
- Fordere Schlussfolgerungen und ausgewählte Belege statt Rohprotokolle, vollständiger Dateiwiedergaben oder wiederholter Zusammenfassungen an.
- Verwende vorhandene Agenten für Nacharbeit weiter und sende nur Deltas. Wiederhole Exploration, Tests oder Review nur, wenn Änderungen oder neue Evidenz das frühere Ergebnis ungültig machen.

Spare keine Tokens durch das Auslassen notwendiger Tests, Sicherheits- oder Datenverlustschutz, Barrierefreiheit, Repository-Gates, gesperrter IDP-Anforderungen oder domänenspezifischer QA. Eskaliere Modell- oder Review-Stärke erst bei konkretem Risiko, ungelöster Mehrdeutigkeit oder gescheiterter Evidenz.

## Route wählen

Wähle genau eine Implementierungsroute:

1. **DIREKT:** Root setzt selbst um, wenn die Änderung klein oder kohärent, gut verstanden und eng sequenziell ist oder Delegation mehr Koordination als Nutzen erzeugt.
2. **SCOUT + DIREKT:** Ein zugelassener `gpt-6-luna`-Scout mit geringem Reasoning beantwortet eine klar abgegrenzte read-only Frage, deren Ergebnis die Lösung tatsächlich verändert; Root integriert und implementiert. Ein anderer Scout lohnt sich nur, wenn dessen tatsächliches Modell und Laufzeit besser passen.
3. **EIN WORKER:** Ein zugelassener `gpt-6-sol`-Worker mit mittlerem Reasoning besitzt ein begrenztes, klar prüfbares Implementierungspaket. Für eine eng spezifizierte, objektiv prüfbare Kleinänderung kann Luna genügen. Root behält Anforderungen, Integrationsentscheidungen und Abschlussprüfung.
4. **PARALLEL:** Mehrere Agenten nur, wenn mindestens zwei echte unabhängige Arbeitsstränge existieren, ihre Ergebnisse getrennt prüfbar sind und sie weder dieselben Dateien noch mutable Ressourcen, Ports, Build-Ausgaben oder Test-Locks teilen. Parallelität allein zur Laufzeitverkürzung genügt nicht: Sie muss voraussichtlich auch Gesamttokens sparen oder ein erhebliches Fehlversuchsrisiko senken. Bevorzuge parallele read-only Arbeit und standardmäßig nur einen schreibenden Agenten. Mehrere Schreiber sind nur zulässig, wenn Dateibesitz vollständig disjunkt und der Integrationsvertrag bereits stabil ist.

Wähle zusätzlich unabhängig davon die Review-Stufe:

- **KEIN SUBAGENT-REVIEW:** für kleine, objektiv getestete Änderungen ohne materielles Risiko;
- **BALANCED REVIEW:** ein unabhängiger Sol-6-Review mit mittlerem Reasoning für nicht-triviale Änderungen, breite Diffs oder Gameplay-, Visual- und Integrationsverhalten, das Tests nicht vollständig abdecken;
- **EXPERT REVIEW:** ein unabhängiger Sol-6-Review mit erhöhtem Reasoning für materielle Architektur-, Sicherheits-, Datenverlust-, Parallelitäts-, Netzwerk-, Speicherformat- oder Physikrisiken sowie nach zwei gescheiterten Hypothesen. Nur bei konkretem, ungelöstem Bedarf greift die Astra-Freigabegrenze des Adaptive Model Routing.

Nutze die schwächste Route und Review-Stufe, welche die Abnahmekriterien zuverlässig erfüllt. Starte keine Agenten auf Vorrat.

## Entscheidung sichtbar machen und ausführen

Nenne vor der Umsetzung knapp:

`Routing: <DIREKT|SCOUT + DIREKT|EIN WORKER|PARALLEL> · Review: <KEINS|BALANCED|EXPERT> · Grund: <ein Satz>`

Fahre danach ohne zusätzliche Bestätigung fort. Bei Delegation:

- verwende interne Subagenten, keine neuen nutzerseitigen Tasks;
- wähle Modell und Reasoning nach [Adaptive Model Routing](../adaptive-model-routing/SKILL.md); für GPT-6-Overrides nutze `agent_type: "default"` mit `fork_turns: "none"` und einem kompakten Paket aus Ziel, freigegebenem Scope, Dateiverantwortung, lokalen Regeln, Abnahmekriterien und erwarteter Evidenz;
- begrenze den Ergebnisvertrag auf Entscheidung, relevante Pfade, ausgewählte Belege, eigene Änderungen, ausgeführte Checks und offene Risiken;
- teile jedem schreibenden Agenten mit, dass andere im Arbeitsbaum arbeiten, und verbiete das Zurücksetzen, Stashen, Formatieren oder Committen fremder Änderungen;
- lasse Fachagenten keine weiteren Agenten starten;
- speichere Agenten-IDs, sende Nacharbeit an denselben Implementierer und liefere einem bestehenden Reviewer nur neue Deltas;
- parallelisiere nur Arbeit, die nach dem Preflight tatsächlich unabhängig ist.

Root integriert die Ergebnisse, prüft den tatsächlichen Diff selbst und führt die erforderlichen Tests, Builds und Repository-Gates aus. Ein Commit erfolgt nur gemäß den aktuellen Repository-Anweisungen und erst nach erfolgreicher Verifikation.

## Map-Erstellung

Bei komplexen Maps eignen sich Mapformat, vorhandene Contracts, Spawnregeln, Bots, Performancegrenzen und Referenzmaps für gezielte read-only Analyse. Starte nicht automatisch einen Agenten pro Aspekt: Bündele verwandte Fragen bei einem Scout und trenne Gameplay-Fluss oder visuelle Führung nur, wenn unabhängige Ergebnisse die Umsetzung nachweislich verbessern. Gib die eigentliche Map- oder Layoutdatei einem einzigen Besitzer; trenne schreibende Asset-Arbeit nur bei disjunkten Dateien und stabilen Assetverträgen. Prüfe die integrierte Map anschließend als Ganzes auf Fahrbarkeit, Modi, Spawns, Bots, Kollisionen, Ressourcenlebenszyklus und Performance.

## Grenzen

- Erweitere weder Scope noch Autorisierung durch Delegation.
- Erzeuge keine Planarchive, Statuskopien, Agenten-Wissensbasen oder Prozessberichte.
- Fehlt eine Rolle oder ein Tool, bearbeite sichere Schritte lokal und stoppe nur bei einer echten Kompetenz-, Freigabe- oder Scope-Lücke.
- Bei unverändertem Hindernis nicht denselben Agentenlauf wiederholen; benenne die fehlende Entscheidung oder externe Voraussetzung.
