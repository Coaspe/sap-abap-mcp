#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
VERSION="$(node -p "require('./package.json').version")"
OUTPUT="${1:-${ROOT}/artifacts/sap-abap-mcp-${VERSION}.mcpb}"
STAGE="$(mktemp -d)"
MAX_BUNDLE_BYTES=25000000

cleanup() {
  rm -rf "${STAGE}"
}
trap cleanup EXIT

mkdir -p "$(dirname "${OUTPUT}")" "${STAGE}/dist/src" "${STAGE}/assets"

cd "${ROOT}"
npm run build
node scripts/sync-mcpb-tools.mjs --check

cp mcpb/manifest.json "${STAGE}/manifest.json"
cp mcpb/icon.png "${STAGE}/icon.png"
cp package.json LICENSE PRIVACY.md README.md TERMS.md llms-install.md "${STAGE}/"
cp docs/desktop-bundle-setup.md "${STAGE}/desktop-setup.md"
cp assets/mermaid.min.js "${STAGE}/assets/mermaid.min.js"
npx --yes esbuild@0.27.2 dist/src/index.js \
  --bundle \
  --minify \
  --platform=node \
  --format=esm \
  --target=node20 \
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="${STAGE}/dist/src/index.js"

cd "${ROOT}"
node scripts/check-mcpb-runtime.mjs "${STAGE}"
npx --yes @anthropic-ai/mcpb@2.1.2 validate "${STAGE}/manifest.json"
npx --yes @anthropic-ai/mcpb@2.1.2 pack "${STAGE}" "${OUTPUT}"

BUNDLE_BYTES="$(wc -c < "${OUTPUT}" | tr -d ' ')"
if (( BUNDLE_BYTES > MAX_BUNDLE_BYTES )); then
  echo "MCPB bundle exceeds Smithery's 25 MB limit: ${BUNDLE_BYTES} bytes" >&2
  exit 1
fi
