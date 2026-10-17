#!/bin/sh
# The VS Code extension in a real VS Code, headless: builds it, downloads VS Code once (into temp/vscode-e2e) and runs apps/vscode/e2e/suite.cjs.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
( cd "$ROOT/apps/vscode" && node esbuild.mjs )
mkdir -p "$ROOT/temp/vscode-e2e"
echo '{"name":"vscode-e2e","private":true}' > "$ROOT/temp/vscode-e2e/package.json"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e DISPLAY=:99 -v "$ROOT":/repo -w /repo/temp/vscode-e2e mcr.microsoft.com/playwright:v1.55.0-noble bash -c \
  'npm i --no-audit --no-fund @vscode/test-electron >/dev/null 2>&1; (Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &); sleep 2; NODE_PATH=/repo/temp/vscode-e2e/node_modules timeout 600 node /repo/apps/vscode/e2e/run.cjs'
