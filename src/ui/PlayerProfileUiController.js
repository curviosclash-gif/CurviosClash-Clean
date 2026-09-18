import { PLAYER_PROFILE_MAX_NAME_LENGTH } from '../shared/contracts/PlayerProfileContract.js';

function sanitizeFilePart(value) {
    return String(value || 'spieler')
        .normalize('NFKD')
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'spieler';
}

const PROFILE_RELOAD_WATCHDOG_MS = 2000;

export function resolvePlayerProfileReasonMessage(reason) {
    const messages = {
        invalid_root: 'Die Datei enthält kein Spielerprofil.',
        profile_not_found: 'Spielerprofil nicht gefunden.',
        profile_limit: 'Die maximale Anzahl Spielerprofile ist erreicht.',
        last_profile: 'Das letzte Spielerprofil kann nicht archiviert werden.',
        protected_profile: 'Aktives oder Standardprofil kann nicht archiviert werden.',
        file_too_large: 'Die Importdatei ist zu groß.',
        invalid_json: 'Der Import enthält kein gültiges JSON.',
        unsupported_schema: 'Diese Profilversion wird nicht unterstützt.',
        unknown_record_kind: 'Der Import enthält unbekannte Datenbereiche.',
        hangar_open: 'Spielerprofilwechsel ist nur bei geschlossenem Hangar möglich.',
        lobby_active: 'Spielerprofilwechsel ist während einer Lobby nicht möglich.',
        match_active: 'Spielerprofilwechsel ist nur im Hauptmenü möglich.',
        persistence_failed: 'Ausstehender Fortschritt konnte nicht gespeichert werden.',
    };
    return messages[String(reason || '')] || `Aktion fehlgeschlagen (${String(reason || 'unbekannt')}).`;
}

export class PlayerProfileUiController {
    constructor(options = {}) {
        this.manager = options.playerProfileManager || null;
        this.activateProfile = typeof options.activateProfile === 'function' ? options.activateProfile : null;
        this.showStatusToast = typeof options.showStatusToast === 'function' ? options.showStatusToast : () => {};
        this.document = options.document || globalThis.document;
        this.setTimeout = typeof options.setTimeout === 'function'
            ? options.setTimeout
            : (callback, delayMs) => globalThis.setTimeout(callback, delayMs);
        this.cleanups = [];
        this.refs = {};
    }

