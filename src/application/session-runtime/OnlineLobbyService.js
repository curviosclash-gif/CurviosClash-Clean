import { OnlineMatchLobby } from '../../network/OnlineMatchLobby.js';
import { resolveOnlineSignalingUrl } from '../../network/OnlineSignalingSupport.js';
import { LOBBY_SERVICE_TRANSPORTS } from '../../shared/contracts/LobbyServiceContract.js';
import { resolveConfiguredOnlineSignalingUrl } from '../../shared/contracts/OnlineSignalingConfig.js';
import { resolveGlobalObject } from './LobbyRuntimeEnvironment.js';
import { NetworkLobbyService } from './NetworkLobbyService.js';

export class OnlineLobbyService extends NetworkLobbyService {
    constructor(options = {}) {
        const runtimeGlobal = resolveGlobalObject(options.runtime?.global || null);
        const resolveConfiguredUrl = (explicitSignalingUrl = '') => resolveOnlineSignalingUrl(
            explicitSignalingUrl,
            resolveConfiguredOnlineSignalingUrl({ runtimeGlobal })
        );
        super({
            ...options,
            transport: LOBBY_SERVICE_TRANSPORTS.ONLINE,
            supportsDiscovery: false,
            discoveryPort: null,
            createLobby: typeof options.createLobby === 'function'
                ? options.createLobby
                : (signalingUrl) => new OnlineMatchLobby({ signalingUrl }),
            resolveHostSignalingUrl: typeof options.resolveHostSignalingUrl === 'function'
                ? options.resolveHostSignalingUrl
                : () => resolveConfiguredUrl(),
            resolveJoinSignalingUrl: typeof options.resolveJoinSignalingUrl === 'function'
                ? options.resolveJoinSignalingUrl
                : ({ explicitSignalingUrl }) => resolveConfiguredUrl(explicitSignalingUrl),
            joinLobby: typeof options.joinLobby === 'function'
                ? options.joinLobby
                : (lobby, joinOptions = {}) => lobby.join(joinOptions.lobbyCode, {
                    signalingUrl: joinOptions.signalingUrl,
                }),
        });
    }
}
