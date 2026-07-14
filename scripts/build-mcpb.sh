#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
OUTPUT="${1:-${ROOT}/artifacts/sap-abap-mcp-${VERSION}.mcpb}"
STAGE="$(mktemp -d)"

cleanup() {
  rm -rf "${STAGE}"
}
trap cleanup EXIT

mkdir -p "$(dirname "${OUTPUT}")" "${STAGE}/server/dist"

cd "${ROOT}"
npm run build

cp mcpb/manifest.json "${STAGE}/manifest.json"
cp mcpb/icon.png "${STAGE}/icon.png"
cp LICENSE README.md llms-install.md "${STAGE}/"
cp package.json package-lock.json "${STAGE}/server/"
cp -R dist/src "${STAGE}/server/dist/src"

cd "${STAGE}/server"
npm ci --omit=dev --ignore-scripts

cd "${ROOT}"
npx --yes @anthropic-ai/mcpb validate "${STAGE}/manifest.json"
npx --yes @anthropic-ai/mcpb pack "${STAGE}" "${OUTPUT}"
