# DSH-Skills für CurviosClash

Angepasste Kopien der Claude-Skills aus `.claude/skills/` für den DeepSeek Harness (DSH).
Die Quelle jedes Skills ist `.claude/skills/<name>/SKILL.md`; inhaltliche Korrekturen gehören zuerst in die Quelle und werden hier nachgezogen.

## Anpassungen gegenüber den Quellen

- Skriptpfade zeigen auf `.dsh/skills/<name>/scripts/` — die Skripte (und Referenzen) wurden mitkopiert.
- „PostToolUse-Hook" heißt hier „ESLint-Hook" (der DSH-Hook wird separat konfiguriert).
- `atomic-commit`: Claude-spezifische `Co-Authored-By`-Zeile entfernt; Push-Regel auf `AGENTS.md` Regeln 28/29 ausgerichtet.

## Bewusst nicht übernommen

`adaptive-model-routing`, `import-to-claude-code`, `ponytail` und die Codex-Skills (`idp-*`, …) — fremdwerkzeug-spezifisch bzw. nicht für DSH relevant.
