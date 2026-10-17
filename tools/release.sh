#!/bin/sh
# Collect release artifacts into dist/release (Windows installer, Linux .deb, server bundle, VS Code extension). Android: tools/build-android.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/dist/release"
RUN="docker run --rm --user $(id -u):$(id -g) -e HOME=/work/temp/home -v $ROOT:/work -w /work/apps/desktop ergonotes-builder"
mkdir -p "$ROOT/temp/home"
$RUN sh -c 'cd /work && npm install --no-audit --no-fund >/dev/null && npm -w @ergonotes/app run build >/dev/null'
$RUN npx @tauri-apps/cli build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
cp "$ROOT"/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe "$ROOT/dist/release/Ergonotes-windows-x64-setup.exe"
$RUN npx @tauri-apps/cli build --bundles deb
cp "$ROOT"/apps/desktop/src-tauri/target/release/bundle/deb/*.deb "$ROOT/dist/release/Ergonotes-linux-amd64.deb"
"$ROOT/tools/bundle-server.sh"
$RUN sh -c 'cd /work && npm -w ergonotes-vscode run package >/dev/null'
cp "$ROOT/apps/vscode/ergonotes-vscode.vsix" "$ROOT/dist/release/ergonotes-vscode.vsix"
tar -C "$ROOT/dist/server" -czf "$ROOT/dist/release/ergonotes-server.tgz" .
( cd "$ROOT/dist/release" && sha256sum * > SHA256SUMS && cat SHA256SUMS )
