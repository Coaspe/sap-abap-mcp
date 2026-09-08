import assert from "node:assert/strict"
import test from "node:test"
import { decodeKnowledgeTransferDocument } from "../src/knowledge-transfer.js"

const encoded = (text: string) => Buffer.from(text).toString("base64")
test("KTD decoding preserves multilingual text and document element labels", () => {
  const text = "설계 문서 🙂\n<example> & details"
  assert.equal(decodeKnowledgeTransferDocument(`<k:docu xmlns:k="test"><k:elements><k:element><k:id>RUN</k:id><k:text>${encoded(text)}</k:text></k:element><k:element><k:id>EMPTY</k:id><k:text/></k:element></k:elements></k:docu>`), `## RUN\n\n${text}`)
  assert.equal(decodeKnowledgeTransferDocument(`<sktd:docu xmlns:sktd="test"><sktd:text>${encoded("Body")}</sktd:text></sktd:docu>`), "Body")
  assert.equal(decodeKnowledgeTransferDocument("<docu><element><id>EMPTY</id><text/></element></docu>"), "")
})
test("KTD decoding rejects malformed, oversized or ambiguous text representations", () => {
  for (const xml of [
    "<docu>", "<docu><unknown/></docu>", "<html>Login</html>", "<!DOCTYPE docu><docu/>",
    "<docu><text>invalid</text></docu>", "<docu><text>/w==</text></docu>",
    "<docu><text>A===</text></docu>", "<docu><text>AAAA</text><text>AAAA</text></docu>",
    `<docu><text>${"A".repeat(1024 * 1024)}</text></docu>`
  ]) assert.throws(() => decodeKnowledgeTransferDocument(xml), /document|representation/i)
})
