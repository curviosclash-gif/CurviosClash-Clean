const CONTROLLER_OUTPUT_PATTERN = /\b(dualsense|dualshock|wireless controller|controller speaker|sony interactive entertainment)\b/i;
const DEFAULT_OUTPUT_PATTERN = /^(default|standard|communications|kommunikation)\s*[-:–—]\s*/i;

function normalizedLabel(label = '') {
    return String(label).trim().replace(DEFAULT_OUTPUT_PATTERN, '').toLocaleLowerCase();
}

export function isControllerAudioOutput(device = {}) {
    return device.kind === 'audiooutput' && CONTROLLER_OUTPUT_PATTERN.test(String(device.label || ''));
}

export function selectSafeAudioOutput(devices = []) {
    const outputs = devices.filter((device) => device?.kind === 'audiooutput');
    const physicalOutputs = outputs.filter((device) =>
        device.deviceId &&
        device.deviceId !== 'default' &&
        device.deviceId !== 'communications' &&
        !isControllerAudioOutput(device)
    );
    if (!physicalOutputs.length) return null;

    const defaultOutput = outputs.find((device) => device.deviceId === 'default');
    const defaultLabel = normalizedLabel(defaultOutput?.label);
    if (defaultLabel) {
        const currentOutput = physicalOutputs.find((device) => normalizedLabel(device.label) === defaultLabel);
        if (currentOutput) return currentOutput;
    }

    return physicalOutputs.find((device) => String(device.label || '').trim()) || null;
}

export async function pinSafeAudioOutput(context, mediaDevices = globalThis.navigator?.mediaDevices) {
    if (typeof context?.setSinkId !== 'function' || typeof mediaDevices?.enumerateDevices !== 'function') {
        return null;
    }
    const output = selectSafeAudioOutput(await mediaDevices.enumerateDevices());
    if (!output) return null;
    await context.setSinkId(output.deviceId);
    return output.deviceId;
}

export function createAudioOutputGuard(mediaDevices = globalThis.navigator?.mediaDevices) {
    let context = null;
    let pinnedDeviceId = null;
    let listening = false;

    const pin = async (nextContext = context) => {
        context = nextContext;
        if (!context) return null;
        try {
            if (pinnedDeviceId && typeof context.setSinkId === 'function') {
                try {
                    await context.setSinkId(pinnedDeviceId);
                    return pinnedDeviceId;
                } catch {
                    pinnedDeviceId = null;
                }
            }
            pinnedDeviceId = await pinSafeAudioOutput(context, mediaDevices);
            if (pinnedDeviceId && !listening) {
                mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
                listening = true;
            }
            return pinnedDeviceId;
        } catch {
            return null;
        }
    };
    const onDeviceChange = () => void pin();

    return Object.freeze({
        pin,
        dispose() {
            if (listening) mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
            context = null;
            pinnedDeviceId = null;
            listening = false;
        },
    });
}
