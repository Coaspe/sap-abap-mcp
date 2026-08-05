# Central-deployment image for SAP ABAP MCP over Streamable HTTP.
#
# The image never contains SAP credentials or API keys. Mount the API key file
# and supply SAP profile secrets through profile-specific environment variables
# at run time; the Linux secret store is read-only by design.
FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist/src ./dist/src
COPY package.json README.md LICENSE PRIVACY.md TERMS.md ./
COPY spec ./spec

# 0.0.0.0 is required so the container port is reachable; restrict exposure with
# the container network, a reverse proxy, and --allowed-host.
ENV SAP_ABAP_MCP_AUDIT_LOG=stderr
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "dist/src/index.js"]
CMD ["serve", "--http", "--host", "0.0.0.0", "--port", "3000", \
     "--api-keys-file", "/run/secrets/sap-abap-mcp-api-keys.json"]
