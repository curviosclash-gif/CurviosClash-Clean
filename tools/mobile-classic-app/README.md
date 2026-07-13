# Curvios Clash Mobile

Capacitor wrapper for the phone-first Android game build. Classic and
Arcade-Parcours ship together in this one app; the separate Map Tools Android
wrapper stays independent.

Build the web bundle from the repository root:

```bash
npm run app:android:build
npm run app:classic:android:build
```

Create the Android project once:

```bash
npm run app:android:add
npm run app:classic:android:add
```

After that, sync or open the native project:

```bash
npm run app:android:sync
npm run app:android:open
npm run app:classic:android:sync
npm run app:classic:android:open
```

Refresh and check that the Android public assets match the latest
`dist/mobile-classic` bundle:

```bash
npm run app:android:assets:check
npm run app:classic:android:assets:check
```

Build and install a debug APK on the connected Android device:

```bash
npm run app:android:install
npm run app:classic:android:install
```

Update the connected phone from the configured GitHub remote:

```bash
npm run app:classic:android:update:github
```

The updater accepts `--remote <name>` and `--branch <name>`. It only fast-forwards
from a GitHub remote and refuses to pull when the working tree has uncommitted
changes, then rebuilds, installs, and launches `de.curviosclash.classic`.

The native project lives in `android-classic`; the shipped web bundle is
`dist/mobile-classic`. The app icon source is `tools/mobile-classic-app/assets/icon-source.png`.
The mobile menu also reads `mobile-classic.manifest.json`, exposes Classic plus
the curated Arcade-Parcours route pool, and offers a compact GitHub release
check. Set `CURVIOS_CLASSIC_APP_GITHUB_REPOSITORY` when building from a fork.
