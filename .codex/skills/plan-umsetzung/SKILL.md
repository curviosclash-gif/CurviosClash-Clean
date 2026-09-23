---
name: plan-umsetzung
description: Plant, implementiert und prüft eine ausdrücklich angeforderte Aufgabe mit getrennten Rollen. Verwenden bei $plan-umsetzung oder wenn dieser Ablauf ausdrücklich gewünscht ist; nicht für allgemeine Planungsanfragen.
---

# Plan & Umsetzung

Koordiniere eine explizit angeforderte Aufgabe mit schlanker Planung, begrenzter Umsetzung und unabhängiger Prüfung. Optimiere die gesamten Tokens bis zu einem akzeptierten Ergebnis, ohne Tests, Schutzvorkehrungen oder Nutzergrenzen zu kürzen.

Wende nach vollständigem Verständnis des betroffenen Ablaufs die [Ponytail-lite-Basis](../adaptive-model-routing/SKILL.md#ponytail-lite-baseline) auf Planung und Umsetzung an. Sie darf Freigaben, Tests, Sicherheits- und Datenverlustschutz oder ausdrücklich verlangtes Verhalten nicht abschwächen.

## Auftrag und Freigaben

- `$plan-umsetzung <Aufgabe>` bedeutet vollständige Ausführung. Ein ausdrücklich gewünschter Plan bleibt plan-only und mutiert nichts.
- Nutzerziel, Scope, Berechtigungen sowie ausdrückliche Modell-, Reasoning- und unabhängige-Review-Vorgaben haben Vorrang.
- Die Verwendung von `$plan-umsetzung`, ein allgemeiner Wunsch nach maximaler Qualität oder eine automatische Modellvererbung genehmigt `gpt-6-astra` nicht. Wähle, starte oder beauftrage Astra nur nach ausdrücklicher Freigabe für den konkreten Einsatz in der aktuellen Aufgabe.
- Wenn Astra notwendig oder materiell vorteilhaft erscheint, nenne knapp den konkreten Grund und den erwarteten Vorteil gegenüber dem stärksten geeigneten Nicht-Astra-Modell und frage vor dem Start um Freigabe. Bei ausbleibender oder abgelehnter Freigabe verwende die stärkste geeignete Nicht-Astra-Route bei unveränderten Tests und Qualitäts-Gates.
- Eine Astra-Freigabe gilt nur für den beschriebenen Einsatz in dieser Aufgabe. Für einen wesentlich anderen Einsatz oder eine spätere unabhängige Aufgabe muss erneut gefragt werden.
- Fordere keine weitere Planfreigabe, wenn die Umsetzung bereits erlaubt ist. Ein fertiger IDP-Prompt oder eine Konzeptfreigabe allein erlaubt sie nicht; ein anschließender ausdrücklicher Implementierungsauftrag genügt.
- Nach [IDP](../idp/SKILL.md) sind `FINALER IMPLEMENTIERUNGSPROMPT`, `FREIGEGEBENER STAND`, gesperrte Entscheidungen und Abnahmekriterien bindend. Technische Planung erweitert sie nicht. Halte nur den betroffenen Teil an, wenn eine gesperrte Entscheidung geändert werden müsste.
- Delegierte Teilaufträge lösen keinen rekursiven Ablauf aus.

## Früh prüfen und passend routen

Root koordiniert den Ablauf selbst und verwendet [Adaptive Model Routing](../adaptive-model-routing/SKILL.md). Vermeide einen zusätzlichen Steueragenten, solange Root Anforderungen, Rollen und Integration ohne eigenen unabhängigen Arbeitsstrang verwalten kann.

1. Root liest lokale Regeln und prüft kurz Ausgangszustand, fremde Änderungen und gemeinsam belegte Ressourcen.
2. Für eine umfangreiche, eigenständige read-only Frage kann Root höchstens einen Scout mit `gpt-6-luna` und geringem Reasoning beauftragen. Bei überschaubarem Kontext untersucht Root direkt.
3. Root erstellt aus den Belegen den kleinsten tragfähigen Plan. Nur bei materieller Architektur-, Sicherheits-, Datenverlust-, Netzwerk-, Speicherformat-, Physik- oder Parallelitätsunsicherheit prüft ein unabhängiger Reviewer mit `gpt-6-sol` und erhöhtem Reasoning den Plan.
4. Ein Worker setzt das klar abgegrenzte Arbeitspaket um und führt die betroffenen Checks aus. Verwende `gpt-6-sol` mit mittlerem Reasoning für Coding mit Urteilsspielraum; `gpt-6-luna` genügt für eng spezifizierte, objektiv prüfbare Kleinänderungen.
5. Ein frischer, unabhängiger Reviewer prüft Dateien, Diff und Belege. Verwende `gpt-6-sol` mit mittlerem Reasoning, erhöht bei materiellem Risiko, zwei gescheiterten Hypothesen oder einem ungelösten systemübergreifenden Befund. Für eine triviale, vollständig objektiv geprüfte Änderung genügt Roots Diff- und Testprüfung.

Diese Modellvorschläge sind Kosten- und Kontextklassen. Nutzerseitig ausdrücklich verlangte Modelle, Reasoning-Stufen oder Reviewer haben Vorrang. Verwende nur Modelle und Stufen, die die aktuelle Laufzeit tatsächlich anbietet; feste `economy_scout`-, `balanced_worker`- und `expert_reviewer`-Rollen können noch ältere Modelle verwenden.

## Delegation

- Vor jedem Spawn einen günstigen Preflight ausführen. Delegiere nicht, wenn die Aufgabe trivial, eng sequenziell oder kleiner als der Koordinationsaufwand ist.
- Verwende für GPT-6-Overrides `agent_type: "default"` und `fork_turns: "none"` mit einem kompakten Paket aus Ziel, Dateiverantwortung, lokalen Regeln, Abnahmekriterien und benötigter Evidenz. Übergib nie den vollständigen Verlauf, wenn diese Angaben genügen.
- Fachagenten starten keine weiteren Agenten. Maximal ein schreibender Agent; unabhängige read-only Arbeit darf nur parallel laufen, wenn sie keine belegten Ressourcen oder veränderliche Dateien teilt. Keine Planarchive, `create_thread`-Aufrufe oder globale Modellkonfiguration.
- Der Implementierer kennt parallele Arbeit, berührt keine fremden Änderungen und berichtet eigene Dateien, Entscheidung, ausgeführte Checks, Überschneidungen, Risiken und Planabweichungen. Er committet nicht vorzeitig.
- Der Reviewer liefert `freigegeben`, begrenzte `Nacharbeit` oder `Hindernis` samt Ursache und prüft die tatsächlichen Dateien selbst. Eine Worker-Zusammenfassung ersetzt keine eigene Sicht auf Diff und Checks.
- Speichere Agent-IDs. Übergib Nacharbeit an denselben Implementierer und neue Belege an denselben Reviewer. Sende nur Deltas. Wiederhole nur bei neuer Evidenz; bei gleichem Hindernis beenden und die fehlende Entscheidung benennen.

## Abschluss und Grenzen

Root integriert Ergebnisse, hält Tests sowie Datenverlust-, Sicherheits- und Projekt-Gates ein und koordiniert einen verlangten Commit erst nach dem Review. Nenne nicht ausgeführte Checks ehrlich. Bei fehlendem Tool oder einer fehlenden Rolle bearbeite sichere lokale Schritte selbst; stoppe nur, wenn die notwendige Kompetenz oder Autorisierung tatsächlich fehlt.
