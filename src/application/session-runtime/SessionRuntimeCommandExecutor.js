import { normalizeSessionRuntimeCommand } from '../../shared/contracts/SessionRuntimeCommandContract.js';
import { createSessionRuntimeCommandUseCases } from './SessionRuntimeCommandUseCases.js';

export class SessionRuntimeCommandExecutor {
    constructor({ facade = null, backends = null } = {}) {
        this._facade = facade || null;
        this._commandUseCases = createSessionRuntimeCommandUseCases({
            facade: this._facade,
            backends,
        });
    }

    execute(command = null) {
        const execution = this._resolveCommandExecution(command);
        return execution.useCase.execute(execution.command);
    }

    executeResult(command = null) {
        const execution = this._resolveCommandExecution(command);
        return execution.useCase.executeResult(execution.command);
    }

    _resolveCommandExecution(command = null) {
        const normalizedCommand = normalizeSessionRuntimeCommand(command);
        if (!normalizedCommand) {
            return {
                command,
                useCase: this._commandUseCases.invalid,
            };
        }
        return {
            command: normalizedCommand,
            useCase: this._commandUseCases.get(normalizedCommand.type),
        };
    }
}
