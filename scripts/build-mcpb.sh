#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
OUTPUT="${1:-${ROOT}/artifacts/sap-abap-mcp-${VERSION}.mcpb}"
STAGE="$(mktemp -d)"
MAX_BUNDLE_BYTES=25000000

cleanup() {
  rm -rf "${STAGE}"
}
trap cleanup EXIT

mkdir -p "$(dirname "${OUTPUT}")" "${STAGE}/server"

cd "${ROOT}"
npm run build

cp mcpb/manifest.json "${STAGE}/manifest.json"
cp mcpb/icon.png "${STAGE}/icon.png"
cp LICENSE README.md llms-install.md "${STAGE}/"
npx --yes esbuild@0.27.2 dist/src/index.js \
  --bundle \
  --minify \
  --platform=node \
  --format=esm \
  --target=node20 \
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="${STAGE}/server/index.mjs"

cd "${ROOT}"
npx --yes @anthropic-ai/mcpb validate "${STAGE}/manifest.json"
npx --yes @anthropic-ai/mcpb pack "${STAGE}" "${OUTPUT}"

BUNDLE_BYTES="$(wc -c < "${OUTPUT}" | tr -d ' ')"
if (( BUNDLE_BYTES > MAX_BUNDLE_BYTES )); then
  echo "MCPB bundle exceeds Smithery's 25 MB limit: ${BUNDLE_BYTES} bytes" >&2
  exit 1
fi
