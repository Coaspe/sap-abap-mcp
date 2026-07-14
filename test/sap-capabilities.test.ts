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

test("capability failures normalize authorization and redact secrets", () => {
  const error = Object.assign(new Error("token=secret-value"), {
    response: { status: 403 }
  })

  const normalized = normalizeCapabilityError(
    error,
    "semantic.documentation",
    "/sap/bc/adt/docu/abap/langu"
  )

  assert.ok(normalized instanceof AppError)
  assert.equal(normalized.code, "SAP_AUTHORIZATION_DENIED")
  assert.equal(normalized.details?.httpStatus, 403)
  assert.equal(normalized.message.includes("secret-value"), false)
})
