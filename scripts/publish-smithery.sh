#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${ROOT}/package.json').version")"
BUNDLE="${1:-${ROOT}/artifacts/sap-abap-mcp-${VERSION}.mcpb}"
QUALIFIED_NAME="${SMITHERY_SERVER_NAME:-aspalt85/sap-abap-mcp}"
NAMESPACE="${QUALIFIED_NAME%%/*}"
QUALIFIED_PATH="${QUALIFIED_NAME/\//%2F}"

if [[ "${NAMESPACE}" == "${QUALIFIED_NAME}" ]]; then
  echo "SMITHERY_SERVER_NAME must use namespace/server format" >&2
  exit 1
fi

cd "${ROOT}"
npm run build:mcpb

POLICY="$(jq -cn --arg namespace "${NAMESPACE}" \
  '{resources:"servers",operations:["read","write"],namespaces:$namespace,ttl:"5m"}')"
TOKEN="$(npx --yes smithery@latest auth token --policy "${POLICY}" | head -n 1 | jq -er '.token')"
PAYLOAD="$(node scripts/sync-mcpb-tools.mjs --smithery-payload)"
METADATA="$(jq -c \
  --arg iconUrl "https://raw.githubusercontent.com/Coaspe/sap-abap-mcp/main/assets/directory-icon.png" \
  --arg backlinkUrl "https://github.com/Coaspe/sap-abap-mcp/blob/main/docs/mcp-directory-submissions.md" \
  '{displayName:.display_name,description:.long_description,homepage:.homepage,repositoryUrl:(.repository.url | sub("\\.git$"; "")),license:.license,iconUrl:$iconUrl,backlinkUrl:$backlinkUrl,unlisted:false}' \
  mcpb/manifest.json)"

curl --fail-with-body -sS -X PATCH \
  "https://api.smithery.ai/servers/${QUALIFIED_PATH}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "${METADATA}" >/dev/null

curl --fail-with-body -sS -X PUT \
  "https://api.smithery.ai/servers/${QUALIFIED_PATH}/releases" \
  -H "Authorization: Bearer ${TOKEN}" \
  --form-string "payload=${PAYLOAD}" \
  -F "bundle=@${BUNDLE};type=application/octet-stream" \
  | jq '{deploymentId,status,mcpUrl,warnings}'
