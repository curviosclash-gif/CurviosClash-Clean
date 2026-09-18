// Storage key of the lobby name every player profile remembers. It lives apart from the
// profile storage contract so the lobby-name menu path does not pull the arcade contracts
// into the strict architecture typecheck.
export const LOBBY_NAME_STORAGE_KEY = 'cuviosclash.lobby-name.v1';
