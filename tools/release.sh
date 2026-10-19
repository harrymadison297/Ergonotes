#!/bin/sh
# Collect release artifacts into dist/release (Windows installer and portable zip, Linux .deb and AppImage, server bundle, VS Code extension). Android: tools/build-android.sh
# The file names are the ones the website links to (apps/site/src/data.tsx): keep them.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/dist/release"
RUN="docker run --rm --user $(id -u):$(id -g) -e HOME=/work/temp/home -v $ROOT:/work -w /work/apps/desktop ergonotes-builder"
mkdir -p "$ROOT/temp/home"
$RUN sh -c 'cd /work && npm install --no-audit --no-fund >/dev/null && npm -w @ergonotes/app run build >/dev/null'
$RUN npx @tauri-apps/cli build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
cp "$ROOT"/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe "$ROOT/dist/release/Ergonotes-windows-x64-setup.exe"
# Windows portable: the executable the installer carries, in a zip. It needs the WebView2 runtime (part of Windows 11).
PORT="$ROOT/temp/portable"
rm -rf "$PORT" && mkdir -p "$PORT"
cp "$ROOT/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/ergonotes.exe" "$PORT/Ergonotes.exe"
# the speech engine's C++ runtime (the installer puts the same files beside the exe, via tauri.windows.conf.json)
cp "$ROOT"/apps/desktop/src-tauri/vcruntime/*.dll "$PORT/"
printf 'Ergonotes, portable.\r\n\r\nRun Ergonotes.exe from any folder; nothing is installed. Your notes are Markdown files in Documents\\Ergonotes.\r\nIt needs the Microsoft Edge WebView2 runtime, which Windows 11 includes and Windows 10 gets from https://developer.microsoft.com/microsoft-edge/webview2/\r\n' > "$PORT/README.txt"
rm -f "$ROOT/dist/release/Ergonotes-windows-x64-portable.zip"
$RUN sh -c 'cd /work/temp/portable && zip -q -9 /work/dist/release/Ergonotes-windows-x64-portable.zip Ergonotes.exe *.dll README.txt'
$RUN npx @tauri-apps/cli build --bundles deb
cp "$ROOT"/apps/desktop/src-tauri/target/release/bundle/deb/*.deb "$ROOT/dist/release/Ergonotes-linux-amd64.deb"
# Linux AppImage (portable): the tools it is made with run without FUSE in the container
docker run --rm --user $(id -u):$(id -g) -e HOME=/work/temp/home -e APPIMAGE_EXTRACT_AND_RUN=1 -e NO_STRIP=1 -v "$ROOT":/work -w /work/apps/desktop ergonotes-builder npx @tauri-apps/cli build --bundles appimage
cp "$ROOT"/apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage "$ROOT/dist/release/Ergonotes-linux-x86_64.AppImage"
"$ROOT/tools/bundle-server.sh"
$RUN sh -c 'cd /work && npm -w ergonotes-vscode run package >/dev/null'
cp "$ROOT/apps/vscode/ergonotes-vscode.vsix" "$ROOT/dist/release/ergonotes-vscode.vsix"
tar -C "$ROOT/dist/server" -czf "$ROOT/dist/release/ergonotes-server.tgz" .
( cd "$ROOT/dist/release" && sha256sum * > SHA256SUMS && cat SHA256SUMS )
