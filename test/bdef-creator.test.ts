import assert from "node:assert/strict"
import test from "node:test"
import { CreatableTypes, isCreatableTypeId } from "abap-adt-api"
import { BDEF_TYPE_ID, registerBdefType } from "../src/bdef-creator.js"

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
  assert.deepEqual(CreatableTypes.get(BDEF_TYPE_ID), {
    creationPath: "bo/behaviordefinitions",
    validationPath: "bo/behaviordefinitions/validation",
    rootName: "blue:blueSource",
    nameSpace: 'xmlns:blue="http://www.sap.com/wbobj/blue"',
    label: "Behavior Definition",
    typeId: BDEF_TYPE_ID,
    maxLen: 30
  })
})
