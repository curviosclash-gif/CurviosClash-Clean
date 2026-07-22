---
description: Council-Sync: erkennt Prüfpunkt-Abweichungen zwischen read-only Council (council-*.md) und Coding Council (council-code-*.md)
---

Vergleiche die Prüfpunkte (Checklisten) zwischen den read-only Council-Agenten und den Coding-Council-Agenten pro Scope. Melde jede Abweichung.

## Scopes und Dateipaare

| Scope | Read-only Agent | Coding Agent (primary) |
|-------|----------------|----------------------|
| review | `.opencode/agents/council-review.md` | `.opencode/agents/council-code-review.md` |
| arch | `.opencode/agents/council-arch.md` | `.opencode/agents/council-code-arch.md` |
| sec | `.opencode/agents/council-sec.md` | `.opencode/agents/council-code-sec.md` |
| perf | `.opencode/agents/council-perf.md` | `.opencode/agents/council-code-perf.md` |
| test | `.opencode/agents/council-test.md` | `.opencode/agents/council-code-test.md` |
| refactor | `.opencode/agents/council-refactor.md` | `.opencode/agents/council-code-refactor.md` |

## Methodik pro Scope

1. Lies BEIDE Dateien vollständig.
2. Extrahiere die Prüfpunkte aus dem read-only Agenten (Abschnitt `ZUSATZLICHE PRÜFPUNKTE:` oder vergleichbare nummerierte Liste).
3. Extrahiere die Prüfpunkte aus dem Coding-Agenten (Abschnitt `IMPLEMENTIERUNGS-PRÜFPUNKTE:`).
4. Vergleiche:
   - Prüfpunkt nur im read-only Agent → `RO_ONLY` (Analyse ohne Implementierung)
   - Prüfpunkt nur im Coding Agent → `CODE_ONLY` (Implementierung ohne Analyse)
   - Prüfpunkt in beiden, aber unterschiedliche Formulierung → `DIVERGENT`
   - Prüfpunkt identisch → `SYNCED`
5. Prüfe auch die Cross-Cutting-Awareness-Regeln der Coding-Agenten auf Entsprechung im read-only Pendant.

## Ausgabeformat

```
VERDICT: SYNCED|DRIFT_DETECTED|RO_ONLY_ITEMS|CODE_ONLY_ITEMS

## Scope: <name>

| # | Status | Read-only Prüfpunkt | Coding Prüfpunkt | Abweichung |
|---|--------|--------------------|------------------|------------|

### RO_ONLY (Analyse ohne Implementierungs-Gegenstück)
- Prüfpunkt X: Beschreibung → Müsste in council-code-<scope>.md ergänzt werden

### CODE_ONLY (Implementierung ohne Analyse-Gegenstück)
- Prüfpunkt Y: Beschreibung → Müsste in council-<scope>.md ergänzt werden

### DIVERGENT
- Prüfpunkt Z: RO sagt "..." / CODE sagt "..." → Manueller Abgleich nötig

## Zusammenfassung

| Scope | Status | RO_ONLY | CODE_ONLY | DIVERGENT | SYNCED |
|-------|--------|---------|-----------|-----------|--------|

## Handlungsempfehlung
- RO_ONLY items: In die IMPLEMENTIERUNGS-PRÜFPUNKTE des Coding-Agenten übernehmen
- CODE_ONLY items: In die ZUSATZLICHE PRÜFPUNKTE des Read-only-Agenten übernehmen
- DIVERGENT items: Manuell auf die präzisere oder vollständigere Formulierung vereinheitlichen
```
