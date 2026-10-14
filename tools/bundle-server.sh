#!/bin/sh
# Bundle the server peer into one file: dist/server/server.mjs (+ the web build in dist/server/web).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/dist/server"
"$ROOT/tools/n" npx esbuild apps/server/src/main.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/server/server.mjs \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" --log-level=warning
rm -rf "$ROOT/dist/server/web" && cp -r "$ROOT/packages/app/dist" "$ROOT/dist/server/web"
echo "bundled: $(du -sh "$ROOT/dist/server" | cut -f1)"