    init() {
        const byId = (id) => this.document?.getElementById?.(id) || null;
        this.refs = {
            summary: byId('player-profile-summary'),
            name: byId('player-profile-name'),
            select: byId('player-profile-select'),
            create: byId('btn-player-profile-create'),
            rename: byId('btn-player-profile-rename'),
            activate: byId('btn-player-profile-activate'),
            default: byId('btn-player-profile-default'),
            archive: byId('btn-player-profile-archive'),
            export: byId('btn-player-profile-export'),
            import: byId('btn-player-profile-import'),
            file: byId('player-profile-file'),
            transfer: byId('player-profile-transfer'),
            status: byId('player-profile-status'),
        };
        const bind = (target, eventName, handler) => {
            if (!target?.addEventListener) return;
            target.addEventListener(eventName, handler);
            this.cleanups.push(() => target.removeEventListener(eventName, handler));
        };
        // The field stops at the limit by itself (maxlength), so say why instead of cutting silently.
        bind(this.refs.name, 'input', () => {
            if (!this.refs.status) return;
            const atLimit = Array.from(String(this.refs.name?.value || '')).length >= PLAYER_PROFILE_MAX_NAME_LENGTH;
            this.refs.status.textContent = atLimit ? `Namen haben höchstens ${PLAYER_PROFILE_MAX_NAME_LENGTH} Zeichen.` : '';
            this.refs.status.dataset.tone = 'info';
        });
        bind(this.refs.select, 'change', () => {
            const selected = this._selected();
            if (selected && this.refs.name) this.refs.name.value = selected.displayName;
            this.sync();
        });
        bind(this.refs.create, 'click', () => this._handle(this.manager?.createProfile?.(this.refs.name?.value), 'Spielerprofil erstellt.'));
        bind(this.refs.rename, 'click', () => this._handle(this.manager?.renameProfile?.(this._selected()?.id, this.refs.name?.value), 'Spielerprofil umbenannt.'));
        bind(this.refs.default, 'click', () => this._handle(this.manager?.setDefaultProfile?.(this._selected()?.id), 'Standardprofil aktualisiert.'));
        bind(this.refs.archive, 'click', () => {
            const selected = this._selected();
            if (!selected) return;
            if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`Spielerprofil „${selected.displayName}“ archivieren?`)) return;
            this._handle(this.manager?.archiveProfile?.(selected.id), 'Spielerprofil archiviert.');
        });
        bind(this.refs.activate, 'click', () => this._activateSelected());
        bind(this.refs.export, 'click', () => this._exportSelected());
        bind(this.refs.import, 'click', () => {
            if (this.refs.transfer?.value?.trim()) this._import(this.refs.transfer.value);
            else this.refs.file?.click?.();
        });
        bind(this.refs.file, 'change', async () => {
            const file = this.refs.file?.files?.[0];
            if (!file) return;
            this._import(await file.text());
            this.refs.file.value = '';
        });
        this.sync();
        if (this.manager?.lastError) this._setStatus(resolvePlayerProfileReasonMessage(this.manager.lastError), 'error');
    }

    async _activateSelected() {
        const selected = this._selected();
        if (!selected || !this.activateProfile) return null;
        const result = await this.activateProfile(selected.id);
        if (!result?.ok) {
            this._setStatus(resolvePlayerProfileReasonMessage(result?.reason), 'error');
            return result;
        }
        this.sync(selected.id);
        // The page reloads right after a switch; if it is still here, the new profile never loaded.
        this.setTimeout(() => {
            this._setStatus('Spielerprofil wurde nicht geladen. Bitte die App neu starten.', 'error');
        }, PROFILE_RELOAD_WATCHDOG_MS);
        return result;
    }

    _selected() {
        const id = String(this.refs.select?.value || '');
        return this.manager?.getProfiles?.({ includeArchived: true })?.find((profile) => profile.id === id) || null;
    }

    _handle(result, successMessage) {
        if (!result?.ok) {
            this._setStatus(resolvePlayerProfileReasonMessage(result?.reason), 'error');
            return result;
        }
        this._setStatus(successMessage, 'success');
        this.sync(result.profile?.id);
        return result;
    }

    _setStatus(message, tone = 'info') {
        if (this.refs.status) {
            this.refs.status.textContent = String(message || '');
            this.refs.status.dataset.tone = tone;
        }
        this.showStatusToast(message, 1600, tone);
    }

    sync(preferredId = '') {
        const profiles = this.manager?.getProfiles?.() || [];
        const active = this.manager?.getActiveProfile?.();
        const defaultProfile = this.manager?.getDefaultProfile?.();
        if (this.refs.summary) this.refs.summary.textContent = `Spieler: ${active?.displayName || 'Spieler 1'}`;
        if (!this.refs.select) return;
        const selectedId = preferredId || this.refs.select.value || active?.id || '';
        this.refs.select.replaceChildren();
        for (const profile of profiles) {
            const option = this.document.createElement('option');
            option.value = profile.id;
            const labels = [];
            if (profile.id === active?.id) labels.push('aktiv');
            if (profile.id === defaultProfile?.id) labels.push('Standard');
            option.textContent = `${profile.displayName}${labels.length ? ` (${labels.join(', ')})` : ''}`;
            this.refs.select.appendChild(option);
        }
        this.refs.select.value = profiles.some((profile) => profile.id === selectedId) ? selectedId : (active?.id || '');
        const selected = this._selected();
        if (this.refs.name && !this.refs.name.matches?.(':focus')) this.refs.name.value = selected?.displayName || '';
        if (this.refs.activate) this.refs.activate.disabled = !selected || selected.id === active?.id;
        if (this.refs.default) this.refs.default.disabled = !selected || selected.id === defaultProfile?.id;
        if (this.refs.archive) this.refs.archive.disabled = !selected || selected.id === active?.id || selected.id === defaultProfile?.id || profiles.length <= 1;
        if (this.refs.rename) this.refs.rename.disabled = !selected;
        if (this.refs.export) this.refs.export.disabled = !selected;
    }

    _exportSelected() {
        const selected = this._selected();
        const result = this.manager?.exportProfile?.(selected?.id);
        if (!result?.ok) return this._handle(result, '');
        const json = JSON.stringify(result.value, null, 2);
        if (this.refs.transfer) this.refs.transfer.value = json;
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = this.document.createElement('a');
        anchor.href = url;
        anchor.download = `curviosclash-profile-${sanitizeFilePart(selected.displayName)}-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        this._setStatus('Spielerprofil exportiert.', 'success');
        return result;
    }

    _import(raw) {
        const result = this.manager?.importProfile?.(raw);
        if (!result?.ok) return this._handle(result, '');
        if (this.refs.transfer) this.refs.transfer.value = '';
        return this._handle(result, 'Spielerprofil importiert.');
    }

    dispose() {
        this.cleanups.splice(0).forEach((cleanup) => cleanup());
    }
}
