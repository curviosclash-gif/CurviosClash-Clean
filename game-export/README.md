# CurviosClash Game

This repository is generated from a committed `CurviosClash-Clean` source revision. Do not edit generated sync commits directly.

## Windows installers

- Windows 10/11 x64: `CurviosClash-Setup-<version>-x64.exe`
- Windows 11 ARM64: `CurviosClash-Setup-<version>-arm64.exe`

Both installers are per-user NSIS packages and contain Electron, game assets, the LAN signaling server, and FFmpeg. Installation does not require Git, Node.js, npm, administrator access, or an internet connection.

Online multiplayer is optional. Without `VITE_SIGNALING_URL`, local play and LAN hosting remain available and the online transport reports that it is not configured.

Release tags use `vX.Y.Z`. A release is published only after both native Windows architectures install, launch, pass the installed-product smoke, and uninstall successfully.
