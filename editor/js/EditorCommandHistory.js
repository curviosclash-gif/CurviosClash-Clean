export class SnapshotCommand {
    constructor({ label, before, after, applySnapshot }) {
        this.label = String(label || 'Change');
        this.before = before;
        this.after = after;
        this.applySnapshot = applySnapshot;
    }

    undo() {
        this.applySnapshot(this.before);
    }

    redo() {
        this.applySnapshot(this.after);
    }
}

export class EditorCommandHistory {
    constructor(options = {}) {
        this.limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.trunc(options.limit) : 100;
        this.undoStack = [];
        this.redoStack = [];
        this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
        this._isApplying = false;
    }

    setChangeHandler(handler) {
        this.onChange = typeof handler === 'function' ? handler : null;
        this._emitChange();
    }

    getState() {
        const undoTop = this.undoStack[this.undoStack.length - 1] || null;
        const redoTop = this.redoStack[this.redoStack.length - 1] || null;
        return {
            canUndo: this.undoStack.length > 0 && !this._isApplying,
            canRedo: this.redoStack.length > 0 && !this._isApplying,
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length,
            undoLabel: undoTop?.label || '',
            redoLabel: redoTop?.label || '',
            isApplying: this._isApplying
        };
    }

    isApplying() {
        return this._isApplying;
    }

    clear() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
        this._emitChange();
    }

    push(command) {
        if (!command) return false;
        this.undoStack.push(command);

        if (this.undoStack.length > this.limit) {
            this.undoStack.splice(0, this.undoStack.length - this.limit);
        }

        this.redoStack.length = 0;
        this._emitChange();
        return true;
    }

    undo() {
        return this._applyFromStack(this.undoStack, this.redoStack, 'undo');
    }

    redo() {
        return this._applyFromStack(this.redoStack, this.undoStack, 'redo');
    }

    _applyFromStack(source, target, methodName) {
        if (this._isApplying || source.length === 0) return false;

        const command = source[source.length - 1];
        this._isApplying = true;
        try {
            command[methodName]();
            source.pop();
            target.push(command);
            return true;
        } catch (error) {
            console.error(`[EditorCommandHistory] ${methodName} failed for "${command?.label || 'command'}":`, error);
            throw error;
        } finally {
            this._isApplying = false;
            this._emitChange();
        }
    }

    _emitChange() {
        if (!this.onChange) return;
        try {
            this.onChange(this.getState());
        } catch (error) {
            console.warn('[EditorCommandHistory] onChange handler failed:', error);
        }
    }
}
