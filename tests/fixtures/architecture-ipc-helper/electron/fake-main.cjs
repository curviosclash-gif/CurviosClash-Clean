// Same name as the helper parameter below: the parameter must win inside the helper.
const channel = 'x:unrelated-constant';

const CHANNELS = Object.freeze({
    getAll: 'x:get-all',
    setValue: 'x:set-value',
});

function registerFakeIpc({ ipcMain }) {
    ipcMain.handle('x:literal', () => true);

    const registerHandler = (channel, handler) => {
        ipcMain.handle(channel, (event, ...args) => handler(event, ...args));
    };

    registerHandler(CHANNELS.getAll, () => ({}));
    registerHandler(CHANNELS.setValue, () => true);
}

module.exports = { registerFakeIpc, channel };
