---
name: curvios-skill-health-check
description: Audit CurviosClash Codex and Claude skills for broken references, copy drift, unsafe instructions, and unverified helper commands. Use for a requested skill health check, not for ordinary feature work or a full product test audit.
---

# Curvios Skill Health Check

Prüfe die Skills dieses Repositories lesend. Erfasse nur Befunde, die sich aus aktuellen Dateien und reproduzierbaren Prüfungen belegen lassen. Ändere Skills oder Helfer erst, wenn der Nutzer ausdrücklich eine Behebung beauftragt; befolge dafür `AGENTS.md` und die Regeln zur parallelen Arbeit.

## Umfang

- Prüfe `.codex/skills/*/SKILL.md` und `.claude/skills/*/SKILL.md` samt tatsächlich verlinkten Referenzen, Skripten und UI-Metadaten. Beziehe gleichnamige persönliche Kopien unter `~/.codex/skills` nur für einen Inhaltsabgleich ein. Persönliche Skills ohne Projektkopie gehören nicht zum Audit.
- Beginne mit `git status --short`, damit fremde Änderungen erkennbar bleiben. Lies die betroffenen Abläufe vollständig, bevor du eine Aussage über Sicherheit oder Ausführbarkeit triffst.
- Prüfe Frontmatter und Skill-Namen, lokale Markdown-Links, referenzierte Dateien, Beispielbefehle aus einem anderen Arbeitsverzeichnis, Skriptargumente gegen die tatsächliche CLI sowie inhaltliche Unterschiede zwischen Projekt- und persönlichen Kopien. Ignoriere reine Zeilenenden-Unterschiede.
- Prüfe besonders Freigaben, Agentenaufrufe, Resume-Abläufe, Löschen und Wiederherstellung, Worktrees, Commits und Tests gegen `AGENTS.md`. Unterscheide dokumentierte Absicht von technisch durchgesetztem Schutz. Starte für den Check keine Claude- oder anderen Agenten und führe keine Beispielbefehle aus, die Dateien verändern oder externe Dienste aufrufen.
- Nutze vorhandene, gezielte Validatoren und Tests nur, wenn sie lesend oder in einer sicheren, isolierten Umgebung laufen. Ein statischer Treffer ist noch kein Fehler: prüfe den Kontext und zeige die konkrete Auswirkung.

## Ergebnis

Melde jeden Befund mit Schweregrad, absolutem Dateipfad und Zeile, Beleg, Auswirkung und kleinster tragfähiger Korrektur. Fasse identische Ursachen zusammen. Nenne anschließend knapp die ausgeführten Prüfungen, nicht geprüfte Bereiche und den Gesamtzustand. Wenn nichts Belastbares gefunden wurde, sage das ausdrücklich und nenne die Grenzen des Checks.

Erstelle nur auf Wunsch einen Umsetzungsplan. Beende ihn dann gemäß `AGENTS.md` mit `Modellnutzung`. Ein Audit allein autorisiert weder Änderungen noch Delegation.
