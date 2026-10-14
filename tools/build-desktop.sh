#!/bin/sh
# Build desktop installers inside the builder image. Usage: tools/build-desktop.sh windows|linux
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-linux}"
RUN="docker run --rm --user $(id -u):$(id -g) -e HOME=/work/temp/home -v $ROOT:/work -w /work/apps/desktop ergonotes-builder"
mkdir -p "$ROOT/temp/home"
$RUN sh -c 'cd /work && npm install --no-audit --no-fund && npm -w @ergonotes/app run build'
$RUN sh -c 'npx @tauri-apps/cli icon src-tauri/icon-source.svg -o src-tauri/icons'
case "$TARGET" in
  windows) $RUN npx @tauri-apps/cli build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis ;;
  linux)   $RUN npx @tauri-apps/cli build --bundles deb ;;
esac
