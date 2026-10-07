#!/usr/bin/env bash
# Build the Tally Android app (APK) on Linux.
#
#   ./build-apk.sh             debug APK (installs on your own phone)
#   ./build-apk.sh release     signed release APK (needs TALLY_KEYSTORE… env vars, see docs/building.md)
#   ./build-apk.sh --install   …and install it on a phone connected with USB debugging (adb)
#
# It finds JDK 21 even if your default Java is newer, finds the Android SDK,
# builds the web app, copies it into the Android project and runs Gradle.
set -euo pipefail
cd "$(dirname "$0")"

MODE=debug
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    release) MODE=release ;;
    debug) MODE=debug ;;
    --install) INSTALL=1 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[31m%s\033[0m\n' "$1" >&2
  shift
  for line in "$@"; do printf '%s\n' "$line" >&2; done
  exit 1
}

# --- JDK 21 ------------------------------------------------------------------
java_major() { "$1/bin/java" -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/ {print $2; exit}'; }
find_jdk21() {
  local d
  for d in "${JAVA_HOME:-}" /usr/lib/jvm/java-21-openjdk /usr/lib/jvm/java-21-openjdk-* /usr/lib/jvm/jdk-21* \
           /usr/lib/jvm/temurin-21* /usr/lib/jvm/zulu-21* "$HOME"/.sdkman/candidates/java/21* "$HOME"/.jdks/*21*; do
    if [ -n "$d" ] && [ -x "$d/bin/java" ] && [ "$(java_major "$d")" = "21" ]; then echo "$d"; return 0; fi
  done
  return 1
}
if JDK=$(find_jdk21); then
  export JAVA_HOME="$JDK"
  say "Using JDK 21 at $JAVA_HOME"
else
  current=$(java -version 2>&1 | grep -m1 -i 'version' || echo "none")
  fail "The Android build needs JDK 21 (your default Java is: $current)." \
       "Install it next to your current JDK — you don't have to change your default:" \
       "  Arch / CachyOS:  sudo pacman -S jdk21-openjdk" \
       "  Debian / Ubuntu: sudo apt install openjdk-21-jdk" \
       "  Fedora:          sudo dnf install java-21-openjdk-devel" \
       "Then run this script again."
fi

# --- Android SDK -------------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -f local.properties ]; then SDK=$(sed -n 's/^sdk\.dir=//p' local.properties); fi
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  for d in "$HOME/Android/Sdk" "$HOME/Android/sdk" "$HOME/android-sdk" /opt/android-sdk; do
    if [ -d "$d" ]; then SDK="$d"; break; fi
  done
fi
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  fail "No Android SDK found (looked at \$ANDROID_HOME, local.properties, ~/Android/Sdk, /opt/android-sdk)." \
       "Easiest: install Android Studio (Arch/CachyOS: paru -S android-studio), open it once and let it" \
       "download the SDK to ~/Android/Sdk. Command-line only: see docs/building.md → Android."
fi
export ANDROID_HOME="$SDK"
echo "sdk.dir=$SDK" > local.properties
say "Using Android SDK at $SDK"
if [ ! -w "$SDK" ]; then
  echo "Note: $SDK isn't writable by you, so Gradle can't download missing SDK parts itself."
  echo "      If the build complains about a missing platform/build-tools, install them with sdkmanager (or use ~/Android/Sdk)."
fi

if [ ! -f "$SDK/licenses/android-sdk-license" ]; then
  SDKMANAGER=""
  for s in "$SDK"/cmdline-tools/latest/bin/sdkmanager "$SDK"/cmdline-tools/*/bin/sdkmanager "$(command -v sdkmanager || true)"; do
    if [ -n "$s" ] && [ -x "$s" ]; then SDKMANAGER="$s"; break; fi
  done
  if [ -n "$SDKMANAGER" ]; then
    say "Accepting Android SDK licences…"
    yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null || true
  else
    fail "The Android SDK licences haven't been accepted and sdkmanager wasn't found." \
         "Install the 'Android SDK Command-line Tools' (Android Studio → SDK Manager → SDK Tools), then run:" \
         "  $SDK/cmdline-tools/latest/bin/sdkmanager --licenses"
  fi
fi

# --- Web app → Android project -----------------------------------------------
say "Building the web app…"
( cd .. && { [ -d node_modules ] || npm ci; } && npm run build && npx cap sync android )

# --- Gradle ------------------------------------------------------------------
if [ "$MODE" = release ]; then
  [ -n "${TALLY_KEYSTORE:-}" ] || fail "Release builds need TALLY_KEYSTORE, TALLY_KEYSTORE_PASSWORD, TALLY_KEY_ALIAS and TALLY_KEY_PASSWORD (docs/building.md)."
  say "Building the release APK…"
  ./gradlew assembleRelease
  APK=app/build/outputs/apk/release/app-release.apk
else
  say "Building the debug APK…"
  ./gradlew assembleDebug
  APK=app/build/outputs/apk/debug/app-debug.apk
fi

say "Done: $(pwd)/$APK"
if [ "$INSTALL" = 1 ]; then
  ADB="$(command -v adb || echo "$SDK/platform-tools/adb")"
  [ -x "$ADB" ] || fail "adb not found (install 'Android SDK Platform-Tools')."
  "$ADB" install -r "$APK"
else
  echo "Install: copy it to your phone and open it, or run: adb install -r $APK"
fi
