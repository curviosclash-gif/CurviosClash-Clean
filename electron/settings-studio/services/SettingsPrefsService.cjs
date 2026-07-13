const fs = require('node:fs');
const path = require('node:path');

const PREFS_FILENAME = 'settings-studio-prefs.json';
const SUPPORTED_LANGUAGES = new Set(['de', 'en']);
const DEFAULT_PREFS = { language: 'de' };

class SettingsPrefsService {
    constructor({ app }) {
        this._app = app;
    }

    _getPrefsPath() {
        return path.join(this._app.getPath('userData'), PREFS_FILENAME);
    }

    loadPrefs() {
        try {
            const raw = fs.readFileSync(this._getPrefsPath(), 'utf-8');
            const parsed = JSON.parse(raw);
            const language = SUPPORTED_LANGUAGES.has(parsed?.language) ? parsed.language : DEFAULT_PREFS.language;
            return { language };
        } catch {
            return { ...DEFAULT_PREFS };
        }
    }

    savePrefs(prefs) {
        const normalized = {
            language: SUPPORTED_LANGUAGES.has(prefs?.language) ? prefs.language : DEFAULT_PREFS.language,
        };
        fs.writeFileSync(this._getPrefsPath(), JSON.stringify(normalized, null, 2), 'utf-8');
        return normalized;
    }
}

module.exports = { SettingsPrefsService };
