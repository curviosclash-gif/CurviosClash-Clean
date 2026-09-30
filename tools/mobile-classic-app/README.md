# Curvios Clash Mobile

Capacitor wrapper for the phone-first Android game build. The app ships
every desktop game feature except splitscreen: Classic, Arcade-Parcours, Fight,
quick start, the hangar page, the expert menu and online multiplayer. Without
the Electron LAN server the phone joins LAN games by host address and hosts
online only. Recordings and exports open the Android share sheet through
`@capacitor/filesystem` and `@capacitor/share`. The separate Map Tools Android
wrapper stays independent.

Build the web bundle from the repository root:

```bash
npm run app:android:build
```

Create the Android project once:

```bash
npm run app:android:add
```

After that, sync or open the native project:

```bash
npm run app:android:sync
npm run app:android:open
```

Refresh and check that the Android public assets match the latest
`dist/mobile-classic` bundle:

```bash
npm run app:android:assets:check
```

Build and install a debug APK on the connected Android device:

```bash
npm run app:android:install
```

Update the connected phone from the configured GitHub remote:

```bash
npm run app:android:update:github
```

The updater accepts `--remote <name>` and `--branch <name>`. It only fast-forwards
from a GitHub remote and refuses to pull when the working tree has uncommitted
changes, then rebuilds, installs, and launches `de.curviosclash.classic`.

The native project lives in `android-classic`; the shipped web bundle is
`dist/mobile-classic`. The app icon source is `tools/mobile-classic-app/assets/icon-source.png`.
The mobile menu also reads `mobile-classic.manifest.json` and offers a compact
GitHub release check. Set `CURVIOS_CLASSIC_APP_GITHUB_REPOSITORY` when building from a fork.
