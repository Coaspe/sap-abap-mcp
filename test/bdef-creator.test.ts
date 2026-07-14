import assert from "node:assert/strict"
import test from "node:test"
import {
  CreatableTypes,
  isCreatableTypeId,
  type CreatableType
} from "abap-adt-api"
import { BDEF_TYPE_ID, registerBdefType } from "../src/bdef-creator.js"
import {
  AbapToolService,
  type ConnectionProvider
} from "../src/tool-service.js"

const expectedBdefType: CreatableType = {
  creationPath: "bo/behaviordefinitions",
  validationPath: "bo/behaviordefinitions/validation",
  rootName: "blue:blueSource",
  nameSpace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
  label: "Behavior Definition",
  typeId: BDEF_TYPE_ID,
  maxLen: 30
}

test("BDEF registration matches ABAP FS and is idempotent", t => {
  const existing = CreatableTypes.get(BDEF_TYPE_ID)
  t.after(() => {
    if (existing) CreatableTypes.set(BDEF_TYPE_ID, existing)
    else CreatableTypes.delete(BDEF_TYPE_ID)
  })

  CreatableTypes.delete(BDEF_TYPE_ID)
  registerBdefType()
  registerBdefType()

  assert.equal(isCreatableTypeId(BDEF_TYPE_ID), true)
  assert.deepEqual(CreatableTypes.get(BDEF_TYPE_ID), expectedBdefType)
})

test("BDEF registration preserves an existing registration", t => {
  const existing = CreatableTypes.get(BDEF_TYPE_ID)
  t.after(() => {
    if (existing) CreatableTypes.set(BDEF_TYPE_ID, existing)
    else CreatableTypes.delete(BDEF_TYPE_ID)
  })
  const sentinel: CreatableType = {
    creationPath: "sentinel/creation",
    validationPath: "sentinel/validation",
    rootName: "sentinel:root",
    nameSpace: 'xmlns:sentinel="https://example.test/sentinel"',
    label: "Sentinel",
    typeId: BDEF_TYPE_ID,
    maxLen: 1
  }

  CreatableTypes.set(BDEF_TYPE_ID, sentinel)
  registerBdefType()

  assert.equal(CreatableTypes.get(BDEF_TYPE_ID), sentinel)
})

test("AbapToolService constructor registers the BDEF creation type", t => {
  const existing = CreatableTypes.get(BDEF_TYPE_ID)
  t.after(() => {
    if (existing) CreatableTypes.set(BDEF_TYPE_ID, existing)
    else CreatableTypes.delete(BDEF_TYPE_ID)
  })
  const connections: ConnectionProvider = {
    async listConnections() {
      return []
    },
    async getClient() {
      throw new Error("not called")
    }
  }

  CreatableTypes.delete(BDEF_TYPE_ID)
  new AbapToolService(connections)

  assert.deepEqual(CreatableTypes.get(BDEF_TYPE_ID), expectedBdefType)
})
