import type { SapProfile } from "./profile-store.js"

/** Configuration inspection only: never calls SAP or returns service credentials. */
export function btpConfigurationDiagnostics(
  profile: Extract<SapProfile, { authType: "btp_destination" }>,
  vcapServices: string | undefined
) {
  const required = profile.destinationAuthentication === "PrincipalPropagation"
    ? ["destination", "xsuaa", "connectivity"] : ["destination", "xsuaa"]
  let bindings: Array<{ label?: unknown }> = []
  let readable = true
  try {
    const parsed: unknown = JSON.parse(vcapServices ?? "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error()
    for (const group of Object.values(parsed)) {
      if (!Array.isArray(group) || group.some(binding => !binding || typeof binding !== "object")) throw new Error()
      bindings.push(...group)
    }
  } catch {
    readable = false
    bindings = []
  }
  const checks = required.map(service => {
    const count = bindings.filter(binding => binding.label === service).length
    return { service, count, status: !readable ? "invalid_configuration" : count === 0 ? "missing" : count === 1 ? "found" : "multiple" }
  })
  return {
    ok: false,
    scope: "local_configuration_only",
    profileId: profile.id,
    connectionVerified: false,
    credentialSource: "http_oidc",
    localCredentialRequired: false,
    bindingSource: "VCAP_SERVICES",
    checks,
    nextAction: checks.some(check => check.status !== "found")
      ? "Check the VCAP_SERVICES binding results in the HTTP server environment, then connect through an OIDC-authenticated MCP session. Alternative binding sources are not inspected here."
      : "Initialize an OIDC-authenticated MCP session and run sap.system.inspect to verify this profile against SAP. Local binding presence alone does not verify credentials or connectivity."
  }
}
