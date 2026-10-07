# Building and installing

One web app (`app/`) runs everywhere:

| Platform | How | Output |
|---|---|---|
| Web / any browser | served by the sync server, installable as a PWA | `app/dist/` |
| Linux (CachyOS / Arch) | Tauri 2 native window (`desktop/`) | `tally-budget-*.pkg.tar.zst`, `.deb`, `.rpm`, AppImage |
| Android | Capacitor native app (`app/android/`) | `.apk` |
| Sync server | Node.js, no dependencies (`server/`) | `tally-server.tar.gz`, Docker image |

The easiest way to get everything is the **Release** GitHub Action
(*Actions → Release → Run workflow*, or push a tag like `v0.1.0`). It builds all
of the above and, for tags, attaches them to a GitHub release.

## Prerequisites (local builds)

* Node.js 20+ and npm
* Linux app: Rust (`rustup`), plus WebKitGTK 4.1 dev packages
  * Arch/CachyOS: `sudo pacman -S --needed rust webkit2gtk-4.1 base-devel`
  * Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf build-essential`
* Android: **JDK 21** (it can sit next to a newer default JDK) and the Android SDK — see [Android](#android)

## Web app

```bash
cd app
npm ci
npm run dev          # http://localhost:5173 (proxies /api to a local server on :8787)
npm run build        # → app/dist
npm run check        # type-check
npm test             # unit tests (vitest)
npm run test:e2e     # end-to-end tests (Playwright; builds must exist: npm run build)
```

For a full local setup, run the server in another terminal:
`node server/src/index.js serve` (it serves `app/dist` on http://localhost:8787).

## Linux — Arch / CachyOS package

```bash
cd packaging/arch
makepkg -si
```

This clones the repository, builds the web app and the Tauri binary, and
installs `tally` with a desktop entry and icons. To build a branch or your local
checkout instead of `main`:

```bash
TALLY_REF=branch=claude/nifty-edison-av2x0k makepkg -si
TALLY_GIT=file://$HOME/code/budgeting_tool TALLY_REF=branch=main makepkg -si
```

Uninstall with `sudo pacman -R tally-budget`. Data lives in
`~/.local/share/io.github.lukajakimovski.tally/`.

(`packaging/arch/PKGBUILD.server` packages the sync server for an Arch-based
server, if you ever move off the Pi.)

## Linux — other distros / development

```bash
cd desktop
npm ci
npm run build        # builds app/ then: .deb, .rpm, AppImage in desktop/src-tauri/target/release/bundle/
npm run dev          # native window on the Vite dev server, with hot reload
```

## Android

### One-time setup (Arch / CachyOS)

1. **JDK 21** — installed *alongside* whatever Java you use day to day:
   ```bash
   sudo pacman -S jdk21-openjdk
   ```
   You don't need to switch your default (`archlinux-java`). Newer JDKs
   (26, 27…) are too new for the Android build tools; the project tells Gradle
   to run on JDK 21 (`app/android/gradle/gradle-daemon-jvm.properties`) and
   finds it in `/usr/lib/jvm` automatically.
2. **Android SDK**, either:
   * **Android Studio** (`paru -S android-studio`): open it once and finish the
     setup wizard — it installs the SDK into `~/Android/Sdk`; or
   * **command-line tools only**: download *Command line tools only* from
     <https://developer.android.com/studio#command-line-tools-only>, then
     ```bash
     mkdir -p ~/Android/Sdk/cmdline-tools
     unzip commandlinetools-linux-*.zip -d ~/Android/Sdk/cmdline-tools
     mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest
     ~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --licenses
     ```
     Gradle downloads the platform and build tools it needs on the first build.

(Debian/Ubuntu: `sudo apt install openjdk-21-jdk`; Fedora: `sudo dnf install java-21-openjdk-devel`.)

### Build

```bash
app/android/build-apk.sh            # debug APK
app/android/build-apk.sh --install  # …and install it on a USB-connected phone (USB debugging on)
```

The script picks JDK 21 even if your default Java is newer, finds the SDK
(`$ANDROID_HOME`, `~/Android/Sdk` or `/opt/android-sdk`), accepts the SDK
licences, builds the web app, copies it into the Android project
(`cap sync`) and runs Gradle. The APK ends up in
`app/android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to your phone
and open it (allow "install unknown apps" for your file manager), or use
`adb install -r`.

The same steps by hand:

```bash
cd app && npm ci && npm run build && npx cap sync android
cd android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew assembleDebug
```

### Troubleshooting

| Error | Cause / fix |
|---|---|
| `Unsupported class file major version 69/70/71…` (or `BUG! exception in phase 'semantic analysis'`) | Gradle is running on a JDK that's too new (71 = Java 27). Install JDK 21 (above) or use `build-apk.sh`. |
| `Unable to download toolchain matching the requirements ({languageVersion=21 …})` | No JDK 21 installed — install it (above). |
| `SDK location not found` | Set `ANDROID_HOME` or create `app/android/local.properties` with `sdk.dir=/path/to/Sdk` (the script does this for you). |
| `Failed to install the following Android SDK packages … licences have not been accepted` | `~/Android/Sdk/cmdline-tools/latest/bin/sdkmanager --licenses` |
| Build can't write to `/opt/android-sdk` | That SDK (from the AUR) is owned by root; use `~/Android/Sdk` instead, or install the missing packages with `sudo sdkmanager …`. |

### Signed release builds (recommended for updates)

Android only lets an app update itself when every version is signed with the
same key. Debug builds from CI use a throwaway key each time, so for real use
create one key and keep it safe:

```bash
keytool -genkeypair -v -keystore tally.jks -alias tally -keyalg RSA -keysize 4096 -validity 10000
```

Local release build:

```bash
export TALLY_KEYSTORE=$PWD/tally.jks TALLY_KEYSTORE_PASSWORD=… TALLY_KEY_ALIAS=tally TALLY_KEY_PASSWORD=…
./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
```

For CI, add these repository secrets (*Settings → Secrets and variables →
Actions*): `ANDROID_KEYSTORE_BASE64` (`base64 -w0 tally.jks`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
The Release workflow then produces a signed `tally-<version>.apk`.

Never commit the keystore (`*.jks` is git-ignored). Losing it means
uninstalling and reinstalling the app for future versions (your data comes back
through sync or a backup).

## Icons

All icons are generated from `app/public/icon.svg`:

```bash
cd app && npm run icons                     # PWA, Android, ../desktop/src-tauri/icons/icon.png
npx tauri icon ../desktop/src-tauri/icons/icon.png -o ../desktop/src-tauri/icons   # desktop sizes
```

## Versioning a release

1. Bump the version in `app/package.json`, `server/package.json`,
   `desktop/package.json`, `desktop/src-tauri/Cargo.toml`,
   `desktop/src-tauri/tauri.conf.json` and `packaging/arch/PKGBUILD`.
2. Commit, then `git tag v0.2.0 && git push --tags`.
3. The Release workflow builds and publishes everything.

## Continuous integration

`.github/workflows/ci.yml` runs on every push: type-check, app unit tests,
server tests, production build and the Playwright end-to-end suite (phone and
desktop viewports, including two devices syncing through a real server).
