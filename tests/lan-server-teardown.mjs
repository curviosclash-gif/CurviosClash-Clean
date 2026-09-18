// Shared teardown for contract tests that run a real LAN signaling server.
//
// Lobby dispose()/leave() send their leave request without waiting, and Node's fetch keeps
// idle sockets alive. If the test runner force-exits (--test-force-exit) while such a socket
// is still closing, Node on Windows aborts with a libuv UV_HANDLE_CLOSING assertion and the
// whole file counts as failed. So: let pending requests land, close every connection, close
// the server, then give the client side time to see the sockets go away.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function closeLanTestServer(server) {
    await wait(100);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await wait(200);
}
