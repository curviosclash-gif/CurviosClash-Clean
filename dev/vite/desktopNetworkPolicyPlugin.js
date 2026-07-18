export function desktopNetworkPolicyPlugin(env = process.env) {
    return {
        name: 'curvios-desktop-network-policy',
        apply: 'build',
        generateBundle() {
            if (String(env?.VITE_APP_MODE || '').trim().toLowerCase() !== 'app') return;
            let signalingOrigin = '';
            try {
                const url = new URL(String(env?.VITE_SIGNALING_URL || '').trim());
                if (url.protocol === 'ws:' || url.protocol === 'wss:') signalingOrigin = url.origin;
            } catch {
                signalingOrigin = '';
            }
            this.emitFile({
                type: 'asset',
                fileName: 'desktop-network-policy.json',
                source: JSON.stringify({ signalingOrigin }),
            });
        },
    };
}
