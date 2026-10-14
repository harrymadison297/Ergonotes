#!/bin/sh
# Build a signed release APK (arm64 + x86_64) inside the builder image.
# Signing key: KEYSTORE=/path/to/your.jks KEYSTORE_PASS=... KEY_ALIAS=... ; if unset a throw-away key is generated
# under temp/ (fine for sideloading and testing; publish with your own key).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/temp/home" "$ROOT/dist/release"
KS="${KEYSTORE:-/work/temp/ergonotes-dev.jks}"; PASS="${KEYSTORE_PASS:-ergonotes-dev}"; ALIAS="${KEY_ALIAS:-ergonotes}"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/work/temp/home -e _JAVA_OPTIONS=-Duser.home=/work/temp/home \
  -e ANDROID_USER_HOME=/work/temp/home/.android -e CARGO_TARGET_DIR=/work/temp/target-android \
  -v "$ROOT":/work -w /work ergonotes-builder sh -c "
    set -e
    npm install --no-audit --no-fund >/dev/null && npm -w @ergonotes/app run build >/dev/null
    cd apps/desktop
    [ -f src-tauri/icons/icon.png ] || npx @tauri-apps/cli icon src-tauri/icon-source.svg -o src-tauri/icons
    [ -d src-tauri/gen/android ] || npx @tauri-apps/cli android init --ci
    npx @tauri-apps/cli android build --apk --target aarch64 x86_64
    APK=\$(find src-tauri/gen/android/app/build/outputs/apk -name '*release-unsigned.apk' | head -1)
    BT=/opt/android-sdk/build-tools/34.0.0
    [ -f $KS ] || keytool -genkeypair -v -keystore $KS -storepass $PASS -keypass $PASS -alias $ALIAS -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Ergonotes dev'
    \$BT/zipalign -f -p 4 \$APK /work/temp/aligned.apk
    \$BT/apksigner sign --ks $KS --ks-pass pass:$PASS --key-pass pass:$PASS --ks-key-alias $ALIAS --out /work/dist/release/Ergonotes-android.apk /work/temp/aligned.apk
    \$BT/apksigner verify --print-certs /work/dist/release/Ergonotes-android.apk | head -3
  "
ls -la "$ROOT/dist/release/Ergonotes-android.apk"
