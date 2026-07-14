import assert from "node:assert/strict"
import test from "node:test"
import { AppError } from "../src/errors.js"
import {
  normalizeCapabilityError,
  SapCapabilityRegistry,
  type SapCapabilityRecord
} from "../src/sap-capabilities.js"

function capability(
  registry: SapCapabilityRegistry,
  connectionId: string,
  capabilityId: string,
  category?: SapCapabilityRecord["category"]
): SapCapabilityRecord {
  const record = registry
    .list(connectionId, "", category)
    .find((candidate: SapCapabilityRecord) => candidate.id === capabilityId)
  assert.ok(record)
  return record
}

test("capabilities separate implementation, system, authorization, and overall status", () => {
  const registry = new SapCapabilityRegistry()
  const capabilityId = "repository.create.bdef"

  assert.deepEqual(capability(registry, "DEV100", capabilityId, "repository"), {
    id: capabilityId,
    category: "repository",
    implementation: "implemented",
    system: "unknown",
    authorization: "unknown",
    status: "unverified",
    evidence: [],
    lastObservedAt: null
  })

  registry.observeAdvertised("DEV100", capabilityId, "bo/behaviordefinitions")
  const advertised = capability(registry, "DEV100", capabilityId, "repository")
  assert.equal(advertised.system, "advertised")
  assert.equal(advertised.status, "unverified")

  registry.observeSuccess("DEV100", capabilityId, "create")
  const supported = capability(registry, "DEV100", capabilityId, "repository")
  assert.equal(supported.status, "supported")
  assert.equal(supported.authorization, "allowed")

  registry.observeHttpFailure(
    "QAS200",
    capabilityId,
    404,
    "bo/behaviordefinitions"
  )
  assert.equal(
    capability(registry, "QAS200", capabilityId, "repository").status,
    "unsupported"
  )
  assert.equal(
    capability(registry, "DEV100", capabilityId, "repository").status,
    "supported"
  )
})

test("missing backlog capabilities never claim support", () => {
  const registry = new SapCapabilityRegistry()
  const record = capability(registry, "DEV100", "quality.abap_cleaner", "quality")

  assert.equal(record.implementation, "missing")
  assert.equal(record.status, "unsupported")
})

test("capability IDs are normalized without changing canonical record IDs", () => {
  const registry = new SapCapabilityRegistry()

  registry.observeSuccess(
    "  dev100  ",
    "  REPOSITORY.CREATE.BDEF  ",
    "create"
  )

  const record = capability(registry, "DEV100", "repository.create.bdef", "repository")
  assert.equal(record.id, "repository.create.bdef")
  assert.equal(record.status, "supported")
  assert.equal(
    registry.status("dev100", "  Repository.Create.Bdef  "),
    "supported"
  )
})

test("success recovers capabilities after 404 and 405 observations", () => {
  for (const httpStatus of [404, 405]) {
    const registry = new SapCapabilityRegistry()
    const capabilityId = "repository.create.bdef"

    registry.observeHttpFailure("DEV100", capabilityId, httpStatus, "/bdef")
    assert.equal(registry.status("DEV100", capabilityId), "unsupported")

    registry.observeSuccess("DEV100", capabilityId, "create")
    const recovered = capability(registry, "DEV100", capabilityId, "repository")
    assert.equal(recovered.system, "unknown")
    assert.equal(recovered.authorization, "allowed")
    assert.equal(recovered.status, "supported")
  }
})

test("unknown capability observation IDs are rejected consistently", () => {
  const registry = new SapCapabilityRegistry()
  const capabilityId = "  Unknown.Capability  "
  const observations = [
    () => registry.observeAdvertised("DEV100", capabilityId, "discovery"),
    () => registry.observeSuccess("DEV100", capabilityId, "success"),
    () => registry.observeHttpFailure("DEV100", capabilityId, 404, "/unknown"),
    () => registry.observeFailure("DEV100", capabilityId, new Error("failure"), "/unknown")
  ]

  for (const observe of observations) {
    assert.throws(
      observe,
      error => error instanceof AppError && error.code === "SAP_CAPABILITY_UNAVAILABLE"
    )
  }
})

test("discovery matching is case-insensitive and absence remains unknown", () => {
  const registry = new SapCapabilityRegistry()
  const records = registry.list(
    "DEV100",
    "<service href=\"/SAP/BC/ADT/ACTIVATION\" />",
    "repository"
  )
  const activation = records.find(record => record.id === "repository.activate.batch")
  const bdef = records.find(record => record.id === "repository.create.bdef")

  assert.ok(activation)
  assert.equal(activation.system, "advertised")
  assert.deepEqual(activation.evidence, ["discovery:/sap/bc/adt/activation"])
  assert.ok(bdef)
  assert.equal(bdef.system, "unknown")
})

