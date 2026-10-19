class FakeBridge {
    register(ipcMain, channel) {
        ipcMain.handle(channel, () => true);
    }
}

module.exports = { FakeBridge };
