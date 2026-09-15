import assert from "node:assert/strict"
import { PassThrough, Writable } from "node:stream"
import type { ReadStream } from "node:tty"
import test from "node:test"
import { promptSecret } from "../src/secret-prompt.js"

function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) { this.isRaw = mode; return this }
  })
  let text = ""
  const output = new Writable({ write(chunk, _encoding, done) { text += chunk; done() } })
  return { input, output, text: () => text, prompt: () => promptSecret("SAP password: ", input as unknown as ReadStream, output) }
}

test("secret entry immediately shows masks, edits Unicode, and never echoes secrets", async () => {
  const tty = terminal()
  const result = tty.prompt()
  assert.equal(tty.input.isRaw, true)
  assert.match(tty.text(), /Enter to submit; Ctrl\+C to cancel/)
  tty.input.write("s3cret")
  assert.match(tty.text(), /SAP password: \*{6}$/)
  // Split a multibyte character across stream chunks, then delete it.
  const emoji = Buffer.from("🔑")
  tty.input.write(emoji.subarray(0, 2))
  tty.input.write(emoji.subarray(2))
  tty.input.write("\u007f")
  tty.input.write("\u001b[D\u001b[A\t")
  tty.input.write("!\r")
  assert.equal(await result, "s3cret!")
  assert.doesNotMatch(tty.text(), /s3cret|🔑/)
  assert.equal(tty.input.isRaw, false)
  assert.equal(tty.input.listenerCount("keypress"), 0)
  assert.equal(tty.input.listenerCount("end"), 0)
})

test("empty entry and retry work on the same terminal", async () => {
  const tty = terminal()
  let result = tty.prompt()
  tty.input.write("\u007f\r")
  assert.equal(await result, "")
  result = tty.prompt()
  tty.input.write("retry\n")
  assert.equal(await result, "retry")
})

for (const key of ["\u0003", "\u0004"]) {
  test(`cancellation with ${JSON.stringify(key)} restores the terminal without revealing input`, async () => {
    const tty = terminal()
    tty.input.isRaw = true
    const result = tty.prompt()
    tty.input.write(`private${key}`)
    await assert.rejects(result, { code: "CANCELLED" })
    assert.equal(tty.input.isRaw, true)
    assert.equal(tty.input.listenerCount("keypress"), 0)
    assert.doesNotMatch(tty.text(), /private/)
  })
}

test("closed input rejects instead of silently waiting", async () => {
  const tty = terminal()
  const result = tty.prompt()
  tty.input.end()
  await assert.rejects(result, { code: "CANCELLED" })
  assert.equal(tty.input.isRaw, false)
})

test("noninteractive input explains password-stdin", async () => {
  const tty = terminal()
  tty.input.isTTY = false
  await assert.rejects(tty.prompt(), { code: "PASSWORD_INPUT_REQUIRED", message: /--password-stdin/ })
  assert.equal(tty.text(), "")
})