test("evidence is newest-20 unique, defensively copied, and UTF-8 byte bounded", () => {
  const registry = new SapCapabilityRegistry()
  const capabilityId = "execution.abap_repl"
  for (let index = 0; index <= 20; index += 1) {
    registry.observeSuccess("DEV100", capabilityId, `entry-${index}`)
  }
  registry.observeSuccess("DEV100", capabilityId, "entry-5")

  const record = capability(registry, "DEV100", capabilityId, "execution")
  assert.equal(record.evidence.length, 20)
  assert.equal(record.evidence[0], "success:entry-1")
  assert.equal(record.evidence.at(-1), "success:entry-5")
  assert.equal(record.evidence.filter(value => value === "success:entry-5").length, 1)

  record.evidence.push("external-mutation")
  assert.equal(
    capability(registry, "DEV100", capabilityId, "execution")
      .evidence.includes("external-mutation"),
    false
  )

  registry.observeSuccess("DEV100", capabilityId, "🙂".repeat(300))
  const bounded = capability(registry, "DEV100", capabilityId, "execution").evidence.at(-1)
  assert.ok(bounded)
  assert.ok(Buffer.byteLength(bounded, "utf8") <= 512)
  assert.equal(bounded.endsWith("[TRUNCATED]"), true)
  assert.equal(bounded.includes("�"), false)
})

test("capability failures map HTTP, validation, and operation errors", () => {
  const endpoint = "/sap/bc/adt/docu/abap/langu"
  const cases = [
    {
      error: Object.assign(new Error("unauthorized"), { response: { status: 401 } }),
      code: "SAP_AUTHORIZATION_DENIED",
      httpStatus: 401
    },
    {
      error: Object.assign(new Error("forbidden"), { status: 403 }),
      code: "SAP_AUTHORIZATION_DENIED",
      httpStatus: 403
    },
    {
      error: Object.assign(new Error("missing"), { response: { status: 404 } }),
      code: "SAP_CAPABILITY_UNAVAILABLE",
      httpStatus: 404
    },
    {
      error: Object.assign(new Error("method"), { status: 405 }),
      code: "SAP_CAPABILITY_UNAVAILABLE",
      httpStatus: 405
    },
    {
      error: new Error("invalid result"),
      code: "SAP_VALIDATION_FAILED",
      validationFailure: true
    },
    {
      error: new Error("network failure"),
      code: "SAP_OPERATION_FAILED"
    }
  ]

  for (const entry of cases) {
    const normalized = normalizeCapabilityError(
      entry.error,
      "semantic.documentation",
      endpoint,
      entry.validationFailure
    )

    assert.ok(normalized instanceof AppError)
    assert.equal(normalized.code, entry.code)
    assert.equal(normalized.details?.capabilityId, "semantic.documentation")
    assert.equal(normalized.details?.endpoint, endpoint)
    assert.equal(normalized.details?.httpStatus, entry.httpStatus)
    if (entry.httpStatus === undefined) {
      assert.equal("httpStatus" in (normalized.details ?? {}), false)
    }
  }
})

test("capability errors redact structured secrets without swallowing diagnostics", () => {
  const cases = [
    { message: '{"token":"json-secret"} diagnostic-json', secret: "json-secret" },
    {
      message: '"Authorization": "Bearer quoted-secret" diagnostic-auth',
      secret: "quoted-secret"
    },
    {
      message: "access_token=query-secret diagnostic-access",
      secret: "query-secret"
    },
    {
      message: "refresh_token=refresh-secret diagnostic-refresh",
      secret: "refresh-secret"
    },
    {
      message: "csrf-token=csrf-hyphen-secret diagnostic-csrf-hyphen",
      secret: "csrf-hyphen-secret"
    },
    {
      message: "csrf_token=csrf-underscore-secret diagnostic-csrf-underscore",
      secret: "csrf-underscore-secret"
    },
    {
      message: "session_id=session-secret diagnostic-session",
      secret: "session-secret"
    },
    {
      message: "password=plain-secret diagnostic-password",
      secret: "plain-secret"
    },
    {
      message: "authorization=Bearer authorization-secret diagnostic-authorization",
      secret: "authorization-secret"
    },
    {
      message: "token=token-secret diagnostic-token",
      secret: "token-secret"
    },
    {
      message: "cookie=cookie-secret diagnostic-cookie",
      secret: "cookie-secret"
    },
    {
      message: "csrf=csrf-secret diagnostic-csrf",
      secret: "csrf-secret"
    },
    {
      message: "session=session-value diagnostic-session-label",
      secret: "session-value"
    }
  ]

  for (const entry of cases) {
    const diagnostic = entry.message.split(" ").at(-1)
    const normalized = normalizeCapabilityError(
      new Error(entry.message),
      "semantic.documentation",
      "/sap/bc/adt/docu/abap/langu"
    )

    assert.equal(normalized.message.includes(entry.secret), false)
    assert.ok(diagnostic)
    assert.equal(normalized.message.includes(diagnostic), true)
  }
})

test("capability errors redact complete sensitive header values", () => {
  const cases = [
    {
      message: "X-CSRF-Token: csrf-header-secret\ncsrf-header-kept",
      sensitive: ["csrf-header-secret"],
      preserved: "csrf-header-kept"
    },
    {
      message: "Set-Cookie: SAP_SESSIONID_...=cookie-secret; Path=/; HttpOnly\nset-cookie-kept",
      sensitive: ["cookie-secret", "Path=/", "HttpOnly"],
      preserved: "set-cookie-kept"
    },
    {
      message: "Authorization: Basic <credentials>\nauthorization-header-kept",
      sensitive: ["Basic", "<credentials>"],
      preserved: "authorization-header-kept"
    },
    {
      message: "Cookie: first=one; second=two\ncookie-header-kept",
      sensitive: ["first=one", "second=two"],
      preserved: "cookie-header-kept"
    }
  ]

  for (const entry of cases) {
    const normalized = normalizeCapabilityError(
      new Error(entry.message),
      "semantic.documentation",
      "/sap/bc/adt/docu/abap/langu"
    )

    for (const sensitive of entry.sensitive) {
      assert.equal(normalized.message.includes(sensitive), false)
    }
    assert.equal(normalized.message.includes(entry.preserved), true)
  }
})

test("capability errors redact quoted JSON header labels", () => {
  const cases = [
    {
      message: '{"X-CSRF-Token":"quoted-csrf-secret"}',
      secret: "quoted-csrf-secret"
    },
    {
      message: '{"Set-Cookie":"SID=quoted-cookie-secret; Path=/"}',
      secret: "quoted-cookie-secret"
    }
  ]

  for (const entry of cases) {
    const normalized = normalizeCapabilityError(
      new Error(entry.message),
      "semantic.documentation",
      "/sap/bc/adt/docu/abap/langu"
    )
    assert.equal(normalized.message.includes(entry.secret), false)
  }

  const withUnrelatedField = normalizeCapabilityError(
    new Error('{"X-CSRF-Token":"secret","message":"json-field-kept"}'),
    "semantic.documentation",
    "/sap/bc/adt/docu/abap/langu"
  )
  assert.equal(withUnrelatedField.message.includes('"message":"json-field-kept"'), true)
})

test("capability endpoints and evidence redact sensitive query values", () => {
  const capabilityId = "semantic.documentation"
  const normalized = normalizeCapabilityError(
    new Error("failed"),
    capabilityId,
    "/sap/bc/adt/docu/abap/langu?token=endpoint-secret&format=html"
  )
  assert.equal(
    normalized.details?.endpoint,
    "/sap/bc/adt/docu/abap/langu?token=[REDACTED]&format=html"
  )

  const registry = new SapCapabilityRegistry()
  registry.observeAdvertised(
    "DEV100",
    capabilityId,
    "docu/abap/langu?token=advertised-secret&format=html"
  )
  registry.observeSuccess(
    "DEV100",
    capabilityId,
    "create access_token=success-secret diagnostic-success"
  )
  registry.observeHttpFailure(
    "DEV100",
    capabilityId,
    403,
    "/doc?refresh_token=http-secret&format=html"
  )
  registry.observeFailure(
    "DEV100",
    capabilityId,
    new Error("network"),
    "/doc?session_id=failure-secret&format=html"
  )

  const evidence = capability(registry, "DEV100", capabilityId, "semantic").evidence
  const serialized = evidence.join("\n")
  for (const secret of [
    "advertised-secret",
    "success-secret",
    "http-secret",
    "failure-secret"
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.equal(serialized.includes("diagnostic-success"), true)
})
